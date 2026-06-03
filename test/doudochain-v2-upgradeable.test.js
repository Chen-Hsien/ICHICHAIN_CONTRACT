const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const SIXTY_DAYS = 60 * 24 * 60 * 60;

function prizeTable(total = 5) {
  return [
    { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 2 },
    { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: total - 2 },
  ];
}

function seriesInput(overrides = {}) {
  return {
    seriesName: "Upgradeable Series",
    totalTicketNumbers: 5,
    priceInPoints: ethers.parseEther("2"),
    priceInTWD: 88,
    estimateDeliverTime: 1780000000,
    exchangeTokenURI: "ipfs://exchange/",
    unrevealTokenURI: "ipfs://unreveal",
    revealTokenURI: "ipfs://reveal/",
    seriesMetaDataURI: "ipfs://series",
    isPreOrder: false,
    useLuckyNumber: true,
    maxPerWallet: 1,
    ...overrides,
  };
}

async function deployUpgradeableCore(options = {}) {
  const [admin, user, other] = await ethers.getSigners();

  const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
  const points = await Points.deploy(admin.address, admin.address);
  await points.waitForDeployment();

  let vrf;
  let vrfCoordinator = admin.address;
  if (options.useMockVrf) {
    const Vrf = await ethers.getContractFactory("contracts/test/VRFCoordinatorV2PlusMock.sol:VRFCoordinatorV2PlusMock");
    vrf = await Vrf.deploy();
    await vrf.waitForDeployment();
    vrfCoordinator = await vrf.getAddress();
  }

  const subscriptionId = 123n;
  const keyHash = ethers.keccak256(ethers.toUtf8Bytes("arb-sepolia-keyhash"));
  const requestConfirmations = 0;

  const Core = await ethers.getContractFactory(
    "contracts/DOUDOCHAINV2Upgradeable.sol:DOUDOCHAINV2Upgradeable"
  );
  const core = await upgrades.deployProxy(
    Core,
    [
      await points.getAddress(),
      vrfCoordinator,
      subscriptionId,
      keyHash,
      requestConfirmations,
    ],
    { initializer: "initialize", kind: "uups" }
  );
  await core.waitForDeployment();

  return {
    admin,
    user,
    other,
    points,
    core,
    vrf,
    vrfCoordinator,
    subscriptionId,
    keyHash,
    requestConfirmations,
  };
}

describe("DOUDOCHAINV2Upgradeable proxy", function () {
  it("deploys through a UUPS proxy and initializes official ops roles", async function () {
    const {
      admin,
      points,
      core,
      vrfCoordinator,
      subscriptionId,
      keyHash,
      requestConfirmations,
    } = await deployUpgradeableCore();

    expect(await core.name()).to.equal("DOUDOCHAINV2");
    expect(await core.symbol()).to.equal("DOUDOV2");
    expect(await core.doudoPoints()).to.equal(await points.getAddress());
    expect(await core.vrfCoordinator()).to.equal(vrfCoordinator);
    expect(await core.subscriptionId()).to.equal(subscriptionId);
    expect(await core.keyHash()).to.equal(keyHash);
    expect(await core.requestConfirmations()).to.equal(requestConfirmations);
    expect(await core.callbackGasLimit()).to.equal(2_500_000);

    expect(await core.hasRole(await core.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await core.hasRole(await core.UPGRADER_ROLE(), admin.address)).to.equal(true);
    expect(await core.hasRole(await core.OPERATION_ROLE(), admin.address)).to.equal(true);
    expect(await core.hasRole(await core.ADMINMINT_ROLE(), admin.address)).to.equal(true);
    expect(await core.hasRole(await core.COLLECTION_BOOK_ROLE(), admin.address)).to.equal(true);
  });

  it("rejects proxy re-initialization", async function () {
    const { core, points, vrfCoordinator, subscriptionId, keyHash } = await deployUpgradeableCore();

    await expect(
      core.initialize(await points.getAddress(), vrfCoordinator, subscriptionId, keyHash, 0)
    ).to.be.reverted;
  });

  it("requires UPGRADER_ROLE for UUPS proxy upgrades", async function () {
    const { core, user } = await deployUpgradeableCore();
    const proxyAddress = await core.getAddress();
    const implementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);

    await expect(core.connect(user).upgradeTo(implementation))
      .to.be.revertedWithCustomError(core, "MissingRole")
      .withArgs(await core.UPGRADER_ROLE(), user.address);

    await expect(core.upgradeTo(implementation))
      .to.emit(core, "Upgraded")
      .withArgs(implementation);
    expect(await core.name()).to.equal("DOUDOCHAINV2");
  });
});

