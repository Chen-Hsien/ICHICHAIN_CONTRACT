const { expect } = require("chai");
const { ethers } = require("hardhat");

function prizeTable(total = 10) {
  return [
    { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 2 },
    { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: total - 2 },
  ];
}

function seriesInput(overrides = {}) {
  return {
    seriesName: "Atomic Series",
    totalTicketNumbers: 10,
    priceInPoints: ethers.parseEther("3"),
    priceInTWD: 100,
    estimateDeliverTime: 1780000000,
    exchangeTokenURI: "ipfs://exchange/",
    unrevealTokenURI: "ipfs://unreveal",
    revealTokenURI: "ipfs://reveal/",
    seriesMetaDataURI: "ipfs://series",
    isPreOrder: false,
    useLuckyNumber: true,
    maxPerWallet: 3,
    packingType: 1,
    sourceType: 1,
    ...overrides,
  };
}

async function deployCore(options = {}) {
  const [admin, user, other, collectionBook] = await ethers.getSigners();
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

  const Core = await ethers.getContractFactory("contracts/DOUDOCHAINV2.sol:DOUDOCHAINV2");
  const core = await Core.deploy(await points.getAddress(), vrfCoordinator, 0, ethers.ZeroHash, 0);
  await core.waitForDeployment();

  return { admin, user, other, collectionBook, points, core, vrf };
}

