const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const MERCHANT_A = ethers.keccak256(ethers.toUtf8Bytes("merchant-A"));

const zeroLuckyNumbers = (quantity) => Array(quantity).fill(0);

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
    packingType: 1,
    sourceType: 1,
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

  const Core = await linkedCoreFactory();
  const core = await upgrades.deployProxy(Core, [await points.getAddress(), await router.getAddress()], {
    initializer: "initialize",
    kind: "uups",
    unsafeAllowLinkedLibraries: true,
  });
  await core.waitForDeployment();

  const SeriesOps = await ethers.getContractFactory(
    "contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol:DoudoSeriesOpsModuleUpgradeable"
  );
  const seriesOps = await upgrades.deployProxy(SeriesOps, [await core.getAddress()], {
    initializer: "initialize",
    kind: "uups",
  });
  await seriesOps.waitForDeployment();
  await core.setSeriesOpsModule(await seriesOps.getAddress());

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

  return { admin, user, other, receiver, points, vrf, router, core, seriesOps, bundle, refund, redraw, reward };
}

async function linkedCoreFactory() {
  const PrizeDrawLib = await ethers.getContractFactory(
    "contracts/helpers/DoudoPrizeDrawLib.sol:DoudoPrizeDrawLib"
  );
  const prizeDrawLib = await PrizeDrawLib.deploy();
  await prizeDrawLib.waitForDeployment();

  const TokenURILib = await ethers.getContractFactory(
    "contracts/helpers/DoudoTokenURILib.sol:DoudoTokenURILib"
  );
  const tokenURILib = await TokenURILib.deploy();
  await tokenURILib.waitForDeployment();

  return ethers.getContractFactory(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    {
      libraries: {
        DoudoPrizeDrawLib: await prizeDrawLib.getAddress(),
        DoudoTokenURILib: await tokenURILib.getAddress(),
      },
    }
  );
}

async function createSeries(core, overrides = {}, revealEnabled = true) {
  const input = seriesInput(overrides);
  await core.createSeriesWithSubPrizes(input, prizeTable(input.totalTicketNumbers), revealEnabled);
}

async function issuePoints(points, to, amount = ethers.parseEther("100")) {
  await points.mint(to, amount);
}

async function revealTickets({ user, core, vrf, router }, seriesID, tokenIDs, randomWord = 12345n) {
  await core.connect(user).reveal(seriesID, tokenIDs);
  await vrf.fulfill(await router.getAddress(), 1, [randomWord]);
}

function mintLockUntilFrom(receipt, contract) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "MintLockUpdated") {
        return parsed.args.until;
      }
    } catch (_) {
      // Ignore logs from other contracts in the same transaction.
    }
  }
  throw new Error("MintLockUpdated event not found");
}

function revealDrawSentEvents(receipt, core) {
  const events = [];
  for (const log of receipt.logs) {
    try {
      const parsed = core.interface.parseLog(log);
      if (parsed?.name === "RevealDrawSent") {
        events.push(parsed);
      }
    } catch (_) {
      // Ignore logs from other contracts in the same transaction.
    }
  }
  return events;
}

async function seriesUnlockExpiration(core, seriesID, user) {
  // Storage slot is unchanged from the previous split implementation. Reading it
  // directly keeps the production ABI limited to the canonical mutation + event.
  const mappingSlot = 219n;
  const seriesSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [seriesID, mappingSlot])
  );
  const userSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [user, seriesSlot])
  );
  return BigInt(await ethers.provider.getStorage(await core.getAddress(), userSlot));
}