describe("DOUDOCHAINV2Upgradeable series and AdminMint", function () {
  it("creates a series atomically and emits the legacy-compatible NewSeries payload", async function () {
    const { core } = await deployUpgradeableCore();
    const input = seriesInput({ seriesName: "Legacy Event Series" });

    await expect(core.createSeriesWithSubPrizes(input, prizeTable(5), false))
      .to.emit(core, "NewSeries")
      .withArgs(
        0,
        "Legacy Event Series",
        5,
        5,
        input.priceInPoints,
        88,
        false,
        1780000000,
        1780000000 + SIXTY_DAYS,
        "ipfs://exchange/",
        "ipfs://unreveal",
        "ipfs://reveal/",
        "ipfs://series",
        ethers.ZeroAddress,
        false,
        false
      )
      .and.to.emit(core, "NewSubPrize")
      .withArgs(0, 1, "A", "A1", 2);

    const series = await core.doudoSeries(0);
    expect(series.seriesName).to.equal("Legacy Event Series");
    expect(series.totalTicketNumbers).to.equal(5);
    expect(series.remainingTicketNumbers).to.equal(5);
    expect(series.priceInPoints).to.equal(input.priceInPoints);
    expect(series.isGoodsArrived).to.equal(false);

    const uris = await core.seriesURIs(0);
    expect(uris.exchangeTokenURI).to.equal("ipfs://exchange/");
    expect(uris.unrevealTokenURI).to.equal("ipfs://unreveal");
    expect(uris.revealTokenURI).to.equal("ipfs://reveal/");
    expect(uris.seriesMetaDataURI).to.equal("ipfs://series");

    const subPrizes = await core.getSubPrizesDetail(0);
    expect(subPrizes).to.have.length(2);
    expect(subPrizes[0].subPrizeName).to.equal("A1");
  });

  it("batch creates series with independent goods-arrived flags", async function () {
    const { core } = await deployUpgradeableCore();
    const first = seriesInput({ seriesName: "Batch Upgradeable 1" });
    const second = seriesInput({ seriesName: "Batch Upgradeable 2", useLuckyNumber: false });

    await core.batchCreateSeriesWithSubPrizes(
      [first, second],
      [prizeTable(5), prizeTable(5)],
      [true, false]
    );

    expect((await core.doudoSeries(0)).seriesName).to.equal("Batch Upgradeable 1");
    expect((await core.doudoSeries(0)).isGoodsArrived).to.equal(true);
    expect((await core.doudoSeries(1)).seriesName).to.equal("Batch Upgradeable 2");
    expect((await core.doudoSeries(1)).isGoodsArrived).to.equal(false);
  });

  it("adminMints tickets without points burn, wallet cap, or mint lock side effects", async function () {
    const { admin, user, points, core } = await deployUpgradeableCore();
    await core.createSeriesWithSubPrizes(seriesInput(), prizeTable(5), true);

    await expect(core.adminMint(user.address, 0, [1, 2]))
      .to.emit(core, "NewTicketStatus")
      .withArgs(0, 0, 0, false, false, user.address, 1)
      .and.to.emit(core, "UpdateSeriesRemainingTicketNumbers")
      .withArgs(0, 3)
      .and.to.emit(core, "AdminMinted")
      .withArgs(admin.address, user.address, 0, 2);

    expect(await points.balanceOf(user.address)).to.equal(0);
    expect(await core.ownerOf(0)).to.equal(user.address);
    expect(await core.ownerOf(1)).to.equal(user.address);
    expect((await core.ticketStatusDetail(0)).luckyNumber).to.equal(1);
    expect((await core.ticketStatusDetail(1)).luckyNumber).to.equal(2);
    expect(await core.luckyNumberUsed(0, 1)).to.equal(true);
    expect(await core.luckyNumberUsed(0, 2)).to.equal(true);
    expect(await core.mintedPerWallet(0, user.address)).to.equal(0);
    expect(await core.mintLockOwner(0)).to.equal(ethers.ZeroAddress);
    expect(await core.totalMintedInSeries(0)).to.equal(2);

    const series = await core.doudoSeries(0);
    expect(series.remainingTicketNumbers).to.equal(3);
  });

  it("keeps metadata editable after goods arrival", async function () {
    const { core } = await deployUpgradeableCore();
    await core.createSeriesWithSubPrizes(seriesInput({ seriesName: "Arrived Metadata" }), prizeTable(5), true);

    await expect(
      core.setSeriesMetadata(
        0,
        "ipfs://exchange-v2/",
        "ipfs://unreveal-v2",
        "ipfs://reveal-v2/",
        "ipfs://series-v2"
      )
    )
      .to.emit(core, "UpdateSeriesInformation")
      .withArgs(
        0,
        true,
        anyValue,
        anyValue,
        "ipfs://exchange-v2/",
        "ipfs://unreveal-v2",
        "ipfs://reveal-v2/",
        "ipfs://series-v2"
      );

    const uris = await core.seriesURIs(0);
    expect(uris.exchangeTokenURI).to.equal("ipfs://exchange-v2/");
    expect(uris.unrevealTokenURI).to.equal("ipfs://unreveal-v2");
    expect(uris.revealTokenURI).to.equal("ipfs://reveal-v2/");
    expect(uris.seriesMetaDataURI).to.equal("ipfs://series-v2");
  });

  it("emits luckyNumber on NewTicketStatus and remaining-ticket updates for paid mints", async function () {
    const { user, points, core } = await deployUpgradeableCore();
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("10"));
    await core.createSeriesWithSubPrizes(seriesInput({ maxPerWallet: 2 }), prizeTable(5), true);

    await expect(core.connect(user).mint(0, [3]))
      .to.emit(core, "NewTicketStatus")
      .withArgs(0, 0, 0, false, false, user.address, 3)
      .and.to.emit(core, "UpdateSeriesRemainingTicketNumbers")
      .withArgs(0, 4);

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("8"));
    expect(await core.mintedPerWallet(0, user.address)).to.equal(1);
    expect(await core.mintLockOwner(0)).to.equal(user.address);
    expect(await core.pointsPaid(0)).to.equal(ethers.parseEther("2"));
  });
});

