const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

function prizeTable(total = 6) {
  return [
    { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 2 },
    { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: total - 2 },
  ];
}

function seriesInput(overrides = {}) {
  return {
    seriesName: "V2 Fix Series",
    totalTicketNumbers: 6,
    priceInPoints: ethers.parseEther("1"),
    priceInTWD: 100,
    estimateDeliverTime: 1780000000,
    exchangeTokenURI: "ipfs://exchange/",
    unrevealTokenURI: "ipfs://unreveal",
    revealTokenURI: "ipfs://reveal/",
    seriesMetaDataURI: "ipfs://series",
    isPreOrder: false,
    useLuckyNumber: false,
    maxPerWallet: 0,
    ...overrides,
  };
}

async function deploySplitSuite() {
  const [admin, user, other, receiver] = await ethers.getSigners();

  const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
  const points = await Points.deploy(admin.address, admin.address);
  await points.waitForDeployment();

  const Vrf = await ethers.getContractFactory("contracts/test/VRFCoordinatorV2PlusMock.sol:VRFCoordinatorV2PlusMock");
  const vrf = await Vrf.deploy();
  await vrf.waitForDeployment();

  const Router = await ethers.getContractFactory("contracts/DoudoVRFRouter.sol:DoudoVRFRouter");
  const router = await Router.deploy(
    await vrf.getAddress(),
    123n,
    ethers.keccak256(ethers.toUtf8Bytes("arb-sepolia-keyhash")),
    0,
    2_500_000
  );
  await router.waitForDeployment();

  const Core = await ethers.getContractFactory(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable"
  );
  const core = await upgrades.deployProxy(Core, [await points.getAddress(), await router.getAddress()], {
    initializer: "initialize",
    kind: "uups",
  });
  await core.waitForDeployment();

  const Bundle = await ethers.getContractFactory(
    "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable"
  );
  const bundle = await upgrades.deployProxy(Bundle, [await core.getAddress(), await points.getAddress()], {
    initializer: "initialize",
    kind: "uups",
  });
  await bundle.waitForDeployment();

  const Refund = await ethers.getContractFactory(
    "contracts/modules/DoudoRefundModuleUpgradeable.sol:DoudoRefundModuleUpgradeable"
  );
  const refund = await upgrades.deployProxy(Refund, [await core.getAddress(), await points.getAddress()], {
    initializer: "initialize",
    kind: "uups",
  });
  await refund.waitForDeployment();

  const Redraw = await ethers.getContractFactory(
    "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable"
  );
  const redraw = await upgrades.deployProxy(Redraw, [await core.getAddress(), await router.getAddress()], {
    initializer: "initialize",
    kind: "uups",
  });
  await redraw.waitForDeployment();

  const Reward = await ethers.getContractFactory(
    "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable"
  );
  const reward = await upgrades.deployProxy(Reward, [await core.getAddress(), await points.getAddress()], {
    initializer: "initialize",
    kind: "uups",
  });
  await reward.waitForDeployment();

  await core.grantRole(await core.MODULE_ROLE(), await bundle.getAddress());
  await core.grantRole(await core.MODULE_ROLE(), await refund.getAddress());
  await core.grantRole(await core.MODULE_ROLE(), await redraw.getAddress());
  await core.grantRole(await core.MODULE_ROLE(), await reward.getAddress());
  await router.setRequester(await core.getAddress(), true);
  await router.setRequester(await redraw.getAddress(), true);
  await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
  await points.grantRole(await points.BURNER_ROLE(), await bundle.getAddress());
  await points.grantRole(await points.MINTER_ROLE(), await bundle.getAddress());
  await points.grantRole(await points.MINTER_ROLE(), await refund.getAddress());
  await points.grantRole(await points.MINTER_ROLE(), await reward.getAddress());
  await bundle.setRedrawModule(await redraw.getAddress());
  await redraw.setBundleModule(await bundle.getAddress());

  return { admin, user, other, receiver, points, vrf, router, core, bundle, refund, redraw, reward };
}

async function createSeries(core, overrides = {}, markGoodsArrived = true) {
  const input = seriesInput(overrides);
  await core.createSeriesWithSubPrizes(input, prizeTable(input.totalTicketNumbers), markGoodsArrived);
}

async function issuePoints(points, to, amount = ethers.parseEther("100")) {
  await points.mint(to, amount);
}

