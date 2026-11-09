const { expect } = require('chai');
const { ethers, upgrades, artifacts } = require('hardhat');
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { createHash } = require('crypto');
const baseline = require('./fixtures/coupon-v1/pre-coupon-contracts.json');
const { deployFixedProbabilityProxy } = require('./helpers/fixed-probability-uups');
const U = 10n ** 18n;
const SNAPSHOT = ethers.id('immutable-coupon-quote');
const bundleFields = [
  ['authorizationId','bytes32'],['buyer','address'],['seriesID','uint256'],['luckyNumbersHash','bytes32'],
  ['ticketQuantity','uint256'],['grossPoints','uint256'],['revealImmediately','bool'],['freeOrderChallenge','bool'],
  ['deadline','uint256'],['couponDiscount','uint256'],['rebatePoints','uint256'],['netPoints','uint256'],
  ['pricingSnapshotHash','bytes32'],['pricingVersion','uint256'],
].map(([name,type])=>({name,type}));
const drawFields = [
  ['authorizationId','bytes32'],['buyer','address'],['seriesId','uint256'],['configHash','bytes32'],['quantity','uint16'],
  ['grossPoints','uint256'],['rebatePoints','uint256'],['netPoints','uint256'],['freeOrderChallenge','bool'],
  ['eligibilityKey','bytes32'],['deadline','uint256'],['couponDiscount','uint256'],['pricingSnapshotHash','bytes32'],['pricingVersion','uint256'],
].map(([name,type])=>({name,type}));
async function sign(signer, target, auth, fixed=false, overrides={}) {
  const domain = {name:fixed?'FixedProbabilityLottery':'DOUDO Database Points',version:fixed?'3':'1',
    chainId:(await ethers.provider.getNetwork()).chainId,verifyingContract:await target.getAddress(),...overrides};
  const types = {[fixed?'DrawAuthorizationV2':'PointsMintAuthorizationV2']:fixed?drawFields:bundleFields};
  return { signature:await signer.signTypedData(domain,types,auth),digest:ethers.TypedDataEncoder.hash(domain,types,auth) };
}
async function proxy(name,args,options={}) {
  const factory=await ethers.getContractFactory(name);
  return upgrades.deployProxy(factory,args,{kind:'uups',...options});
}
async function bundleFixture() {
  const [admin,buyer,other]=await ethers.getSigners();
  const points=await (await ethers.getContractFactory('contracts/DDOUDOCOIN.sol:DOUDOCOIN')).deploy(admin.address,admin.address);
  const vrf=await (await ethers.getContractFactory('VRFCoordinatorV2PlusMock')).deploy();
  const router=await (await ethers.getContractFactory('DoudoVRFRouter')).deploy(await vrf.getAddress(),123,ethers.ZeroHash,0,2500000);
  const draw=await (await ethers.getContractFactory('DoudoPrizeDrawLib')).deploy();
  const uri=await (await ethers.getContractFactory('DoudoTokenURILib')).deploy();
  const factory=await ethers.getContractFactory('DOUDOCHAINV2CoreUpgradeable',{libraries:{DoudoPrizeDrawLib:await draw.getAddress(),DoudoTokenURILib:await uri.getAddress()}});
  const core=await upgrades.deployProxy(factory,[await points.getAddress(),await router.getAddress()],{kind:'uups',unsafeAllowLinkedLibraries:true});
  const ops=await proxy('DoudoSeriesOpsModuleUpgradeable',[await core.getAddress()]);
  await core.setSeriesOpsModule(await ops.getAddress());
  const bundle=await proxy('DoudoBundleModuleUpgradeable',[await core.getAddress(),await points.getAddress()]);
  const membership=await proxy('DoudoMembershipV2Upgradeable',[admin.address,await bundle.getAddress(),await bundle.getAddress()]);
  const refund=await proxy('DoudoRefundModuleUpgradeable',[await core.getAddress(),await points.getAddress()]);
  for(const module of [bundle,refund])await core.grantRole(await core.MODULE_ROLE(),await module.getAddress());
  await router.setRequester(await core.getAddress(),true);
  await bundle.configureDatabasePointsAuthorization(admin.address,await membership.getAddress(),true);
  await bundle.setDatabasePointsRefundModule(await refund.getAddress());
  await refund.configureDatabasePointsRefundAccounting(await bundle.getAddress(),await membership.getAddress(),true);
  await membership.grantRole(await membership.CONSUMPTION_RECORDER_ROLE(),await refund.getAddress());
  await core.createSeriesWithSubPrizes({seriesName:'Coupon',totalTicketNumbers:60,priceInPoints:100n*U,priceInTWD:100,
    estimateDeliverTime:1780000000,exchangeTokenURI:'ipfs://exchange/',unrevealTokenURI:'ipfs://hidden',revealTokenURI:'ipfs://reveal/',
    seriesMetaDataURI:'ipfs://series',isPreOrder:false,useLuckyNumber:true,maxPerWallet:0,packingType:1,sourceType:1},
    [{subPrizeID:1,prizeGroup:'A',subPrizeName:'Prize',subPrizeRemainingQuantity:60}],true);
  await bundle.setSeriesRebateTiers(0,[{minimumTicketQuantity:1,rebatePoints:40n*U}]);
  return {admin,buyer,other,points,vrf,router,core,bundle,membership,refund};
}
async function bundleAuthorization(f, overrides={}) {
  const numbers=overrides.numbers??[1,2,3,4];
  const q=await f.bundle.quoteTicketPurchase(0,numbers.length);
  const couponDiscount=overrides.couponDiscount??50n*U;
  const auth={authorizationId:ethers.id('coupon-'+numbers.join('-')),buyer:f.buyer.address,seriesID:0,
    luckyNumbersHash:ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint16[]'],[numbers])),ticketQuantity:numbers.length,
    grossPoints:q.grossPriceInPoints,revealImmediately:false,freeOrderChallenge:false,deadline:(await time.latest())+600,
    couponDiscount,rebatePoints:q.rebatePoints,netPoints:q.grossPriceInPoints-q.rebatePoints-couponDiscount,
    pricingSnapshotHash:SNAPSHOT,pricingVersion:2,...overrides};
  delete auth.numbers;
  return {auth,numbers,...await sign(f.admin,f.bundle,auth)};
}
async function fixedFixture() {
  const [admin,signer,operator,buyer,other]=await ethers.getSigners();
  const router=await (await ethers.getContractFactory('FixedProbabilityV3RouterMock')).deploy();
  const membership=await (await ethers.getContractFactory('FixedProbabilityV3MembershipMock')).deploy();
  const {lottery}=await deployFixedProbabilityProxy([await router.getAddress(),signer.address,operator.address,await membership.getAddress(),admin.address,admin.address]);
  await lottery.connect(operator).createSeries({pricePoints:100n*U,drawCap:0,maxBatchSize:10,prizeIds:[1,2],weights:[5000,5000],
    discountQuantities:[4],discountPoints:[40n*U],freeOrderMode:2,freeOrderFirstDraws:0,freeOrderPrizeIds:[1],gateMode:0,minMemberLevel:0,
    eligibilityPolicyId:ethers.ZeroHash,eligibilityScope:ethers.ZeroHash,maxEligibleDraws:0,contentHash:SNAPSHOT,contentURI:'ipfs://coupon'});
  await lottery.connect(operator).setSeriesStatus(1,2);
  return {admin,signer,operator,buyer,other,router,membership,lottery};
}
async function fixedAuthorization(f,overrides={}) {
  const quantity=overrides.quantity??4;
  const [grossPoints,rebatePoints,oldNet]=await f.lottery.quoteOrder(1,quantity);
  const couponDiscount=overrides.couponDiscount??50n*U;
  const auth={authorizationId:ethers.id('fixed-coupon'),buyer:f.buyer.address,seriesId:1,configHash:(await f.lottery.getSeries(1)).configHash,
    quantity,grossPoints,rebatePoints,netPoints:oldNet-couponDiscount,freeOrderChallenge:false,eligibilityKey:ethers.ZeroHash,
    deadline:(await time.latest())+600,couponDiscount,pricingSnapshotHash:SNAPSHOT,pricingVersion:2,...overrides};
  return {auth,...await sign(f.signer,f.lottery,auth,true)};
}
function normalizeLayout(layout) {
  const expand=id=>{const t=layout.types[id],out={label:t.label,encoding:t.encoding,numberOfBytes:t.numberOfBytes};
    for(const key of ['base','key','value'])if(t[key])out[key]=expand(t[key]);
    if(t.members)out.members=t.members.map(x=>({label:x.label,slot:x.slot,offset:x.offset,type:expand(x.type)}));return out;};
  return layout.storage.map(x=>({label:x.label,slot:x.slot,offset:x.offset,type:expand(x.type)}));
}
describe('Coupon V2 compatibility and accounting',function(){
  it('preserves every V1 ABI shape and storage slot and meets EIP-170',async function(){
    for(const [name,old] of Object.entries(baseline.contracts)) {
      const a=await artifacts.readArtifact(name),info=await artifacts.getBuildInfo(`${a.sourceName}:${name}`);
      const current=new ethers.Interface(a.abi).fragments.map(f=>f.format('full'));
      for(const signature of old.abi)expect(current,`${name}: ${signature}`).to.include(signature);
      const hash=createHash('sha256').update(JSON.stringify(normalizeLayout(info.output.contracts[a.sourceName][name].storageLayout))).digest('hex');
      expect(hash,name).to.equal(old.storageLayoutSha256);
      expect((a.deployedBytecode.length-2)/2,name).to.be.at.most(24576);
    }
  });
  it('matches the shared typed-data, calldata and event golden fixture',async function(){
    const fixture=require('./fixtures/coupon-v1/authorization-v2-golden.json');
    for(const [key,name,method] of [['bundle','DoudoBundleModuleUpgradeable','mintTicketsWithPointsAuthorizationV2'],['fixedProbability','FixedProbabilityLotteryV3Upgradeable','requestDrawsV2']]){
      const value=fixture[key],iface=new ethers.Interface((await artifacts.readArtifact(name)).abi);
      expect(ethers.TypedDataEncoder.hash(value.domain,value.types,value.authorization)).to.equal(value.digest);
      const args=value.luckyNumbers?[value.authorization,value.luckyNumbers,'0x']:[value.authorization,'0x'];
      expect(iface.encodeFunctionData(method,args)).to.equal(value.unsignedCalldata);
      expect(iface.getFunction(method).selector).to.equal(value.selector);
      const event=iface.encodeEventLog(iface.getEvent('DatabasePointsPurchaseMintedV2'),fixture.purchaseEvent.values);
      expect(event.topics).to.deep.equal(fixture.purchaseEvent.topics);expect(event.data).to.equal(fixture.purchaseEvent.data);
    }
  });
  it('records G/B/C/N with a dedicated event and refunds only the coupon net',async function(){
    const f=await loadFixture(bundleFixture),a=await bundleAuthorization(f);
    expect(await f.bundle.pointsAuthorizationDigestV2(a.auth)).to.equal(a.digest);
    expect(await f.bundle.couponAuthorizationVersion()).to.equal(2);
    const tx=f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorizationV2(a.auth,a.numbers,a.signature);
    await expect(tx).to.emit(f.bundle,'DatabasePointsPurchaseMintedV2').withArgs(a.auth.authorizationId,0,f.buyer.address,4,400n*U,40n*U,310n*U,0,false,false,0,0,50n*U,SNAPSHOT,2)
      .and.to.emit(f.bundle,'TicketPurchaseMinted').withArgs(0,f.buyer.address,4,350n*U,false,0);
    await expect(tx).not.to.emit(f.bundle,'DatabasePointsPurchaseMinted');
    let total=0n;for(let i=0;i<4;i++)total+=await f.core.pointsPaid(i);expect(total).to.equal(310n*U);
    expect((await f.membership.getMember(f.buyer.address)).currentQualifyingSpend).to.equal(total);
    await f.refund.setSeriesRefund(0,true,100n*U);
    const paid=await f.core.pointsPaid(0);
    await expect(f.refund.connect(f.buyer).claimRefund([0])).to.emit(f.refund,'DatabasePointsRefundClaimed').withArgs(0,f.buyer.address,[0],paid);
    await expect(f.refund.connect(f.buyer).claimRefund([1,2,3])).to.emit(f.refund,'DatabasePointsRefundClaimed').withArgs(0,f.buyer.address,[1,2,3],total-paid);
    expect((await f.membership.getMember(f.buyer.address)).currentQualifyingSpend).to.equal(0);
  });
  it('allocates rebate before the coupon across mixed opening/regular capacity and integer remainders',async function(){
    const f=await loadFixture(bundleFixture);
    await f.bundle.setSeriesOpeningDiscount(0,1,1n*U);
    await f.bundle.setSeriesRebateTiers(0,[{minimumTicketQuantity:1,rebatePoints:299n*U-1n}]);
    const a=await bundleAuthorization(f,{couponDiscount:1n*U});
    await f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorizationV2(a.auth,a.numbers,a.signature);
    let total=0n;for(let i=0;i<4;i++){const paid=await f.core.pointsPaid(i);expect(paid).to.be.gte(0);total+=paid;}
    expect(total).to.equal(a.auth.netPoints);expect(total).to.equal(1n*U+1n);
  });
  it('handles zero residual regular capacity and rejects rebates outside that capacity',async function(){
    const f=await loadFixture(bundleFixture);
    await f.bundle.setSeriesOpeningDiscount(0,1,99n*U);
    await f.bundle.setSeriesRebateTiers(0,[{minimumTicketQuantity:1,rebatePoints:301n*U}]);
    const bad=await bundleAuthorization(f,{couponDiscount:1n*U});
    await expect(f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorizationV2(bad.auth,bad.numbers,bad.signature)).to.be.revertedWithCustomError(f.bundle,'InvalidPointsAuthorization');
    await f.bundle.setSeriesRebateTiers(0,[{minimumTicketQuantity:1,rebatePoints:300n*U}]);
    const good=await bundleAuthorization(f,{couponDiscount:98n*U});
    await expect(f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorizationV2(good.auth,good.numbers,good.signature)).to.emit(f.bundle,'OpeningDiscountApplied').withArgs(0,f.buyer.address,1,3,99n*U,301n*U,300n*U);
    expect(await f.core.pointsPaid(0)).to.equal(U);
    for(let i=1;i<4;i++)expect(await f.core.pointsPaid(i)).to.equal(0);
  });
  it('rejects stale rebates, fractional coupons, dust net, invalid snapshots and mismatched signatures without consuming nonce',async function(){
    const f=await loadFixture(bundleFixture);
    const a=await bundleAuthorization(f);
    await f.bundle.setSeriesRebateTiers(0,[{minimumTicketQuantity:1,rebatePoints:41n*U}]);
    await expect(f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorizationV2(a.auth,a.numbers,a.signature)).to.be.revertedWithCustomError(f.bundle,'InvalidPointsAuthorization');
    await f.bundle.setSeriesRebateTiers(0,[{minimumTicketQuantity:1,rebatePoints:40n*U}]);
    for(const overrides of [{couponDiscount:U+1n},{couponDiscount:360n*U-1n},{pricingSnapshotHash:ethers.ZeroHash},{pricingVersion:1},{couponDiscount:0n}]){
      const bad=await bundleAuthorization(f,overrides);
      await expect(f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorizationV2(bad.auth,bad.numbers,bad.signature)).to.be.revertedWithCustomError(f.bundle,'InvalidPointsAuthorization');
    }
    for(const patch of [{couponDiscount:51n*U},{pricingSnapshotHash:ethers.id('tampered')},{buyer:f.other.address},{deadline:0}]){
      await expect(f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorizationV2({...a.auth,...patch},a.numbers,a.signature)).to.be.reverted;
    }
    const wrongDomain=await sign(f.admin,f.bundle,a.auth,false,{chainId:1});
    await expect(f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorizationV2(a.auth,a.numbers,wrongDomain.signature)).to.be.revertedWithCustomError(f.bundle,'InvalidPointsAuthorization');
    expect(await f.bundle.pointsAuthorizationUsed(a.auth.authorizationId)).to.equal(false);
  });
  it('shares nonces across bundle V1/V2 and keeps V1 purchase accounting intact',async function(){
    const f=await loadFixture(bundleFixture),a=await bundleAuthorization(f);
    const {couponDiscount,rebatePoints,netPoints,pricingSnapshotHash,pricingVersion,...legacy}=a.auth;
    const domain={name:'DOUDO Database Points',version:'1',chainId:(await ethers.provider.getNetwork()).chainId,verifyingContract:await f.bundle.getAddress()};
    const signature=await f.admin.signTypedData(domain,{PointsMintAuthorization:bundleFields.slice(0,9)},legacy);
    await expect(f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorization(legacy,a.numbers,signature)).to.emit(f.bundle,'DatabasePointsPurchaseMinted').withArgs(legacy.authorizationId,0,f.buyer.address,4,400n*U,40n*U,360n*U,0,false,false,0,0);
    await expect(f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorizationV2(a.auth,a.numbers,a.signature)).to.be.revertedWithCustomError(f.bundle,'PointsAuthorizationAlreadyUsed');
  });
  it('limits a winning free-order refund to coupon net and cannot refund the same tickets twice',async function(){
    const f=await loadFixture(bundleFixture);await f.bundle.setSeriesFreeOrderChallenge(0,10,[1]);
    const a=await bundleAuthorization(f,{revealImmediately:true,freeOrderChallenge:true});
    await expect(f.bundle.connect(f.buyer).mintTicketsWithPointsAuthorizationV2(a.auth,a.numbers,a.signature)).to.emit(f.bundle,'FreeOrderChallengePurchased').withArgs(1,0,f.buyer.address,4,350n*U,40n*U,310n*U,0);
    await f.vrf.fulfill(await f.router.getAddress(),1,[123]);
    await expect(f.bundle.settleFreeOrderChallenge(1)).to.emit(f.bundle,'DatabasePointsFreeOrderChallengeRefunded').withArgs(1,0,f.buyer.address,310n*U);
    expect((await f.membership.getMember(f.buyer.address)).currentQualifyingSpend).to.equal(0);
    await f.refund.setSeriesRefund(0,true,100n*U);
    await expect(f.refund.connect(f.buyer).claimRefund([0])).to.be.revertedWithCustomError(f.bundle,'TicketRefundAlreadySettled');
  });
  it('supports fixed probability V2 with complete events, net membership and free-order reversal',async function(){
    const f=await loadFixture(fixedFixture),a=await fixedAuthorization(f,{freeOrderChallenge:true});
    expect(await f.lottery.authorizationDigestV2(a.auth)).to.equal(a.digest);expect(await f.lottery.couponAuthorizationVersion()).to.equal(2);
    const tx=f.lottery.connect(f.buyer).requestDrawsV2(a.auth,a.signature);
    await expect(tx).to.emit(f.lottery,'OrderRequestedV2').withArgs(1,1,f.buyer.address,1,a.auth.configHash,a.auth.authorizationId,4,1,400n*U,40n*U,310n*U,true,ethers.ZeroHash,5,0,50n*U,SNAPSHOT,2)
      .and.to.emit(f.lottery,'DatabasePointsPurchaseMintedV2').withArgs(a.auth.authorizationId,1,f.buyer.address,4,400n*U,40n*U,310n*U,310n*U/100n,false,true,1,1,50n*U,SNAPSHOT,2);
    await expect(tx).to.emit(f.lottery,'TicketPurchaseMinted').withArgs(1,f.buyer.address,4,350n*U,false,1);
    await expect(tx).not.to.emit(f.lottery,'OrderRequested');await expect(tx).not.to.emit(f.lottery,'DatabasePointsPurchaseMinted');
    expect((await f.lottery.getOrder(1)).netPoints).to.equal(310n*U);expect(await f.membership.recordedPoints()).to.equal(310n*U);
    await f.router.fulfill(1,[1,9999,9999,9999]);
    await expect(f.lottery.finalizeOrderAccounting(1)).to.emit(f.lottery,'DatabasePointsFreeOrderChallengeRefunded').withArgs(1,1,f.buyer.address,310n*U);
    expect(await f.membership.reversedPoints()).to.equal(310n*U);
    await expect(f.lottery.finalizeOrderAccounting(1)).to.be.revertedWithCustomError(f.lottery,'AccountingAlreadyFinalized');
  });
  it('rejects invalid fixed V2 pricing and cross-version replay',async function(){
    const f=await loadFixture(fixedFixture),a=await fixedAuthorization(f);
    for(const patch of [{couponDiscount:U+1n},{couponDiscount:360n*U,netPoints:0n},{netPoints:U-1n},{pricingSnapshotHash:ethers.ZeroHash},{pricingVersion:1},{grossPoints:401n*U},{rebatePoints:41n*U}]){
      const bad=await fixedAuthorization(f,patch);await expect(f.lottery.connect(f.buyer).requestDrawsV2(bad.auth,bad.signature)).to.be.revertedWithCustomError(f.lottery,'InvalidAuthorization');
    }
    await f.lottery.connect(f.buyer).requestDrawsV2(a.auth,a.signature);
    const {couponDiscount,pricingSnapshotHash,pricingVersion,...legacy}=a.auth;legacy.netPoints+=couponDiscount;
    const signature=await f.signer.signTypedData({name:'FixedProbabilityLottery',version:'3',chainId:(await ethers.provider.getNetwork()).chainId,verifyingContract:await f.lottery.getAddress()},{DrawAuthorization:drawFields.slice(0,11)},legacy);
    await expect(f.lottery.connect(f.buyer).requestDraws(legacy,signature)).to.be.revertedWithCustomError(f.lottery,'AuthorizationAlreadyUsed');
  });
  it('initializes coupon ticket state before callbacks and rejects reentrant checkout in both modes',async function(){
    const f=await loadFixture(bundleFixture);
    const receiver=await (await ethers.getContractFactory('CouponCallbackReceiver')).deploy(await f.core.getAddress());
    const a=await bundleAuthorization(f,{buyer:await receiver.getAddress()});
    const data=f.bundle.interface.encodeFunctionData('mintTicketsWithPointsAuthorizationV2',[a.auth,a.numbers,a.signature]);
    await receiver.execute(await f.bundle.getAddress(),data,await f.core.getAddress(),f.core.interface.encodeFunctionData('pointsPaid',[0]));
    expect(await receiver.callbackCount()).to.equal(4);
    expect(ethers.AbiCoder.defaultAbiCoder().decode(['uint256'],await receiver.observedState())[0]).to.equal(await f.core.pointsPaid(0));
    expect(await receiver.replaySucceeded()).to.equal(false);
    expect((await receiver.replayResult()).slice(0,10)).to.equal(f.bundle.interface.getError('ReentrantCall').selector);
    const fixed=await loadFixture(fixedFixture);
    const observer=await (await ethers.getContractFactory('CouponCallbackReceiver')).deploy(await fixed.lottery.getAddress());
    const b=await fixedAuthorization(fixed,{buyer:await observer.getAddress()});
    await observer.execute(await fixed.lottery.getAddress(),fixed.lottery.interface.encodeFunctionData('requestDrawsV2',[b.auth,b.signature]),
      await fixed.lottery.getAddress(),fixed.lottery.interface.encodeFunctionData('authorizationUsed',[b.auth.authorizationId]));
    expect(await observer.callbackCount()).to.equal(4);
    expect(ethers.AbiCoder.defaultAbiCoder().decode(['bool'],await observer.observedState())[0]).to.equal(true);
    expect(await observer.replaySucceeded()).to.equal(false);
    expect((await observer.replayResult()).slice(0,10)).to.equal(fixed.lottery.interface.getError('ReentrantCall').selector);
  });

});