describe("DOUDOCHAINV2Upgradeable VRF, reveal, redraw, and last prize", function () {
  it("updates VRF config and lets pending requests fulfill from their recorded coordinator", async function () {
    const { admin, user, points, core, vrf } = await deployUpgradeableCore({ useMockVrf: true });
    const Vrf = await ethers.getContractFactory("contracts/test/VRFCoordinatorV2PlusMock.sol:VRFCoordinatorV2PlusMock");
    const nextVrf = await Vrf.deploy();
    await nextVrf.waitForDeployment();
    const nextKeyHash = ethers.keccak256(ethers.toUtf8Bytes("next-keyhash"));

    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("10"));
    await core.createSeriesWithSubPrizes(
      seriesInput({ totalTicketNumbers: 2, priceInPoints: ethers.parseEther("1"), useLuckyNumber: false, maxPerWallet: 0 }),
      prizeTable(2),
      true
    );
    await core.connect(user).mint(0, [0, 0]);

    await expect(core.connect(user).reveal(0, [0, 1]))
      .to.emit(core, "RevealDrawSent")
      .withArgs(1, [0, 1]);

    await expect(core.setVrfConfig(await nextVrf.getAddress(), 456n, nextKeyHash, 1_900_000, 0))
      .to.emit(core, "VrfConfigUpdated")
      .withArgs(await nextVrf.getAddress(), 456n, nextKeyHash, 1_900_000, 0, admin.address);

    await expect(vrf.fulfill(await core.getAddress(), 1, [123]))
      .to.emit(core, "RevealDrawFulfilled")
      .withArgs(1, 0, [123]);

    expect(await core.vrfCoordinator()).to.equal(await nextVrf.getAddress());
    expect(await core.subscriptionId()).to.equal(456n);
    expect(await core.keyHash()).to.equal(nextKeyHash);
    expect(await core.callbackGasLimit()).to.equal(1_900_000);
    expect(await core.requestConfirmations()).to.equal(0);
  });

  it("rejects rawFulfillRandomWords from non-coordinator callers", async function () {
    const { user, core } = await deployUpgradeableCore({ useMockVrf: true });

    await expect(core.connect(user).rawFulfillRandomWords(999, [123]))
      .to.be.revertedWithCustomError(core, "OnlyVrfCoordinator");
  });

  it("reveals prizes through VRF and emits legacy-compatible reveal events", async function () {
    const { user, points, core, vrf } = await deployUpgradeableCore({ useMockVrf: true });
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("10"));
    await core.createSeriesWithSubPrizes(
      seriesInput({ totalTicketNumbers: 2, priceInPoints: ethers.parseEther("1"), useLuckyNumber: false, maxPerWallet: 0 }),
      [
        { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 1 },
        { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: 1 },
      ],
      true
    );
    await core.connect(user).mint(0, [0, 0]);

    await expect(core.connect(user).reveal(0, [0, 1]))
      .to.emit(core, "RevealDrawSent")
      .withArgs(1, [0, 1]);

    await expect(vrf.fulfill(await core.getAddress(), 1, [123]))
      .to.emit(core, "RevealDrawFulfilled")
      .withArgs(1, 0, [123])
      .and.to.emit(core, "UpdatePrize")
      .withArgs(0, anyValue, anyValue)
      .and.to.emit(core, "UpdateTicketStatus")
      .withArgs(0, 0, anyValue, false, true);

    const first = await core.ticketStatusDetail(0);
    const second = await core.ticketStatusDetail(1);
    expect(first.tokenRevealed).to.equal(true);
    expect(second.tokenRevealed).to.equal(true);
    expect([Number(first.tokenRevealedPrize), Number(second.tokenRevealedPrize)].sort()).to.deep.equal([1, 2]);
  });

  it("redraws main prizes through VRF and chooses last-prize winners", async function () {
    const { user, points, core, vrf } = await deployUpgradeableCore({ useMockVrf: true });
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("10"));
    await core.createSeriesWithSubPrizes(
      seriesInput({ totalTicketNumbers: 3, priceInPoints: ethers.parseEther("1"), useLuckyNumber: false, maxPerWallet: 0 }),
      [
        { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 1 },
        { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: 2 },
      ],
      true
    );
    await core.connect(user).mint(0, [0, 0]);
    await core.connect(user).reveal(0, [0]);
    await vrf.fulfill(await core.getAddress(), 1, [123]);
    await core.setRedrawConfig(0, 1, 0);

    await expect(core.connect(user).redrawMain(0, [0]))
      .to.emit(core, "RedrawRequested")
      .withArgs(2, 0, user.address, false);
    await expect(core.ownerOf(0)).to.be.reverted;

    await expect(vrf.fulfill(await core.getAddress(), 2, [456]))
      .to.emit(core, "UpdateTicketStatus")
      .withArgs(2, 0, anyValue, false, true);
    expect(await core.ownerOf(2)).to.equal(user.address);

    await expect(core.chooseLastPrizeWinner(0, 1))
      .to.emit(core, "LastPrizeDraw")
      .withArgs(3, 0, 1);
    await expect(vrf.fulfill(await core.getAddress(), 3, [0]))
      .to.emit(core, "LastPrizeWinner")
      .withArgs(3, [0])
      .and.to.emit(core, "UpdateSeriesLastPrizeOwner")
      .withArgs(0, [user.address]);

    expect(await core.lastPrizeOwners(0, 0)).to.equal(user.address);
    expect((await core.ticketStatusDetail(3)).tokenRevealedPrize).to.equal(999);
  });
});