async function revealTickets({ user, core, vrf, router }, seriesID, tokenIDs, randomWord = 12345n) {
  await core.connect(user).reveal(seriesID, tokenIDs);
  await vrf.fulfill(await router.getAddress(), 1, [randomWord]);
}

describe("DOUDOCHAIN V2 fixes", function () {
  it("bundle mint respects refund state", async function () {
    const { user, points, core, bundle, refund } = await deploySplitSuite();
    await createSeries(core, { useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await bundle.setSeriesBundles(0, [{
      bundleID: 1,
      ticketQuantity: 2,
      priceInPoints: ethers.parseEther("10"),
      rebatePoints: 0,
      consolationDrawCredits: 0,
      active: true,
    }]);

    await refund.setSeriesRefund(0, true, 0);

    await expect(bundle.connect(user).mintBundle(0, 1, 1))
      .to.be.revertedWithCustomError(core, "SeriesIsRefund");
  });

  it("bundle mint enforces wallet cap, auto-assigns lucky numbers, and records pointsPaid", async function () {
    const { user, points, core, bundle } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 4, useLuckyNumber: true, maxPerWallet: 2 });
    await issuePoints(points, user.address);
    await bundle.setSeriesBundles(0, [{
      bundleID: 1,
      ticketQuantity: 2,
      priceInPoints: ethers.parseEther("10"),
      rebatePoints: 0,
      consolationDrawCredits: 0,
      active: true,
    }]);

    await bundle.connect(user).mintBundle(0, 1, 1);

    expect((await core.ticketStatusDetail(0)).luckyNumber).to.equal(1);
    expect((await core.ticketStatusDetail(1)).luckyNumber).to.equal(2);
    expect(await core.pointsPaid(0)).to.equal(ethers.parseEther("5"));
    expect(await core.pointsPaid(1)).to.equal(ethers.parseEther("5"));

    await expect(bundle.connect(user).mintBundle(0, 1, 1))
      .to.be.revertedWithCustomError(core, "WalletCapExceeded");
  });

  it("redrawMain burns N revealed tickets and mints N unrevealed tickets from remaining", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core, redraw } = suite;
    await createSeries(core, { totalTicketNumbers: 5, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0, 0]);
    await revealTickets(suite, 0, [0, 1], 777n);
    const beforeBalance = await core.balanceOf(user.address);

    await redraw.setRedrawEnabled(0, true);
    await expect(redraw.connect(user).redrawMain(0, [0, 1]))
      .to.emit(redraw, "RedrawMinted")
      .withArgs(0, user.address, 2, 3);

    expect(await core.balanceOf(user.address)).to.equal(beforeBalance);
    await expect(core.ownerOf(0)).to.be.reverted;
    await expect(core.ownerOf(1)).to.be.reverted;
    expect(await core.ownerOf(3)).to.equal(user.address);
    expect(await core.ownerOf(4)).to.equal(user.address);
    expect((await core.ticketStatusDetail(3)).tokenRevealed).to.equal(false);
  });

  it("redrawMain reverts when remaining inventory is less than burn count", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core, redraw } = suite;
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0]);
    await revealTickets(suite, 0, [0], 123n);

    await redraw.setRedrawEnabled(0, true);
    await expect(redraw.connect(user).redrawMain(0, [0]))
      .to.be.revertedWithCustomError(core, "NotEnoughNFTsRemaining");
  });

  it("consolation draws use a separate pool and mint revealed rewards after sellout", async function () {
    const { user, points, vrf, router, core, bundle, redraw } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await redraw.setConsolationPrizes(0, [{
      subPrizeID: 9001,
      prizeGroup: "Z",
      subPrizeName: "Consolation",
      subPrizeRemainingQuantity: 5,
    }]);
    await bundle.setSeriesBundles(0, [{
      bundleID: 1,
      ticketQuantity: 2,
      priceInPoints: ethers.parseEther("2"),
      rebatePoints: 0,
      consolationDrawCredits: 1,
      active: true,
    }]);
    await bundle.connect(user).mintBundle(0, 1, 1);
    await expect(core.connect(user).mint(0, [0]))
      .to.be.revertedWithCustomError(core, "NotEnoughNFTsRemaining");

    await redraw.connect(user).drawConsolation(0);
    await expect(vrf.fulfill(await router.getAddress(), 1, [42]))
      .to.emit(redraw, "RedrawFulfilled")
      .withArgs(1, 0, user.address, 2, true);

    expect(await core.ownerOf(2)).to.equal(user.address);
    const reward = await core.ticketStatusDetail(2);
    expect(reward.tokenRevealed).to.equal(true);
    expect(reward.tokenRevealedPrize).to.equal(9001);
    await expect(core.connect(user).mint(0, [0]))
      .to.be.revertedWithCustomError(core, "NotEnoughNFTsRemaining");
  });

  it("restores reveal/exchange-aware tokenURI and exchangePrize", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core } = suite;
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0]);

    expect(await core.tokenURI(0)).to.equal("ipfs://unreveal");
    await revealTickets(suite, 0, [0], 1n);
    const prizeID = (await core.ticketStatusDetail(0)).tokenRevealedPrize;
    expect(await core.tokenURI(0)).to.equal(`ipfs://reveal/${prizeID}`);

    await expect(core.connect(user).exchangePrize([0]))
      .to.emit(core, "UpdateTicketStatus")
      .withArgs(0, 0, prizeID, true, true);
    expect(await core.tokenURI(0)).to.equal(`ipfs://exchange/${prizeID}`);
    await expect(core.connect(user).exchangePrize([0]))
      .to.be.revertedWithCustomError(core, "TokenAlreadyExchanged");
  });

  it("refunds the actual pointsPaid for paid and bundle tickets", async function () {
    const { user, points, core, bundle, refund } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 3, priceInPoints: ethers.parseEther("7"), useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0]);
    await bundle.setSeriesBundles(0, [{
      bundleID: 1,
      ticketQuantity: 2,
      priceInPoints: ethers.parseEther("10"),
      rebatePoints: 0,
      consolationDrawCredits: 0,
      active: true,
    }]);
    await bundle.connect(user).mintBundle(0, 1, 1);

    await refund.setSeriesRefund(0, true, ethers.parseEther("1"));
    await expect(refund.connect(user).claimRefund([0, 1, 2]))
      .to.emit(refund, "RefundClaimed")
      .withArgs(0, user.address, [0, 1, 2], ethers.parseEther("17"));
    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
  });

  it("allows pre-order minting but gates reveal until goods arrive", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core } = suite;
    await createSeries(core, { totalTicketNumbers: 2, isPreOrder: true, useLuckyNumber: false, maxPerWallet: 0 }, false);
    await issuePoints(points, user.address);

    await core.connect(user).mint(0, [0]);
    await expect(core.connect(user).reveal(0, [0]))
      .to.be.revertedWithCustomError(core, "GoodsNotArrived");

    await core.setGoodsArrived(0);
    await expect(core.connect(user).reveal(0, [0]))
      .to.emit(core, "RevealDrawSent");
  });

  it("mintAndReveal caps quantity at 10 and auto-requests reveal", async function () {
    const suite = await deploySplitSuite();
    const { user, points, vrf, router, core } = suite;
    await createSeries(core, { totalTicketNumbers: 12, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address, ethers.parseEther("200"));

    const eleven = Array.from({ length: 11 }, (_, i) => i + 1);
    await expect(core.connect(user).mintAndReveal(0, eleven))
      .to.be.revertedWithCustomError(core, "RevealBatchTooLarge");

    const three = [1, 2, 3];
    await expect(core.connect(user).mintAndReveal(0, three))
      .to.emit(core, "RevealDrawSent");

    expect(await core.ownerOf(0)).to.equal(user.address);
    expect(await core.ownerOf(2)).to.equal(user.address);
    expect((await core.ticketStatusDetail(0)).tokenRevealed).to.equal(false);

    await vrf.fulfill(await router.getAddress(), 1, [999n]);
    expect((await core.ticketStatusDetail(0)).tokenRevealed).to.equal(true);
    expect((await core.ticketStatusDetail(1)).tokenRevealed).to.equal(true);
    expect((await core.ticketStatusDetail(2)).tokenRevealed).to.equal(true);
  });

  it("mintAndReveal requires goods arrived even for pre-order series", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core } = suite;
    await createSeries(
      core,
      { totalTicketNumbers: 2, isPreOrder: true, useLuckyNumber: false, maxPerWallet: 0 },
      false
    );
    await issuePoints(points, user.address);

    await expect(core.connect(user).mintAndReveal(0, [1]))
      .to.be.revertedWithCustomError(core, "GoodsNotArrived");
  });

  it("chooses non-preorder last-prize winner synchronously from the last sold ticket", async function () {
    const { user, other, points, core } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0, isPreOrder: false });
    await issuePoints(points, user.address);
    await issuePoints(points, other.address);
    await core.connect(user).mint(0, [0]);
    await ethers.provider.send("evm_increaseTime", [901]);
    await ethers.provider.send("evm_mine", []);
    await core.connect(other).mint(0, [0]);

    await core.chooseLastPrizeWinner(0, 1);
    expect(await core.ownerOf(2)).to.equal(other.address);
    expect((await core.ticketStatusDetail(2)).tokenRevealedPrize).to.equal(999);
  });

  it("supports adjustable mint locks and maxPerWallet updates", async function () {
    const { user, other, points, core } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 5, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await issuePoints(points, other.address);
    await core.setDefaultLockDuration(60);
    await core.setSeriesMaxPerWallet(0, 2);

    await core.connect(user).mint(0, [0]);
    await expect(core.connect(other).mint(0, [0]))
      .to.be.revertedWithCustomError(core, "SeriesReserved");
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);
    await core.connect(other).mint(0, [0]);
    await core.clearMintLock(0);
    await core.connect(user).mint(0, [0]);
    await expect(core.connect(user).mint(0, [0]))
      .to.be.revertedWithCustomError(core, "WalletCapExceeded");
  });

  it("blocks router coordinator changes while VRF requests are pending", async function () {
    const { admin, vrf, router } = await deploySplitSuite();
    const Vrf = await ethers.getContractFactory("contracts/test/VRFCoordinatorV2PlusMock.sol:VRFCoordinatorV2PlusMock");
    const nextVrf = await Vrf.deploy();
    await nextVrf.waitForDeployment();
    const Callback = await ethers.getContractFactory("contracts/test/MockVRFCallback.sol:MockVRFCallback");
    const callback = await Callback.deploy();
    await callback.waitForDeployment();

    await router.setRequester(admin.address, true);
    await router.requestRandomWords(await callback.getAddress(), 1);
    expect(await router.pendingRequests()).to.equal(1);
    await expect(router.setVrfConfig(await nextVrf.getAddress(), 123n, ethers.ZeroHash, 2_500_000, 0))
      .to.be.revertedWithCustomError(router, "PendingRequests");

    await vrf.fulfill(await router.getAddress(), 1, [9]);
    expect(await router.pendingRequests()).to.equal(0);
    expect(await callback.lastRandomWord()).to.equal(9);
    await router.setVrfConfig(await nextVrf.getAddress(), 123n, ethers.ZeroHash, 2_500_000, 0);
  });

  it("preserves Core state when upgrading from the previous split implementation", async function () {
    const [admin, user, other] = await ethers.getSigners();

    const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
    const points = await Points.deploy(admin.address, admin.address);
    await points.waitForDeployment();

    const Vrf = await ethers.getContractFactory("contracts/test/VRFCoordinatorV2PlusMock.sol:VRFCoordinatorV2PlusMock");
    const vrf = await Vrf.deploy();
    await vrf.waitForDeployment();

    const Router = await ethers.getContractFactory("contracts/DoudoVRFRouter.sol:DoudoVRFRouter");
    const router = await Router.deploy(await vrf.getAddress(), 123n, ethers.ZeroHash, 0, 2_500_000);
    await router.waitForDeployment();

    const OldCore = await ethers.getContractFactory(
      "contracts/test/DOUDOCHAINV2CoreUpgradeableV1Harness.sol:DOUDOCHAINV2CoreUpgradeableV1Harness"
    );
    const oldCore = await upgrades.deployProxy(OldCore, [await points.getAddress(), await router.getAddress()], {
      initializer: "initialize",
      kind: "uups",
    });
    await oldCore.waitForDeployment();
    await oldCore.seedForUpgrade(user.address, other.address);
    await points.grantRole(await points.BURNER_ROLE(), await oldCore.getAddress());
    await points.mint(user.address, ethers.parseEther("10"));

    expect(await oldCore.ownerOf(0)).to.equal(user.address);
    expect(await oldCore.mintedPerWallet(0, user.address)).to.equal(1);
    expect(await oldCore.luckyNumberUsed(0, 7)).to.equal(true);

    const Core = await ethers.getContractFactory(
      "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable"
    );
    const core = await upgrades.upgradeProxy(await oldCore.getAddress(), Core);
    await core.waitForDeployment();

    expect(await core.ownerOf(0)).to.equal(user.address);
    const seededStatus = await core.ticketStatusDetail(0);
    expect(seededStatus.seriesID).to.equal(0);
    expect(seededStatus.luckyNumber).to.equal(7);
    expect(await core.pointsPaid(0)).to.equal(ethers.parseEther("1"));
    expect(await core.tokenURI(0)).to.equal("ipfs://old-unreveal");

    expect(await core.seriesLockDuration(0)).to.equal(0);
    await core.setSeriesLockDuration(0, 30);
    expect(await core.seriesLockDuration(0)).to.equal(30);

    await core.connect(user).mint(0, [8]);
    expect(await core.ownerOf(1)).to.equal(user.address);
    expect((await core.ticketStatusDetail(1)).luckyNumber).to.equal(8);
    await expect(core.connect(user).mint(0, [9]))
      .to.be.revertedWithCustomError(core, "WalletCapExceeded");
    await expect(core.adminMint(user.address, 0, [7]))
      .to.be.revertedWithCustomError(core, "LuckyNumberTaken");
  });

  it("preserves Redraw module state when upgrading from the previous split implementation", async function () {
    const [admin, user, bundleModule] = await ethers.getSigners();

    const OldRedraw = await ethers.getContractFactory(
      "contracts/test/DoudoRedrawModuleUpgradeableV1Harness.sol:DoudoRedrawModuleUpgradeableV1Harness"
    );
    const oldRedraw = await upgrades.deployProxy(OldRedraw, [admin.address, user.address], {
      initializer: "initialize",
      kind: "uups",
    });
    await oldRedraw.waitForDeployment();
    await oldRedraw.seedForUpgrade(bundleModule.address, user.address);

    expect(await oldRedraw.bundleModule()).to.equal(bundleModule.address);
    expect((await oldRedraw.redrawConfigs(0)).mainBurnCount).to.equal(2);
    expect(await oldRedraw.consolationDrawBalances(0, user.address)).to.equal(3);

    const Redraw = await ethers.getContractFactory(
      "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable"
    );
    const redraw = await upgrades.upgradeProxy(await oldRedraw.getAddress(), Redraw);
    await redraw.waitForDeployment();

    expect(await redraw.core()).to.equal(admin.address);
    expect(await redraw.router()).to.equal(user.address);
    expect(await redraw.bundleModule()).to.equal(bundleModule.address);
    const config = await redraw.redrawConfigs(0);
    expect(config.mainBurnCount).to.equal(2);
    expect(config.consolationBurnCount).to.equal(1);
    const context = await redraw.requestContexts(77);
    expect(context.seriesID).to.equal(0);
    expect(context.user).to.equal(user.address);
    expect(context.consolation).to.equal(true);
    expect(await redraw.consolationDrawBalances(0, user.address)).to.equal(3);

    expect(await redraw.redrawEnabled(0)).to.equal(false);
    await redraw.setRedrawEnabled(0, true);
    expect(await redraw.redrawEnabled(0)).to.equal(true);
    await redraw.setConsolationPrizes(0, [{
      subPrizeID: 9001,
      prizeGroup: "Z",
      subPrizeName: "Upgrade Consolation",
      subPrizeRemainingQuantity: 1,
    }]);
    const prizes = await redraw.getConsolationPrizes(0);
    expect(prizes[0].subPrizeID).to.equal(9001);
  });

  it("allows operations to update the Redraw router after a router redeploy", async function () {
    const { admin, user, redraw } = await deploySplitSuite();
    const Vrf = await ethers.getContractFactory("contracts/test/VRFCoordinatorV2PlusMock.sol:VRFCoordinatorV2PlusMock");
    const nextVrf = await Vrf.deploy();
    await nextVrf.waitForDeployment();
    const Router = await ethers.getContractFactory("contracts/DoudoVRFRouter.sol:DoudoVRFRouter");
    const nextRouter = await Router.deploy(await nextVrf.getAddress(), 456n, ethers.ZeroHash, 0, 2_500_000);
    await nextRouter.waitForDeployment();

    await expect(redraw.setRouter(await nextRouter.getAddress()))
      .to.emit(redraw, "RouterUpdated")
      .withArgs(await nextRouter.getAddress());
    expect(await redraw.router()).to.equal(await nextRouter.getAddress());
    await expect(redraw.connect(user).setRouter(admin.address))
      .to.be.revertedWithCustomError(redraw, "MissingRole");
  });

  it("collection NFT rewards mint with luckyNumber 0 even when the lucky-number series is sold out", async function () {
    const { user, other, points, core, reward } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: true, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    // Sell out the series: both lucky numbers (1 and 2) get consumed.
    await core.connect(user).mint(0, [1, 2]);
    // Confirm sold out (no inventory left).
    await expect(core.connect(user).mint(0, [1]))
      .to.be.revertedWithCustomError(core, "NotEnoughNFTsRemaining");

    // Stand in for the CollectionBook caller.
    await reward.setCollectionBook(other.address);
    await reward.setCollectionRewardConfig(1, {
      rewardKind: 0, // NftPrize
      pointsAmount: 0,
      seriesID: 0,
      prizeID: 2,
      active: true,
    });

    const rewardTokenId = 2n; // tokens 0 and 1 were the sold-out mints
    await expect(reward.connect(other).mintCollectionReward(user.address, 1))
      .to.emit(reward, "CollectionRewardMinted")
      .withArgs(1, user.address, 0, 1, rewardTokenId);

    expect(await core.ownerOf(rewardTokenId)).to.equal(user.address);
    const status = await core.ticketStatusDetail(rewardTokenId);
    expect(status.tokenRevealed).to.equal(true);
    expect(status.tokenRevealedPrize).to.equal(2);
    // Rewards do not occupy a lucky number (mirrors last-prize tokens).
    expect(status.luckyNumber).to.equal(0);
  });

  it("consolation draws mint with luckyNumber 0 for lucky-number series even after sellout", async function () {
    const { user, points, vrf, router, core, bundle, redraw } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: true, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await redraw.setConsolationPrizes(0, [{
      subPrizeID: 9001,
      prizeGroup: "Z",
      subPrizeName: "Consolation",
      subPrizeRemainingQuantity: 5,
    }]);
    await bundle.setSeriesBundles(0, [{
      bundleID: 1,
      ticketQuantity: 2,
      priceInPoints: ethers.parseEther("2"),
      rebatePoints: 0,
      consolationDrawCredits: 1,
      active: true,
    }]);
    // Bundle mint sells out the series and consumes lucky numbers 1 and 2.
    await bundle.connect(user).mintBundle(0, 1, 1);
    // Confirm sold out (no inventory left).
    await expect(core.connect(user).mint(0, [1]))
      .to.be.revertedWithCustomError(core, "NotEnoughNFTsRemaining");

    await redraw.connect(user).drawConsolation(0);
    await expect(vrf.fulfill(await router.getAddress(), 1, [42]))
      .to.emit(redraw, "RedrawFulfilled")
      .withArgs(1, 0, user.address, 2, true);

    const status = await core.ticketStatusDetail(2);
    expect(status.tokenRevealed).to.equal(true);
    expect(status.tokenRevealedPrize).to.equal(9001);
    expect(status.luckyNumber).to.equal(0);
  });

  it("collection NFT rewards still mint with luckyNumber 0 when the series does not use lucky numbers", async function () {
    const { user, other, core, reward } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 6, useLuckyNumber: false, maxPerWallet: 0 });

    await reward.setCollectionBook(other.address);
    await reward.setCollectionRewardConfig(1, {
      rewardKind: 0, // NftPrize
      pointsAmount: 0,
      seriesID: 0,
      prizeID: 2,
      active: true,
    });

    await expect(reward.connect(other).mintCollectionReward(user.address, 1))
      .to.emit(reward, "CollectionRewardMinted")
      .withArgs(1, user.address, 0, 1, 0n);

    const status = await core.ticketStatusDetail(0);
    expect(status.tokenRevealed).to.equal(true);
    expect(status.tokenRevealedPrize).to.equal(2);
    expect(status.luckyNumber).to.equal(0);
  });
});