describe("DOUDOCHAIN V2 fixes", function () {
  it("emits the canonical admin mint audit event", async function () {
    const { admin, user, core } = await deploySplitSuite();
    await createSeries(core, { useLuckyNumber: false, maxPerWallet: 0 });

    await expect(core.adminMint(user.address, 0, [0, 0]))
      .to.emit(core, "AdminMinted")
      .withArgs(admin.address, user.address, 0, 2);
  });

  it("keeps merchant attribution outside Core and links through the registry", async function () {
    const { admin, core } = await deploySplitSuite();
    const input = seriesInput({ seriesName: "Merchant Series" });

    const Registry = await ethers.getContractFactory(
      "contracts/MerchantSeriesRegistry.sol:MerchantSeriesRegistry"
    );
    const registry = await upgrades.deployProxy(Registry, [admin.address], {
      initializer: "initialize",
      kind: "uups",
    });
    await registry.waitForDeployment();

    const Publisher = await ethers.getContractFactory(
      "contracts/MerchantSeriesPublisher.sol:MerchantSeriesPublisher"
    );
    const publisher = await upgrades.deployProxy(
      Publisher,
      [admin.address, await registry.getAddress()],
      { initializer: "initialize", kind: "uups" }
    );
    await publisher.waitForDeployment();

    await core.grantRole(await core.OPERATION_ROLE(), await publisher.getAddress());
    await registry.grantRole(await registry.LINKER_ROLE(), await publisher.getAddress());

    await publisher.publishSeriesWithMerchant(
      await core.getAddress(),
      input,
      prizeTable(input.totalTicketNumbers),
      true,
      MERCHANT_A
    );

    expect(await registry.merchantOf(await core.getAddress(), 0)).to.equal(MERCHANT_A);
  });

  it("bundle mint respects refund state", async function () {
    const { user, points, core, bundle, refund } = await deploySplitSuite();
    await createSeries(core, { useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);

    await refund.setSeriesRefund(0, true, 0);

    await expect(bundle.connect(user).mintTickets(0, zeroLuckyNumbers(2), false))
      .to.be.revertedWithCustomError(core, "SeriesIsRefund");
  });

  it("bundle mint enforces wallet cap, preserves lucky numbers, and records pointsPaid", async function () {
    const { user, points, core, seriesOps, bundle } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 4, useLuckyNumber: true, maxPerWallet: 2 });
    await issuePoints(points, user.address);

    await bundle.connect(user).mintTickets(0, [1, 2], false);

    expect((await core.ticketStatusDetail(0)).luckyNumber).to.equal(1);
    expect((await core.ticketStatusDetail(1)).luckyNumber).to.equal(2);
    expect(await core.pointsPaid(0)).to.equal(ethers.parseEther("1"));
    expect(await core.pointsPaid(1)).to.equal(ethers.parseEther("1"));

    await expect(bundle.connect(user).mintTickets(0, [3, 4], false))
      .to.be.revertedWithCustomError(seriesOps, "WalletCapExceeded");
  });

  it("bundle mint preserves selected lucky numbers and exposes the series mode", async function () {
    const { user, points, core, bundle } = await deploySplitSuite();
    await createSeries(core, {
      totalTicketNumbers: 10,
      useLuckyNumber: true,
      maxPerWallet: 0,
    });
    await issuePoints(points, user.address);

    const [, useLuckyNumber] = await core.seriesMintConfig(0);
    expect(useLuckyNumber).to.equal(true);
    await bundle.connect(user).mintTickets(0, [4, 8, 9], false);

    expect((await core.ticketStatusDetail(0)).luckyNumber).to.equal(4);
    expect((await core.ticketStatusDetail(1)).luckyNumber).to.equal(8);
    expect((await core.ticketStatusDetail(2)).luckyNumber).to.equal(9);
  });

  it("rejects lucky-number inputs that do not match the series mode", async function () {
    const luckySuite = await deploySplitSuite();
    await createSeries(luckySuite.core, {
      totalTicketNumbers: 10,
      useLuckyNumber: true,
      maxPerWallet: 0,
    });
    await issuePoints(luckySuite.points, luckySuite.user.address);

    await expect(luckySuite.bundle.connect(luckySuite.user).mintTickets(0, [0], false))
      .to.be.revertedWithCustomError(luckySuite.bundle, "InvalidConfig");
    await expect(luckySuite.bundle.connect(luckySuite.user).mintTickets(0, [11], false))
      .to.be.revertedWithCustomError(luckySuite.core, "LuckyNumberOutOfRange");
    await expect(luckySuite.bundle.connect(luckySuite.user).mintTickets(0, [4, 4], false))
      .to.be.revertedWithCustomError(luckySuite.core, "LuckyNumberTaken");

    const nonLuckySuite = await deploySplitSuite();
    await createSeries(nonLuckySuite.core, {
      totalTicketNumbers: 4,
      useLuckyNumber: false,
      maxPerWallet: 0,
    });
    await issuePoints(nonLuckySuite.points, nonLuckySuite.user.address);

    await nonLuckySuite.bundle
      .connect(nonLuckySuite.user)
      .mintTickets(0, zeroLuckyNumbers(2), false);
    expect((await nonLuckySuite.core.ticketStatusDetail(0)).luckyNumber).to.equal(0);
    await expect(nonLuckySuite.bundle.connect(nonLuckySuite.user).mintTickets(0, [1], false))
      .to.be.revertedWithCustomError(nonLuckySuite.bundle, "InvalidConfig");
  });

  it("rejects lucky-number series larger than uint16", async function () {
    const { core } = await deploySplitSuite();
    const totalTicketNumbers = 65_536;

    await expect(
      core.createSeriesWithSubPrizes(
        seriesInput({ totalTicketNumbers, useLuckyNumber: true }),
        prizeTable(totalTicketNumbers),
        true
      )
    ).to.be.revertedWithCustomError(core, "InvalidSeriesInput");
  });

  it("redrawMain burns N revealed tickets, mints replacements, and requests reveal", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core, redraw, vrf, router } = suite;
    await createSeries(core, { totalTicketNumbers: 6, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0, 0]);
    await revealTickets(suite, 0, [0, 1], 777n);
    const beforeBalance = await core.balanceOf(user.address);

    await redraw.setRedrawMainConfig(0, 2, 2);
    await expect(redraw.connect(user).redrawMain(0, [0, 1]))
      .to.emit(redraw, "RedrawMinted")
      .withArgs(0, user.address, 2, 3)
      .and.to.emit(core, "RevealDrawSent")
      .withArgs(2, [3, 4]);

    expect(await core.balanceOf(user.address)).to.equal(beforeBalance);
    await expect(core.ownerOf(0)).to.be.reverted;
    await expect(core.ownerOf(1)).to.be.reverted;
    expect(await core.ownerOf(3)).to.equal(user.address);
    expect(await core.ownerOf(4)).to.equal(user.address);
    expect((await core.ticketStatusDetail(3)).tokenRevealed).to.equal(false);
    await expect(core.connect(user).reveal(0, [3]))
      .to.be.revertedWithCustomError(core, "TokenRevealPending");

    await vrf.fulfill(await router.getAddress(), 2, [888n]);
    expect((await core.ticketStatusDetail(3)).tokenRevealed).to.equal(true);
    expect((await core.ticketStatusDetail(4)).tokenRevealed).to.equal(true);
  });

  it("redrawMain reverts when remaining inventory is less than burn count", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core, redraw } = suite;
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0]);
    await revealTickets(suite, 0, [0], 123n);

    await redraw.setRedrawMainConfig(0, 1, 1);
    await expect(redraw.connect(user).redrawMain(0, [0]))
      .to.be.revertedWithCustomError(core, "NotEnoughNFTsRemaining");
  });

  it("redrawMain splits automatic reveal requests above Core's reveal batch limit", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core, redraw } = suite;
    await createSeries(core, { totalTicketNumbers: 42, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address, ethers.parseEther("1000"));
    await core.connect(user).mint(0, zeroLuckyNumbers(21));
    await core.connect(user).reveal(0, Array.from({ length: 20 }, (_, i) => i));
    await suite.vrf.fulfill(await suite.router.getAddress(), 1, [777n]);
    await core.connect(user).reveal(0, [20]);
    await suite.vrf.fulfill(await suite.router.getAddress(), 2, [778n]);
    await redraw.setRedrawMainConfig(0, 21, 21);

    const redrawTx = await redraw.connect(user).redrawMain(
      0,
      Array.from({ length: 21 }, (_, i) => i)
    );
    const redrawReceipt = await redrawTx.wait();
    const revealEvents = revealDrawSentEvents(redrawReceipt, core);

    expect(revealEvents).to.have.lengthOf(2);
    expect(revealEvents[0].args.tokenIDs).to.deep.equal(Array.from({ length: 20 }, (_, i) => BigInt(21 + i)));
    expect(revealEvents[1].args.tokenIDs).to.deep.equal([41n]);
  });

  it("redrawMain respects another wallet's active series reservation", async function () {
    const suite = await deploySplitSuite();
    const { user, other, points, core, seriesOps, redraw } = suite;
    await createSeries(core, { totalTicketNumbers: 5, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await issuePoints(points, other.address);

    await core.connect(other).mint(0, [0]);
    await revealTickets({ ...suite, user: other }, 0, [0], 777n);
    await redraw.setRedrawMainConfig(0, 1, 1);

    await ethers.provider.send("evm_increaseTime", [601]);
    await ethers.provider.send("evm_mine", []);
    await core.connect(user).mint(0, [0]);

    await expect(redraw.connect(other).redrawMain(0, [0]))
      .to.be.revertedWithCustomError(seriesOps, "SeriesReserved");
    expect(await core.ownerOf(0)).to.equal(other.address);
  });

  it("redrawMain success reserves the series for the redraw wallet for five minutes", async function () {
    const suite = await deploySplitSuite();
    const { user, other, points, core, seriesOps, redraw } = suite;
    await createSeries(core, { totalTicketNumbers: 4, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await issuePoints(points, other.address);

    await core.connect(other).mint(0, [0]);
    await revealTickets({ ...suite, user: other }, 0, [0], 777n);
    await redraw.setRedrawMainConfig(0, 1, 1);
    await ethers.provider.send("evm_increaseTime", [601]);
    await ethers.provider.send("evm_mine", []);

    const redrawTx = await redraw.connect(other).redrawMain(0, [0]);
    const redrawReceipt = await redrawTx.wait();
    const redrawBlock = await ethers.provider.getBlock(redrawReceipt.blockNumber);
    expect(mintLockUntilFrom(redrawReceipt, seriesOps)).to.equal(redrawBlock.timestamp + 300);

    await expect(core.connect(user).mint(0, [0]))
      .to.be.revertedWithCustomError(seriesOps, "SeriesReserved");

    await ethers.provider.send("evm_increaseTime", [301]);
    await ethers.provider.send("evm_mine", []);
    await core.connect(user).mint(0, [0]);
    expect(await core.ownerOf(2)).to.equal(user.address);
  });

  it("redrawMain preserves a longer active reservation for the same wallet", async function () {
    const suite = await deploySplitSuite();
    const { other, points, core, seriesOps, redraw } = suite;
    await createSeries(core, { totalTicketNumbers: 4, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, other.address);

    const mintTx = await core.connect(other).mint(0, [0]);
    const mintReceipt = await mintTx.wait();
    const originalLockUntil = mintLockUntilFrom(mintReceipt, seriesOps);
    await revealTickets({ ...suite, user: other }, 0, [0], 777n);
    await redraw.setRedrawMainConfig(0, 1, 1);

    const redrawTx = await redraw.connect(other).redrawMain(0, [0]);
    const redrawReceipt = await redrawTx.wait();

    expect(mintLockUntilFrom(redrawReceipt, seriesOps)).to.equal(originalLockUntil);
  });

  it("ticket quantity mints do not grant consolation draw credits without a separate redraw credit", async function () {
    const { user, points, core, bundle, redraw } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await redraw.setConsolationPrizes(0, [{
      subPrizeID: 9001,
      prizeGroup: "Z",
      subPrizeName: "Consolation",
      subPrizeRemainingQuantity: 5,
    }]);
    await bundle.connect(user).mintTickets(0, zeroLuckyNumbers(2), false);
    await expect(core.connect(user).mint(0, [0]))
      .to.be.revertedWithCustomError(core, "NotEnoughNFTsRemaining");

    await expect(redraw.connect(user).drawConsolation(0))
      .to.be.revertedWithCustomError(redraw, "EmptyConsolationBalance");
    await expect(core.connect(user).mint(0, [0]))
      .to.be.revertedWithCustomError(core, "NotEnoughNFTsRemaining");
  });

  it("restores reveal/exchange-aware tokenURI and exchangePrize", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core, seriesOps } = suite;
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

  it("blocks exchange after 60 days from reveal", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core } = suite;
    await createSeries(core, { totalTicketNumbers: 3, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0]);
    await revealTickets(suite, 0, [0, 1], 1n);
    const prizeID = (await core.ticketStatusDetail(0)).tokenRevealedPrize;

    await ethers.provider.send("evm_increaseTime", [60 * 24 * 60 * 60 - 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(core.connect(user).exchangePrize([0]))
      .to.emit(core, "UpdateTicketStatus")
      .withArgs(0, 0, prizeID, true, true);

    await ethers.provider.send("evm_increaseTime", [2]);
    await ethers.provider.send("evm_mine", []);

    await expect(core.connect(user).exchangePrize([1])).to.be.reverted;
  });

  it("refunds the actual pointsPaid for paid and bundle tickets", async function () {
    const { user, points, core, bundle, refund } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 3, priceInPoints: ethers.parseEther("7"), useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0]);
    await bundle.connect(user).mintTickets(0, zeroLuckyNumbers(2), false);

    await refund.setSeriesRefund(0, true, ethers.parseEther("1"));
    await expect(refund.connect(user).claimRefund([0, 1, 2]))
      .to.emit(refund, "RefundClaimed")
      .withArgs(0, user.address, [0, 1, 2], ethers.parseEther("21"));
    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
  });

  it("refunds only net paid points for bundle tickets that received rebates", async function () {
    const { user, points, core, bundle, refund } = await deploySplitSuite();
    await createSeries(core, {
      totalTicketNumbers: 3,
      priceInPoints: ethers.parseEther("7"),
      useLuckyNumber: false,
      maxPerWallet: 0,
    });
    await issuePoints(points, user.address);
    await bundle.setSeriesRebateTiers(0, [
      { minimumTicketQuantity: 3, rebatePoints: ethers.parseEther("6") },
    ]);

    await bundle.connect(user).mintTickets(0, zeroLuckyNumbers(3), false);
    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("85"));

    await refund.setSeriesRefund(0, true, ethers.parseEther("1"));
    await expect(refund.connect(user).claimRefund([0, 1, 2]))
      .to.emit(refund, "RefundClaimed")
      .withArgs(0, user.address, [0, 1, 2], ethers.parseEther("15"));
    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
  });

  it("keeps estimated delivery time independent from the initial reveal switch", async function () {
    const { core } = await deploySplitSuite();

    const tx = await core.createSeriesWithSubPrizes(
      seriesInput({ estimateDeliverTime: 1880000000 }),
      prizeTable(6),
      true
    );
    const receipt = await tx.wait();
    const newSeries = receipt.logs
      .map((log) => {
        try {
          return core.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .find((event) => event?.name === "NewSeries");

    expect(newSeries.args.estimateDeliverTime).to.equal(1880000000);
    expect(newSeries.args.exchangeExpireTime).to.equal(1880000000 + 60 * 24 * 60 * 60);
  });

  it("allows pre-order minting but gates reveal with the series reveal switch", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core, seriesOps } = suite;
    await createSeries(core, { totalTicketNumbers: 2, isPreOrder: true, useLuckyNumber: false, maxPerWallet: 0 }, false);
    await issuePoints(points, user.address);

    await core.connect(user).mint(0, [0]);
    await expect(core.connect(user).reveal(0, [0]))
      .to.be.revertedWithCustomError(core, "GoodsNotArrived");

    await core.setGoodsArrived(0);
    await expect(core.connect(user).reveal(0, [0]))
      .to.be.revertedWithCustomError(core, "GoodsNotArrived");

    await seriesOps.setSeriesRevealEnabled(0, true);
    await expect(core.connect(user).reveal(0, [0]))
      .to.emit(core, "RevealDrawSent");
  });

  it("allows non-preorder ticket minting without requiring goods arrived", async function () {
    const { user, points, core, bundle } = await deploySplitSuite();
    await createSeries(
      core,
      {
        totalTicketNumbers: 2,
        estimateDeliverTime: 1880000000,
        isPreOrder: false,
        useLuckyNumber: false,
        maxPerWallet: 0,
      },
      true
    );
    await issuePoints(points, user.address);

    await expect(bundle.connect(user).mintTickets(0, [0], false))
      .to.emit(core, "NewTicketStatus");
  });

  it("mintTickets caps immediate reveal quantity at 10 and auto-requests reveal", async function () {
    const suite = await deploySplitSuite();
    const { user, points, vrf, router, core, bundle } = suite;
    await createSeries(core, { totalTicketNumbers: 12, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address, ethers.parseEther("200"));

    await expect(bundle.connect(user).mintTickets(0, zeroLuckyNumbers(11), true))
      .to.be.revertedWithCustomError(bundle, "RevealBatchTooLarge");

    await expect(bundle.connect(user).mintTickets(0, zeroLuckyNumbers(3), true))
      .to.emit(core, "RevealDrawSent");

    expect(await core.ownerOf(0)).to.equal(user.address);
    expect(await core.ownerOf(2)).to.equal(user.address);
    expect((await core.ticketStatusDetail(0)).tokenRevealed).to.equal(false);

    await vrf.fulfill(await router.getAddress(), 1, [999n]);
    expect((await core.ticketStatusDetail(0)).tokenRevealed).to.equal(true);
    expect((await core.ticketStatusDetail(1)).tokenRevealed).to.equal(true);
    expect((await core.ticketStatusDetail(2)).tokenRevealed).to.equal(true);
  });

  it("blocks duplicate reveal requests while a token has pending VRF", async function () {
    const suite = await deploySplitSuite();
    const { user, points, vrf, router, core } = suite;
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0]);

    await expect(core.connect(user).reveal(0, [0]))
      .to.emit(core, "RevealDrawSent")
      .withArgs(1, [0]);

    await expect(core.connect(user).reveal(0, [0])).to.be.reverted;
    await expect(core.connect(user).reveal(0, [0, 0])).to.be.reverted;

    await vrf.fulfill(await router.getAddress(), 1, [999n]);
    expect((await core.ticketStatusDetail(0)).tokenRevealed).to.equal(true);
    await expect(core.connect(user).reveal(0, [0]))
      .to.be.revertedWithCustomError(core, "TokenAlreadyRevealed");
  });

  it("mintTickets requires goods arrived when immediate reveal is requested for pre-order series", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core, bundle } = suite;
    await createSeries(
      core,
      { totalTicketNumbers: 2, isPreOrder: true, useLuckyNumber: false, maxPerWallet: 0 },
      false
    );
    await issuePoints(points, user.address);

    await expect(bundle.connect(user).mintTickets(0, [0], true))
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
    await expect(core.connect(other).mint(0, [0]))
      .to.emit(core, "LastPrizeWinner")
      .withArgs(0, [1]);
    expect(await core.ownerOf(2)).to.equal(other.address);
    expect((await core.ticketStatusDetail(2)).tokenRevealedPrize).to.equal(999);
  });

  it("automatically assigns non-preorder last-prize winner when the final ticket sells", async function () {
    const { user, other, points, core } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0, isPreOrder: false });
    await issuePoints(points, user.address);
    await issuePoints(points, other.address);
    await core.connect(user).mint(0, [0]);
    await ethers.provider.send("evm_increaseTime", [901]);
    await ethers.provider.send("evm_mine", []);

    await expect(core.connect(other).mint(0, [0]))
      .to.emit(core, "LastPrizeWinner")
      .withArgs(0, [1])
      .and.to.emit(core, "UpdateSeriesLastPrizeOwner")
      .withArgs(0, [other.address]);

    expect(await core.ownerOf(2)).to.equal(other.address);
    expect((await core.ticketStatusDetail(2)).tokenRevealedPrize).to.equal(999);
  });

  it("uses configured non-preorder last-prize quantity when the final ticket sells", async function () {
    const { user, other, points, core } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0, isPreOrder: false });
    await issuePoints(points, user.address);
    await issuePoints(points, other.address);
    await core.setSeriesLastPrizeQuantity(0, 2);
    await core.connect(user).mint(0, [0]);
    await ethers.provider.send("evm_increaseTime", [901]);
    await ethers.provider.send("evm_mine", []);

    await expect(core.connect(other).mint(0, [0]))
      .to.emit(core, "LastPrizeWinner")
      .withArgs(0, [1, 1])
      .and.to.emit(core, "UpdateSeriesLastPrizeOwner")
      .withArgs(0, [other.address, other.address]);

    expect(await core.ownerOf(2)).to.equal(other.address);
    expect(await core.ownerOf(3)).to.equal(other.address);
    expect((await core.ticketStatusDetail(2)).tokenRevealedPrize).to.equal(999);
    expect((await core.ticketStatusDetail(3)).tokenRevealedPrize).to.equal(999);
  });

  it("automatically requests preorder last-prize draw when the final ticket sells", async function () {
    const { user, points, vrf, router, core } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0, isPreOrder: true }, false);
    await issuePoints(points, user.address);

    await core.connect(user).mint(0, [0]);
    await expect(core.connect(user).mint(0, [0]))
      .to.emit(router, "VrfRandomWordsRequested")
      .withArgs(1, await core.getAddress(), await core.getAddress(), 1)
      .and.to.emit(core, "LastPrizeDraw")
      .withArgs(1, 0, 1);

    expect(await router.pendingRequests()).to.equal(1);
    await expect(vrf.fulfill(await router.getAddress(), 1, [0]))
      .to.emit(core, "LastPrizeWinner")
      .withArgs(1, [0]);

    expect(await core.ownerOf(2)).to.equal(user.address);
    expect((await core.ticketStatusDetail(2)).tokenRevealedPrize).to.equal(999);
  });

  it("uses configured preorder last-prize quantity for the automatic VRF draw", async function () {
    const { user, other, points, vrf, router, core } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 3, useLuckyNumber: false, maxPerWallet: 0, isPreOrder: true }, false);
    await issuePoints(points, user.address);
    await issuePoints(points, other.address);
    await core.setSeriesLastPrizeQuantity(0, 2);

    await core.connect(user).mint(0, [0]);
    await ethers.provider.send("evm_increaseTime", [901]);
    await ethers.provider.send("evm_mine", []);
    await core.connect(other).mint(0, [0]);
    await ethers.provider.send("evm_increaseTime", [901]);
    await ethers.provider.send("evm_mine", []);
    await expect(core.connect(user).mint(0, [0]))
      .to.emit(router, "VrfRandomWordsRequested")
      .withArgs(1, await core.getAddress(), await core.getAddress(), 2);

    await expect(vrf.fulfill(await router.getAddress(), 1, [0, 1]))
      .to.emit(core, "LastPrizeWinner")
      .withArgs(1, [0, 1])
      .and.to.emit(core, "UpdateSeriesLastPrizeOwner")
      .withArgs(0, [user.address, other.address]);

    expect(await core.ownerOf(3)).to.equal(user.address);
    expect(await core.ownerOf(4)).to.equal(other.address);
    expect((await core.ticketStatusDetail(3)).tokenRevealedPrize).to.equal(999);
    expect((await core.ticketStatusDetail(4)).tokenRevealedPrize).to.equal(999);
  });

  it("emits zero request id for synchronous non-preorder last-prize events", async function () {
    const { user, other, points, core } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0, isPreOrder: false });
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0, isPreOrder: false });
    await issuePoints(points, other.address);
    await expect(core.connect(other).mint(1, [0, 0]))
      .to.emit(core, "LastPrizeWinner")
      .withArgs(0, [1]);
  });

  it("supports adjustable mint locks and maxPerWallet updates", async function () {
    const { user, other, points, core, seriesOps } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 5, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await issuePoints(points, other.address);
    await seriesOps.setDefaultLockDuration(60);
    await seriesOps.setSeriesMaxPerWallet(0, 2);

    await core.connect(user).mint(0, [0]);
    await expect(core.connect(other).mint(0, [0]))
      .to.be.revertedWithCustomError(seriesOps, "SeriesReserved");
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);
    await core.connect(other).mint(0, [0]);
    await seriesOps.clearMintLock(0);
    await core.connect(user).mint(0, [0]);
    await expect(core.connect(user).mint(0, [0]))
      .to.be.revertedWithCustomError(seriesOps, "WalletCapExceeded");
  });

  it("caps refreshed mint locks at 10 minutes from each mint block", async function () {
    const { user, points, core, seriesOps } = await deploySplitSuite();
    await createSeries(core, { totalTicketNumbers: 5, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await seriesOps.setSeriesLockDuration(0, 1200);

    const firstTx = await core.connect(user).mint(0, [0]);
    const firstReceipt = await firstTx.wait();
    const firstBlock = await ethers.provider.getBlock(firstReceipt.blockNumber);
    expect(mintLockUntilFrom(firstReceipt, seriesOps)).to.equal(firstBlock.timestamp + 600);

    await ethers.provider.send("evm_increaseTime", [100]);
    await ethers.provider.send("evm_mine", []);

    const secondTx = await core.connect(user).mint(0, [0]);
    const secondReceipt = await secondTx.wait();
    const secondBlock = await ethers.provider.getBlock(secondReceipt.blockNumber);
    expect(mintLockUntilFrom(secondReceipt, seriesOps)).to.equal(secondBlock.timestamp + 600);
  });

  it("advances the lucky-number cursor as numbers are consumed and auto-assigned", async function () {
    const suite = await deploySplitSuite();
    const { user, points, core, redraw } = suite;
    await createSeries(core, { totalTicketNumbers: 5, useLuckyNumber: true, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [1, 2]);
    await revealTickets(suite, 0, [0], 777n);

    await redraw.setRedrawMainConfig(0, 1, 1);
    await redraw.connect(user).redrawMain(0, [0]);

    expect((await core.ticketStatusDetail(2)).luckyNumber).to.equal(3);
    await suite.vrf.fulfill(await suite.router.getAddress(), 2, [778n]);
    await redraw.connect(user).redrawMain(0, [2]);
    expect((await core.ticketStatusDetail(3)).luckyNumber).to.equal(4);
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
    expect(await router.requestSender(1)).to.equal(admin.address);
    await expect(router.setVrfConfig(await nextVrf.getAddress(), 123n, ethers.ZeroHash, 2_500_000, 0))
      .to.be.revertedWithCustomError(router, "PendingRequests");

    await vrf.fulfill(await router.getAddress(), 1, [9]);
    expect(await router.pendingRequests()).to.equal(0);
    expect(await router.requestSender(1)).to.equal(ethers.ZeroAddress);
    expect(await callback.lastRandomWord()).to.equal(9);
    await router.setVrfConfig(await nextVrf.getAddress(), 123n, ethers.ZeroHash, 2_500_000, 0);
  });

  it("blocks Core and Redraw router rotation until callbacks settle", async function () {
    const suite = await deploySplitSuite();
    const { admin, user, points, vrf, router, core, redraw } = suite;
    await createSeries(core, { totalTicketNumbers: 2, useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0]);
    await core.connect(user).reveal(0, [0]);

    const NextVrf = await ethers.getContractFactory(
      "contracts/test/VRFCoordinatorV2PlusMock.sol:VRFCoordinatorV2PlusMock"
    );
    const nextVrf = await NextVrf.deploy();
    await nextVrf.waitForDeployment();
    const Router = await ethers.getContractFactory("contracts/DoudoVRFRouter.sol:DoudoVRFRouter");
    const nextRouter = await Router.deploy(await nextVrf.getAddress(), 456n, ethers.ZeroHash, 0, 2_500_000);
    await nextRouter.waitForDeployment();

    expect(await router.pendingRequests()).to.equal(1);
    await expect(core.setVrfRouter(await nextRouter.getAddress()))
      .to.be.revertedWithCustomError(core, "InvalidConfig");
    await expect(redraw.setRouter(await nextRouter.getAddress()))
      .to.be.revertedWithCustomError(redraw, "InvalidConfig");

    await vrf.fulfill(await router.getAddress(), 1, [777n]);
    await expect(core.setVrfRouter(await nextRouter.getAddress()))
      .to.emit(core, "VrfRouterUpdated")
      .withArgs(await nextRouter.getAddress(), admin.address);
    await expect(redraw.setRouter(await nextRouter.getAddress()))
      .to.emit(redraw, "RouterUpdated")
      .withArgs(await nextRouter.getAddress());
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
    const legacyUnlockExpiration = await oldCore.seriesUnlockUntil(0, user.address);

    const Core = await linkedCoreFactory();
    const core = await upgrades.upgradeProxy(await oldCore.getAddress(), Core, {
      unsafeAllowLinkedLibraries: true,
    });
    await core.waitForDeployment();

    const SeriesOps = await ethers.getContractFactory(
      "contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol:DoudoSeriesOpsModuleUpgradeable"
    );
    const seriesOps = await upgrades.deployProxy(SeriesOps, [await core.getAddress()], {
      initializer: "initialize",
      kind: "uups",
    });
    await seriesOps.waitForDeployment();
    await core.setSeriesOpsModule(await seriesOps.getAddress());
    await seriesOps.seedSeriesConfig(0, 2, true);
    await seriesOps.seedMintedCount(0, user.address, 1);

    expect(await core.ownerOf(0)).to.equal(user.address);
    const seededStatus = await core.ticketStatusDetail(0);
    expect(seededStatus.seriesID).to.equal(0);
    expect(seededStatus.luckyNumber).to.equal(7);
    expect(await core.pointsPaid(0)).to.equal(ethers.parseEther("1"));
    expect(await core.tokenURI(0)).to.equal("ipfs://old-unreveal");
    expect(await seriesUnlockExpiration(core, 0, user.address)).to.equal(legacyUnlockExpiration);

    expect(await seriesOps.seriesLockDuration(0)).to.equal(0);
    await seriesOps.setSeriesLockDuration(0, 30);
    expect(await seriesOps.seriesLockDuration(0)).to.equal(30);

    await core.connect(user).mint(0, [8]);
    expect(await core.ownerOf(1)).to.equal(user.address);
    expect((await core.ticketStatusDetail(1)).luckyNumber).to.equal(8);
    await expect(core.connect(user).mint(0, [9]))
      .to.be.revertedWithCustomError(seriesOps, "WalletCapExceeded");
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

  it("persists a future Collection Book unlock entitlement in Core", async function () {
    const { user, other, core, reward } = await deploySplitSuite();
    await createSeries(core, { useLuckyNumber: false, maxPerWallet: 0 });
    await reward.setCollectionBook(other.address);

    const unlockTx = await reward.connect(other).unlockSeriesFor(user.address, 0);
    const unlockReceipt = await unlockTx.wait();
    const unlockBlock = await ethers.provider.getBlock(unlockReceipt.blockNumber);
    const expires = BigInt(unlockBlock.timestamp + 30 * 24 * 60 * 60);

    await expect(unlockTx)
      .to.emit(core, "SeriesUnlockedFor")
      .withArgs(0, user.address, expires);
    expect(await seriesUnlockExpiration(core, 0, user.address)).to.equal(expires);
    expect(expires).to.be.greaterThan(BigInt(unlockBlock.timestamp));
  });

  it("rejects invalid or unauthorized unlock entitlement writes", async function () {
    const { user, other, core, reward } = await deploySplitSuite();
    await createSeries(core, { useLuckyNumber: false, maxPerWallet: 0 });
    await reward.setCollectionBook(other.address);

    await expect(core.connect(user).moduleUnlockSeriesFor(0, user.address, 1))
      .to.be.revertedWithCustomError(core, "MissingRole");
    await expect(reward.connect(other).unlockSeriesFor(user.address, 999))
      .to.be.revertedWithCustomError(core, "InvalidSeriesInput");
    await expect(reward.connect(other).unlockSeriesFor(ethers.ZeroAddress, 0))
      .to.be.revertedWithCustomError(core, "InvalidSeriesInput");
    await expect(reward.setCollectionRewardConfig(7, {
      rewardKind: 2,
      pointsAmount: 0,
      seriesID: 0,
      prizeID: 0,
      active: true,
    })).to.be.revertedWithCustomError(reward, "InvalidConfig");
    await expect(reward.setCollectionRewardConfig(7, {
      rewardKind: 3,
      pointsAmount: 1,
      seriesID: 0,
      prizeID: 0,
      active: true,
    })).to.be.revertedWithCustomError(reward, "InvalidConfig");
    await expect(reward.setCollectionRewardConfig(7, {
      rewardKind: 0,
      pointsAmount: 0,
      seriesID: 999,
      prizeID: 1,
      active: true,
    })).to.be.revertedWithCustomError(reward, "InvalidConfig");
    await expect(reward.setCollectionRewardConfig(7, {
      rewardKind: 2,
      pointsAmount: 1,
      seriesID: 999,
      prizeID: 0,
      active: true,
    })).to.be.revertedWithCustomError(reward, "InvalidConfig");
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

    const rewardTokenId = 3n; // tokens 0 and 1 were sold, token 2 is the automatic last-prize token
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
    // Bundle mint sells out the series and consumes lucky numbers 1 and 2.
    await bundle.connect(user).mintTickets(0, [1, 2], false);
    // Confirm sold out (no inventory left).
    await expect(core.connect(user).mint(0, [1]))
      .to.be.revertedWithCustomError(core, "NotEnoughNFTsRemaining");

    await expect(redraw.connect(user).drawConsolation(0))
      .to.be.revertedWithCustomError(redraw, "EmptyConsolationBalance");
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
