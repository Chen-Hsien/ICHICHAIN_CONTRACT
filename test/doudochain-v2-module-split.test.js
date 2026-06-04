const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

function prizeTable(total = 6) {
  return [
    { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 10 },
    { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: total - 50 },
    { subPrizeID: 3, prizeGroup: "C", subPrizeName: "C1", subPrizeRemainingQuantity: 10 },
    { subPrizeID: 4, prizeGroup: "D", subPrizeName: "D1", subPrizeRemainingQuantity: 30 },
  ];
}

function seriesInput(overrides = {}) {
  return {
    seriesName: "Split Module Series",
    totalTicketNumbers: 60,
    priceInPoints: ethers.parseEther("10"),
    priceInTWD: 300,
    estimateDeliverTime: 178,
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
  const [admin, user, other] = await ethers.getSigners();

  const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
  const points = await Points.deploy(admin.address, admin.address);
  await points.waitForDeployment();

  const Vrf = await ethers.getContractFactory("contracts/test/VRFCoordinatorV2PlusMock.sol:VRFCoordinatorV2PlusMock");
  const vrf = await Vrf.deploy();
  await vrf.waitForDeployment();

  const subscriptionId = 123n;
  const keyHash = ethers.keccak256(ethers.toUtf8Bytes("arb-sepolia-keyhash"));
  const requestConfirmations = 0;
  const callbackGasLimit = 2_500_000;

  const Router = await ethers.getContractFactory("contracts/DoudoVRFRouter.sol:DoudoVRFRouter");
  const router = await Router.deploy(
    await vrf.getAddress(),
    subscriptionId,
    keyHash,
    requestConfirmations,
    callbackGasLimit
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

  const Book = await ethers.getContractFactory(
    "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable"
  );
  const book = await upgrades.deployProxy(Book, [await points.getAddress()], {
    initializer: "initialize",
    kind: "uups",
  });
  await book.waitForDeployment();

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
  await points.grantRole(await points.MINTER_ROLE(), await book.getAddress());
  await bundle.setRedrawModule(await redraw.getAddress());
  await redraw.setBundleModule(await bundle.getAddress());
  await reward.setCollectionBook(await book.getAddress());
  await book.setDoudochainV2RewardTarget(await reward.getAddress());

  return {
    admin,
    user,
    other,
    points,
    vrf,
    router,
    core,
    bundle,
    refund,
    redraw,
    reward,
    book,
  };
}

async function createSeries(core, overrides = {}) {
  const tx = await core.createSeriesWithSubPrizes(seriesInput(overrides), prizeTable(60), true);
  await tx.wait();
}

async function issuePoints(points, to, amount = ethers.parseEther("1000")) {
  await points.mint(to, amount);
}

describe("DOUDOCHAIN V2 split module suite", function () {
  it("wires the split suite with router consumer, core module roles, and collection reward target", async function () {
    const { admin, points, router, core, bundle, refund, redraw, reward, book } = await deploySplitSuite();

    expect(await core.doudoPoints()).to.equal(await points.getAddress());
    expect(await core.vrfRouter()).to.equal(await router.getAddress());
    expect(await router.isRequester(await core.getAddress())).to.equal(true);
    expect(await router.isRequester(await redraw.getAddress())).to.equal(true);
    expect(await core.hasRole(await core.MODULE_ROLE(), await bundle.getAddress())).to.equal(true);
    expect(await core.hasRole(await core.MODULE_ROLE(), await refund.getAddress())).to.equal(true);
    expect(await core.hasRole(await core.MODULE_ROLE(), await redraw.getAddress())).to.equal(true);
    expect(await core.hasRole(await core.MODULE_ROLE(), await reward.getAddress())).to.equal(true);
    expect(await book.doudochainV2RewardTarget()).to.equal(await reward.getAddress());
    expect(await core.hasRole(await core.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
  });

  it("reveals through the Chainlink router and settles in the same transaction", async function () {
    const { user, points, vrf, router, core } = await deploySplitSuite();
    await createSeries(core, { useLuckyNumber: true });
    await issuePoints(points, user.address);

    await core.connect(user).mint(0, [1, 2]);

    await expect(core.connect(user).reveal(0, [0, 1]))
      .to.emit(core, "RevealDrawSent")
      .withArgs(1, [0, 1])
      .and.to.emit(router, "VrfRandomWordsRequested")
      .withArgs(1, await core.getAddress(), await core.getAddress(), 1);

    await expect(vrf.fulfill(await router.getAddress(), 1, [123456]))
      .to.emit(router, "VrfRandomWordsFulfilled")
      .withArgs(1, await core.getAddress())
      .and.to.emit(core, "RevealDrawFulfilled")
      .withArgs(1, 0, [123456])
      .and.to.emit(core, "UpdateTicketStatus");

    const firstTicket = await core.ticketStatusDetail(0);
    expect(firstTicket.tokenRevealed).to.equal(true);
    expect(firstTicket.luckyNumber).to.be.greaterThan(0);
  });

  it("mints bundles through the bundle module while Core emits canonical ticket events", async function () {
    const { user, points, core, bundle } = await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);

    await bundle.setSeriesBundles(0, [
      {
        bundleID: 1,
        ticketQuantity: 3,
        priceInPoints: ethers.parseEther("25"),
        rebatePoints: ethers.parseEther("2"),
        consolationDrawCredits: 1,
        active: true,
      },
    ]);

    await expect(bundle.connect(user).mintBundle(0, 1, 1))
      .to.emit(bundle, "BundleMinted")
      .withArgs(0, 1, user.address, 1, anyValue)
      .and.to.emit(core, "NewTicketStatus");

    expect(await core.balanceOf(user.address)).to.equal(3);
    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("977"));
  });

  it("claims refunds through the refund module and burns tickets through Core", async function () {
    const { user, points, core, refund } = await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0]);

    await refund.setSeriesRefund(0, true, ethers.parseEther("8"));

    await expect(refund.connect(user).claimRefund([0, 1]))
      .to.emit(refund, "RefundClaimed")
      .withArgs(0, user.address, [0, 1], ethers.parseEther("20"))
      .and.to.emit(core, "UpdateTicketStatus");

    await expect(core.ownerOf(0)).to.be.reverted;
    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("1000"));
  });

  it("redraws main prizes by burning revealed tickets and minting unrevealed replacements", async function () {
    const { user, points, vrf, router, core, redraw } = await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0]);
    await core.connect(user).reveal(0, [0, 1]);
    await vrf.fulfill(await router.getAddress(), 1, [777]);
    await redraw.setRedrawConfig(0, 2, 0);

    await expect(redraw.connect(user).redrawMain(0, [0, 1]))
      .to.emit(redraw, "RedrawMinted")
      .withArgs(0, user.address, 2, 2)
      .and.to.emit(core, "NewTicketStatus");

    await expect(core.ownerOf(0)).to.be.reverted;
    await expect(core.ownerOf(1)).to.be.reverted;
    expect(await core.ownerOf(2)).to.equal(user.address);
    expect(await core.ownerOf(3)).to.equal(user.address);
    expect((await core.ticketStatusDetail(2)).tokenRevealed).to.equal(false);
    expect(await core.balanceOf(user.address)).to.equal(2);
  });

  it("claims collection rewards through the collection reward module", async function () {
    const { user, points, vrf, router, core, reward, book } = await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0]);
    await core.connect(user).reveal(0, [0]);
    await vrf.fulfill(await router.getAddress(), 1, [1]);

    const revealed = await core.ticketStatusDetail(0);
    await reward.setCollectionRewardConfig(0, {
      rewardKind: 1,
      pointsAmount: ethers.parseEther("15"),
      seriesID: 0,
      prizeID: 0,
      active: true,
    });
    await book.createBook(
      "One prize book",
      [{ sourceContract: await core.getAddress(), seriesID: 0, prizeId: revealed.tokenRevealedPrize, quantity: 1 }],
      1,
      0,
      true
    );

    await core.connect(user).approve(await book.getAddress(), 0);
    await book.connect(user).depositToBook(0, [0]);

    await expect(book.connect(user).claimBook(0))
      .to.emit(book, "CollectionBookClaimed")
      .withArgs(user.address, 0, 1, 0)
      .and.to.emit(reward, "CollectionRewardMinted")
      .withArgs(0, user.address, 1, ethers.parseEther("15"), 0);

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("1005"));
  });
});
