const fs = require('node:fs');
const path = require('node:path');
const { AbiCoder, Interface, TypedDataEncoder, id, keccak256 } = require('ethers');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'artifacts/contracts', file), 'utf8'));
const bundle = new Interface(read('modules/DoudoBundleModuleUpgradeable.sol/DoudoBundleModuleUpgradeable.json').abi);
const fixed = new Interface(read('FixedProbabilityLotteryV3Upgradeable.sol/FixedProbabilityLotteryV3Upgradeable.json').abi);
const buyer = '0x3000000000000000000000000000000000000003';
const U = 10n ** 18n;
const snapshot = id('coupon-v2-cross-repository-pricing-snapshot');
function fixture(iface, method, primaryType, domain, authorization, luckyNumbers) {
  const fields = iface.getFunction(method).inputs[0].components.map(({ name, type }) => ({ name, type }));
  const types = { [primaryType]: fields };
  const args = luckyNumbers ? [authorization, luckyNumbers, '0x'] : [authorization, '0x'];
  return { domain, primaryType, types, authorization, luckyNumbers,
    digest: TypedDataEncoder.hash(domain, types, authorization),
    selector: iface.getFunction(method).selector,
    unsignedCalldata: iface.encodeFunctionData(method, args) };
}
const common = { authorizationId:id('coupon-v2-cross-repository-nonce'), buyer,
  grossPoints:400n*U, rebatePoints:40n*U, netPoints:310n*U,
  couponDiscount:50n*U, pricingSnapshotHash:snapshot, pricingVersion:2, deadline:2000000000 };
const luckyNumbers = [1,2,3,4];
const bundleAuth = { ...common, seriesID:7, luckyNumbersHash:keccak256(AbiCoder.defaultAbiCoder().encode(['uint16[]'],[luckyNumbers])), ticketQuantity:4,
  revealImmediately:false, freeOrderChallenge:false };
const fixedAuth = { ...common, seriesId:7, configHash:id('coupon-v2-cross-repository-fixed-config'), quantity:4, freeOrderChallenge:false, eligibilityKey:'0x'+'00'.repeat(32) };
const out = { pricingVersion:2, unitRaw:U, amounts:{grossPointsRaw:400n*U,rebatePointsRaw:40n*U,couponDiscountPointsRaw:50n*U,debitNowPointsRaw:350n*U,netPaidPointsRaw:310n*U},
  allocations:Array.from({length:4},(_value,ticketIndex)=>({ticketIndex,grossPointsRaw:100n*U,rebatePointsRaw:10n*U,couponDiscountPointsRaw:50n*U/4n,netPaidPointsRaw:310n*U/4n})),
  bundle:fixture(bundle,'mintTicketsWithPointsAuthorizationV2','PointsMintAuthorizationV2',{name:'DOUDO Database Points',version:'1',chainId:421614,verifyingContract:'0x1000000000000000000000000000000000000001'},bundleAuth,luckyNumbers),
  fixedProbability:fixture(fixed,'requestDrawsV2','DrawAuthorizationV2',{name:'FixedProbabilityLottery',version:'3',chainId:421614,verifyingContract:'0x2000000000000000000000000000000000000002'},fixedAuth),
};
const purchase = [common.authorizationId,7,buyer,4,400n*U,40n*U,310n*U,0,false,false,10,0,50n*U,snapshot,2];
out.purchaseEvent = { signature:bundle.getEvent('DatabasePointsPurchaseMintedV2').format('full'), values:purchase,
  ...bundle.encodeEventLog(bundle.getEvent('DatabasePointsPurchaseMintedV2'),purchase) };
const requested = [1,101,buyer,7,fixedAuth.configHash,common.authorizationId,4,10,400n*U,40n*U,310n*U,false,fixedAuth.eligibilityKey,1,0,50n*U,snapshot,2];
out.orderRequestedEvent = {signature:fixed.getEvent('OrderRequestedV2').format('full'),values:requested,
  ...fixed.encodeEventLog(fixed.getEvent('OrderRequestedV2'),requested)};
fs.writeFileSync(path.join(root,'test/fixtures/coupon-v1/authorization-v2-golden.json'), JSON.stringify(out,(_key,value)=>typeof value==='bigint'?value.toString():value,2)+'\n');