describe("DOUDOCHAINV2 core", function () {
  it("creates a series with subprizes atomically", async function () {
    const { core } = await deployCore();

    await expect(core.createSeriesWithSubPrizes(seriesInput(), prizeTable(10), true))
      .to.emit(core, "NewSeries")
      .withArgs(0, "Atomic Series");

    const series = await core.doudoSeries(0);
    expect(series.seriesName).to.equal("Atomic Series");
    expect(series.totalTicketNumbers).to.equal(10);
    expect(series.remainingTicketNumbers).to.equal(10);
    expect(series.priceInPoints).to.equal(ethers.parseEther("3"));
    expect(series.isGoodsArrived).to.equal(true);
    expect(series.packingType).to.equal(1);
    expect(series.sourceType).to.equal(1);
  });

  it("batch creates multiple series and keeps metadata editable after arrival", async function () {
    const { core } = await deployCore();
    const first = seriesInput({ seriesName: "Batch 1", useLuckyNumber: false });
    const second = seriesInput({ seriesName: "Batch 2", useLuckyNumber: false });

    await core.batchCreateSeriesWithSubPrizes(
      [first, second],
      [prizeTable(10), prizeTable(10)],
      [true, false]
    );

    expect((await core.doudoSeries(0)).seriesName).to.equal("Batch 1");
    expect((await core.doudoSeries(1)).seriesName).to.equal("Batch 2");
    expect((await core.doudoSeries(0)).isGoodsArrived).to.equal(true);
    expect((await core.doudoSeries(1)).isGoodsArrived).to.equal(false);

    await core.setSeriesMetadata(
      0,
      "ipfs://exchange-v2/",
      "ipfs://unreveal-v2",
      "ipfs://reveal-v2/",
      "ipfs://series-v2"
    );

    const metadata = await core.seriesURIs(0);
    expect(metadata.exchangeTokenURI).to.equal("ipfs://exchange-v2/");
    expect(metadata.unrevealTokenURI).to.equal("ipfs://unreveal-v2");
    expect(metadata.revealTokenURI).to.equal("ipfs://reveal-v2/");
    expect(metadata.seriesMetaDataURI).to.equal("ipfs://series-v2");
  });

  it("burns points, enforces reservation, lucky-number uniqueness, and wallet cap", async function () {
    const { admin, user, other, points, core } = await deployCore();
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("100"));
    await points.mint(other.address, ethers.parseEther("100"));
    await core.createSeriesWithSubPrizes(seriesInput({ seriesName: "Lucky Series" }), prizeTable(10), true);

    await expect(core.connect(user).mint(0, [2, 3]))
      .to.emit(core, "NewTicketStatus")
      .withArgs(0, 0, 0, false, false, user.address, 2);

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("94"));
    expect(await core.ownerOf(0)).to.equal(user.address);
    expect(await core.ownerOf(1)).to.equal(user.address);
    expect((await core.ticketStatusDetail(0)).seriesID).to.equal(0);
    expect((await core.ticketStatusDetail(0)).luckyNumber).to.equal(2);
    expect(await core.mintedPerWallet(0, user.address)).to.equal(2);
    expect(await core.mintLockOwner(0)).to.equal(user.address);

    await expect(core.connect(other).mint(0, [4]))
      .to.be.revertedWithCustomError(core, "SeriesReserved");

    await expect(core.connect(user).mint(0, [2]))
      .to.be.revertedWithCustomError(core, "LuckyNumberTaken");

    await expect(core.connect(user).mint(0, [4, 5]))
      .to.be.revertedWithCustomError(core, "WalletCapExceeded");

    expect(await points.balanceOf(other.address)).to.equal(ethers.parseEther("100"));
    expect(await core.hasRole(await core.OPERATION_ROLE(), admin.address)).to.equal(true);
  });

  it("uses a 10 minute default mint lock duration", async function () {
    const { core } = await deployCore();

    expect(await core.defaultLockDuration()).to.equal(600);
  });

  it("mints bundles atomically with point rebate and consolation entries", async function () {
    const { user, points, core } = await deployCore();
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.grantRole(await points.MINTER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("2000"));
    await core.createSeriesWithSubPrizes(
      seriesInput({
        seriesName: "Bundle Series",
        priceInPoints: ethers.parseEther("400"),
        useLuckyNumber: false,
        maxPerWallet: 0,
      }),
      prizeTable(10),
      true
    );
    await core.setSeriesBundles(0, [
      {
        quantity: 5,
        pricePoints: ethers.parseEther("1600"),
        rebatePoints: ethers.parseEther("100"),
        consolationDraws: 1,
      },
    ]);

    await expect(core.connect(user).mintBundle(0, 0, [0, 0, 0, 0, 0]))
      .to.emit(core, "BundleMinted")
      .withArgs(user.address, 0, 0, 5, ethers.parseEther("1600"), ethers.parseEther("100"), 1);

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("500"));
    expect(await core.consolationDraws(user.address)).to.equal(1);
    expect(await core.ownerOf(4)).to.equal(user.address);
    expect(await core.pointsPaid(0)).to.equal(ethers.parseEther("320"));
  });

  it("pauses new mints and refunds unrevealed tickets based on paid points", async function () {
    const { user, points, core } = await deployCore();
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.grantRole(await points.MINTER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("100"));
    await core.createSeriesWithSubPrizes(
      seriesInput({ seriesName: "Refund Series", useLuckyNumber: false, maxPerWallet: 0 }),
      prizeTable(10),
      true
    );
    await core.connect(user).mint(0, [0, 0]);
    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("94"));

    await core.pause();
    await expect(core.connect(user).mint(0, [0])).to.be.revertedWith("Pausable: paused");
    await core.unpause();

    await core.setSeriesRefund(0, true);
    await expect(core.connect(user).claimRefund([0, 1]))
      .to.emit(core, "RefundClaimed")
      .withArgs(user.address, 0, ethers.parseEther("6"), 2);

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
    await expect(core.ownerOf(0)).to.be.reverted;
    await expect(core.connect(user).claimRefund([0])).to.be.reverted;
  });

  it("rejects reveal batches above the hard cap and requires exact redraw burn counts", async function () {
    const { core } = await deployCore();
    await expect(core.reveal(0, Array(21).fill(0)))
      .to.be.revertedWithCustomError(core, "RevealBatchTooLarge");

    await core.setRedrawConfig(0, 8, 3);
    await expect(core.redrawMain(0, [1, 2, 3]))
      .to.be.revertedWithCustomError(core, "RedrawCountMismatch");
    await expect(core.redrawConsolation(0, [1, 2]))
      .to.be.revertedWithCustomError(core, "RedrawCountMismatch");
  });

  it("tracks series token ranges instead of pushing every token id", async function () {
    const { user, points, core } = await deployCore();
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("100"));
    await core.createSeriesWithSubPrizes(
      seriesInput({ seriesName: "Range Series", priceInPoints: ethers.parseEther("1"), useLuckyNumber: false, maxPerWallet: 0 }),
      prizeTable(10),
      true
    );

    await core.connect(user).mint(0, [0, 0, 0]);
    const range = await core.seriesRanges(0, 0);
    expect(range.start).to.equal(0);
    expect(range.end).to.equal(2);
    expect(await core.totalMintedInSeries(0)).to.equal(3);
  });

  it("chooses last-prize winners from ranges and rerolls burned token ids", async function () {
    const { user, other, points, core, vrf } = await deployCore({ useMockVrf: true });
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("100"));
    await points.mint(other.address, ethers.parseEther("100"));
    await core.createSeriesWithSubPrizes(
      seriesInput({
        seriesName: "Last Prize Series",
        totalTicketNumbers: 3,
        priceInPoints: ethers.parseEther("1"),
        useLuckyNumber: false,
        maxPerWallet: 0,
      }),
      [
        { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 1 },
        { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: 2 },
      ],
      true
    );

    await expect(core.chooseLastPrizeWinner(0, 1))
      .to.be.revertedWithCustomError(core, "NotSoldOutYet");

    await core.connect(user).mint(0, [0]);
    await ethers.provider.send("evm_increaseTime", [901]);
    await ethers.provider.send("evm_mine", []);
    await core.connect(other).mint(0, [0, 0]);
    await core.connect(user).reveal(0, [0]);
    await vrf.fulfill(await core.getAddress(), 1, [123]);
    await core.setRedrawConfig(0, 1, 0);
    await core.connect(user).redrawMain(0, [0]);
    await expect(core.ownerOf(0)).to.be.reverted;

    await expect(core.chooseLastPrizeWinner(0, 1))
      .to.emit(core, "LastPrizeDraw")
      .withArgs(3, 0, 1);
    await expect(core.chooseLastPrizeWinner(0, 1))
      .to.be.revertedWithCustomError(core, "AlreadyChoseWinner");

    await expect(vrf.fulfill(await core.getAddress(), 3, [0]))
      .to.emit(core, "NewTicketStatus")
      .withArgs(3, 0, 999, false, true, other.address, 0);

    expect(await core.ownerOf(3)).to.equal(other.address);
    expect(await core.lastPrizeOwners(0, 0)).to.equal(other.address);
    const status = await core.ticketStatusDetail(3);
    expect(status.seriesID).to.equal(0);
    expect(status.tokenRevealed).to.equal(true);
    expect(status.tokenRevealedPrize).to.equal(999);
    await expect(core.chooseLastPrizeWinner(0, 1))
      .to.be.revertedWithCustomError(core, "AlreadyChoseWinner");
  });

  it("lets the collection book role mint configured reward NFTs and unlock series", async function () {
    const { admin, user, core } = await deployCore();
    await core.createSeriesWithSubPrizes(
      seriesInput({
        seriesName: "Reward Series",
        totalTicketNumbers: 3,
        priceInPoints: ethers.parseEther("1"),
        useLuckyNumber: false,
        maxPerWallet: 0,
      }),
      prizeTable(3),
      true
    );
    await core.setCollectionRewardConfig(9001, 0, 1, true);

    await expect(core.mintCollectionReward(user.address, 9001))
      .to.emit(core, "CollectionRewardMinted")
      .withArgs(user.address, 9001, 0, 0, 1, true);

    const status = await core.ticketStatusDetail(0);
    expect(status.seriesID).to.equal(0);
    expect(status.tokenRevealedPrize).to.equal(1);
    expect(status.tokenRevealed).to.equal(true);
    expect(await core.ownerOf(0)).to.equal(user.address);

    await expect(core.unlockSeriesFor(user.address, 0))
      .to.emit(core, "SeriesUnlockedFor")
      .withArgs(user.address, 0, admin.address);
    expect(await core.seriesUnlockedFor(0, user.address)).to.equal(true);
  });

  it("settles reveal prizes inside the VRF callback", async function () {
    const { user, points, core, vrf } = await deployCore({ useMockVrf: true });
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("100"));
    await core.createSeriesWithSubPrizes(
      seriesInput({
        seriesName: "Reveal Series",
        totalTicketNumbers: 2,
        priceInPoints: ethers.parseEther("1"),
        useLuckyNumber: false,
        maxPerWallet: 0,
      }),
      [
        { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 1 },
        { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: 1 },
      ],
      true
    );
    await core.connect(user).mint(0, [0, 0]);

    await expect(core.connect(user).reveal(0, [0, 1]))
      .to.emit(core, "RevealRequested")
      .withArgs(1, 0, user.address, 2);
    expect((await core.ticketStatusDetail(0)).tokenRevealed).to.equal(false);

    await vrf.fulfill(await core.getAddress(), 1, [123]);

    const first = await core.ticketStatusDetail(0);
    const second = await core.ticketStatusDetail(1);
    expect(first.tokenRevealed).to.equal(true);
    expect(second.tokenRevealed).to.equal(true);
    expect([Number(first.tokenRevealedPrize), Number(second.tokenRevealedPrize)].sort()).to.deep.equal([1, 2]);
    await expect(core.connect(user).reveal(0, [0]))
      .to.be.revertedWithCustomError(core, "TokenAlreadyRevealed");
  });

  it("settles main redraw and consolation draws inside the VRF callback", async function () {
    const { user, points, core, vrf } = await deployCore({ useMockVrf: true });
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.grantRole(await points.MINTER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("100"));
    await core.createSeriesWithSubPrizes(
      seriesInput({
        seriesName: "Redraw Series",
        totalTicketNumbers: 6,
        priceInPoints: ethers.parseEther("1"),
        useLuckyNumber: false,
        maxPerWallet: 0,
      }),
      [
        { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 3 },
        { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: 3 },
      ],
      true
    );
    await core.connect(user).mint(0, [0, 0]);
    await core.connect(user).reveal(0, [0, 1]);
    await vrf.fulfill(await core.getAddress(), 1, [123]);
    await core.setRedrawConfig(0, 1, 1);

    await expect(core.connect(user).redrawMain(0, [0]))
      .to.emit(core, "RedrawRequested")
      .withArgs(2, 0, user.address, false);
    await expect(core.ownerOf(0)).to.be.reverted;
    await vrf.fulfill(await core.getAddress(), 2, [456]);
    expect(await core.ownerOf(2)).to.equal(user.address);
    expect((await core.ticketStatusDetail(2)).tokenRevealed).to.equal(true);

    await core.setSeriesBundles(0, [
      { quantity: 1, pricePoints: ethers.parseEther("1"), rebatePoints: 0, consolationDraws: 1 },
    ]);
    await core.connect(user).mintBundle(0, 0, [0]);
    expect(await core.consolationDraws(user.address)).to.equal(1);

    await expect(core.connect(user).drawConsolation(0))
      .to.emit(core, "RedrawRequested")
      .withArgs(3, 0, user.address, true);
    expect(await core.consolationDraws(user.address)).to.equal(0);
    await vrf.fulfill(await core.getAddress(), 3, [789]);
    expect(await core.ownerOf(4)).to.equal(user.address);
    expect((await core.ticketStatusDetail(4)).tokenRevealed).to.equal(true);
  });
});
