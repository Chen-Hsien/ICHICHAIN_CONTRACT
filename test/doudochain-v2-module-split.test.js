const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const zeroLuckyNumbers = (quantity) => Array(quantity).fill(0);

function prizeTable(total = 6) {
  return [
    {
      subPrizeID: 1,
      prizeGroup: "A",
      subPrizeName: "A1",
      subPrizeRemainingQuantity: 10,
    },
    {
      subPrizeID: 2,
      prizeGroup: "B",
      subPrizeName: "B1",
      subPrizeRemainingQuantity: total - 50,
    },
    {
      subPrizeID: 3,
      prizeGroup: "C",
      subPrizeName: "C1",
      subPrizeRemainingQuantity: 10,
    },
    {
      subPrizeID: 4,
      prizeGroup: "D",
      subPrizeName: "D1",
      subPrizeRemainingQuantity: 30,
    },
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
    packingType: 1,
    sourceType: 1,
    ...overrides,
  };
}

async function deploySplitSuite() {
  const [admin, user, other] = await ethers.getSigners();

  const Points = await ethers.getContractFactory(
    "contracts/DDOUDOCOIN.sol:DOUDOCOIN"
  );
  const points = await Points.deploy(admin.address, admin.address);
  await points.waitForDeployment();

  const Vrf = await ethers.getContractFactory(
    "contracts/test/VRFCoordinatorV2PlusMock.sol:VRFCoordinatorV2PlusMock"
  );
  const vrf = await Vrf.deploy();
  await vrf.waitForDeployment();

  const subscriptionId = 123n;
  const keyHash = ethers.keccak256(ethers.toUtf8Bytes("arb-sepolia-keyhash"));
  const requestConfirmations = 0;
  const callbackGasLimit = 2_500_000;

  const Router = await ethers.getContractFactory(
    "contracts/DoudoVRFRouter.sol:DoudoVRFRouter"
  );
  const router = await Router.deploy(
    await vrf.getAddress(),
    subscriptionId,
    keyHash,
    requestConfirmations,
    callbackGasLimit
  );
  await router.waitForDeployment();

  const Core = await linkedCoreFactory();
  const core = await upgrades.deployProxy(
    Core,
    [await points.getAddress(), await router.getAddress()],
    {
      initializer: "initialize",
      kind: "uups",
      unsafeAllowLinkedLibraries: true,
    }
  );
  await core.waitForDeployment();

  const SeriesOps = await ethers.getContractFactory(
    "contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol:DoudoSeriesOpsModuleUpgradeable"
  );
  const seriesOps = await upgrades.deployProxy(
    SeriesOps,
    [await core.getAddress()],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );
  await seriesOps.waitForDeployment();
  await core.setSeriesOpsModule(await seriesOps.getAddress());

  const Bundle = await ethers.getContractFactory(
    "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable"
  );
  const bundle = await upgrades.deployProxy(
    Bundle,
    [await core.getAddress(), await points.getAddress()],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );
  await bundle.waitForDeployment();

  const Membership = await ethers.getContractFactory(
    "DoudoMembershipV2Upgradeable"
  );
  const membership = await upgrades.deployProxy(
    Membership,
    [admin.address, await bundle.getAddress(), await bundle.getAddress()],
    { initializer: "initialize", kind: "uups" }
  );
  await membership.waitForDeployment();

  const Refund = await ethers.getContractFactory(
    "contracts/modules/DoudoRefundModuleUpgradeable.sol:DoudoRefundModuleUpgradeable"
  );
  const refund = await upgrades.deployProxy(
    Refund,
    [await core.getAddress(), await points.getAddress()],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );
  await refund.waitForDeployment();

  const Redraw = await ethers.getContractFactory(
    "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable"
  );
  const redraw = await upgrades.deployProxy(
    Redraw,
    [await core.getAddress(), await router.getAddress()],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );
  await redraw.waitForDeployment();

  const Reward = await ethers.getContractFactory(
    "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable"
  );
  const reward = await upgrades.deployProxy(
    Reward,
    [await core.getAddress(), await points.getAddress()],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );
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
  await bundle.setDatabasePointsRefundModule(await refund.getAddress());
  await refund.configureDatabasePointsRefundAccounting(
    await bundle.getAddress(),
    await membership.getAddress(),
    false
  );
  await membership.grantRole(
    await membership.CONSUMPTION_RECORDER_ROLE(),
    await refund.getAddress()
  );
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
    seriesOps,
    bundle,
    membership,
    refund,
    redraw,
    reward,
    book,
  };
}

async function signPointsMintAuthorization(signer, bundle, authorization) {
  const network = await ethers.provider.getNetwork();
  return signer.signTypedData(
    {
      name: "DOUDO Database Points",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await bundle.getAddress(),
    },
    {
      PointsMintAuthorization: [
        { name: "authorizationId", type: "bytes32" },
        { name: "buyer", type: "address" },
        { name: "seriesID", type: "uint256" },
        { name: "luckyNumbersHash", type: "bytes32" },
        { name: "ticketQuantity", type: "uint256" },
        { name: "grossPoints", type: "uint256" },
        { name: "revealImmediately", type: "bool" },
        { name: "freeOrderChallenge", type: "bool" },
        { name: "deadline", type: "uint256" },
      ],
    },
    authorization
  );
}

function buildPointsMintAuthorization({
  authorizationId,
  buyer,
  seriesID,
  luckyNumbers,
  grossPoints,
  deadline,
  revealImmediately = false,
  freeOrderChallenge = false,
}) {
  return {
    authorizationId,
    buyer,
    seriesID,
    luckyNumbersHash: ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["uint16[]"], [luckyNumbers])
    ),
    ticketQuantity: luckyNumbers.length,
    grossPoints,
    revealImmediately,
    freeOrderChallenge,
    deadline,
  };
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

async function createSeries(core, overrides = {}, subPrizes = prizeTable(60)) {
  const tx = await core.createSeriesWithSubPrizes(
    seriesInput(overrides),
    subPrizes,
    true
  );
  await tx.wait();
}

async function issuePoints(points, to, amount = ethers.parseEther("1000")) {
  await points.mint(to, amount);
}

describe("DOUDOCHAIN V2 split module suite", function () {
  it("wires the split suite with router consumer, core module roles, and collection reward target", async function () {
    const {
      admin,
      points,
      router,
      core,
      bundle,
      refund,
      redraw,
      reward,
      book,
    } = await deploySplitSuite();

    expect(await core.doudoPoints()).to.equal(await points.getAddress());
    expect(await core.vrfRouter()).to.equal(await router.getAddress());
    expect(await router.isRequester(await core.getAddress())).to.equal(true);
    expect(await router.isRequester(await redraw.getAddress())).to.equal(true);
    expect(
      await core.hasRole(await core.MODULE_ROLE(), await bundle.getAddress())
    ).to.equal(true);
    expect(
      await core.hasRole(await core.MODULE_ROLE(), await refund.getAddress())
    ).to.equal(true);
    expect(
      await core.hasRole(await core.MODULE_ROLE(), await redraw.getAddress())
    ).to.equal(true);
    expect(
      await core.hasRole(await core.MODULE_ROLE(), await reward.getAddress())
    ).to.equal(true);
    expect(await book.doudochainV2RewardTarget()).to.equal(
      await reward.getAddress()
    );
    expect(
      await core.hasRole(await core.DEFAULT_ADMIN_ROLE(), admin.address)
    ).to.equal(true);
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

  it("mints tickets through the bundle module while Core emits canonical ticket events", async function () {
    const { user, points, core, bundle } = await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);

    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(3), false)
    )
      .to.emit(bundle, "TicketPurchaseMinted")
      .withArgs(0, user.address, 3, ethers.parseEther("30"), false, anyValue)
      .and.to.emit(core, "NewTicketStatus");

    expect(await core.balanceOf(user.address)).to.equal(3);
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("970")
    );
  });

  it("mints from a buyer-bound database-points authorization without touching ERC20 points", async function () {
    const { admin, user, points, core, bundle, membership } =
      await deploySplitSuite();
    await createSeries(core);
    await bundle.configureDatabasePointsAuthorization(
      admin.address,
      await membership.getAddress(),
      true
    );

    const luckyNumbers = zeroLuckyNumbers(3);
    const authorization = buildPointsMintAuthorization({
      authorizationId: ethers.id("db-points-mint-1"),
      buyer: user.address,
      seriesID: 0,
      luckyNumbers,
      grossPoints: ethers.parseEther("30"),
      deadline: (await time.latest()) + 600,
    });
    const signature = await signPointsMintAuthorization(
      admin,
      bundle,
      authorization
    );

    await expect(
      bundle
        .connect(user)
        .mintTicketsWithPointsAuthorization(
          authorization,
          luckyNumbers,
          signature
        )
    )
      .to.emit(bundle, "DatabasePointsPurchaseMinted")
      .withArgs(
        authorization.authorizationId,
        0,
        user.address,
        3,
        ethers.parseEther("30"),
        0,
        ethers.parseEther("30"),
        0,
        false,
        false,
        0,
        0
      )
      .and.to.emit(membership, "MembershipConsumptionRecorded");

    expect(await core.balanceOf(user.address)).to.equal(3);
    expect(await points.balanceOf(user.address)).to.equal(0);
    const member = await membership.getMember(user.address);
    expect(member.currentQualifyingSpend).to.equal(ethers.parseEther("30"));
    expect(member.lifetimeSpend).to.equal(ethers.parseEther("30"));
    expect(member.level).to.equal(1);
    expect(
      await bundle.pointsAuthorizationUsed(authorization.authorizationId)
    ).to.equal(true);

    await expect(
      bundle
        .connect(user)
        .mintTicketsWithPointsAuthorization(
          authorization,
          luckyNumbers,
          signature
        )
    )
      .to.be.revertedWithCustomError(bundle, "PointsAuthorizationAlreadyUsed")
      .withArgs(authorization.authorizationId);
    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(1), false)
    ).to.be.revertedWithCustomError(bundle, "LegacyPointsModeDisabled");
  });

  it("credits bundle rebate as a database entitlement and records only net member spend", async function () {
    const { admin, user, points, core, bundle, membership } =
      await deploySplitSuite();
    await createSeries(core, { priceInPoints: ethers.parseEther("100") });
    await bundle.setSeriesRebateTiers(0, [
      { minimumTicketQuantity: 1, rebatePoints: ethers.parseEther("10") },
    ]);
    await bundle.configureDatabasePointsAuthorization(
      admin.address,
      await membership.getAddress(),
      true
    );

    const luckyNumbers = zeroLuckyNumbers(1);
    const authorization = buildPointsMintAuthorization({
      authorizationId: ethers.id("db-points-rebate-1"),
      buyer: user.address,
      seriesID: 0,
      luckyNumbers,
      grossPoints: ethers.parseEther("100"),
      deadline: (await time.latest()) + 600,
    });
    const signature = await signPointsMintAuthorization(
      admin,
      bundle,
      authorization
    );

    await expect(
      bundle
        .connect(user)
        .mintTicketsWithPointsAuthorization(
          authorization,
          luckyNumbers,
          signature
        )
    )
      .to.emit(bundle, "DatabasePointsRebateEntitled")
      .withArgs(
        authorization.authorizationId,
        0,
        user.address,
        ethers.parseEther("10")
      )
      .and.to.emit(bundle, "DatabasePointsPurchaseMinted")
      .withArgs(
        authorization.authorizationId,
        0,
        user.address,
        1,
        ethers.parseEther("100"),
        ethers.parseEther("10"),
        ethers.parseEther("90"),
        0,
        false,
        false,
        0,
        0
      );

    expect(await points.balanceOf(user.address)).to.equal(0);
    const member = await membership.getMember(user.address);
    expect(member.currentQualifyingSpend).to.equal(ethers.parseEther("90"));
  });

  it("routes audited Membership V2 restore and wallet migration through the bundle operator", async function () {
    const { admin, user, other, bundle, membership } = await deploySplitSuite();
    await bundle.configureDatabasePointsAuthorization(
      admin.address,
      await membership.getAddress(),
      true
    );
    const now = await time.latest();
    const currentSpend = ethers.parseEther("48000");
    const lifetimeSpend = ethers.parseEther("60000");
    const restoreCase = ethers.id("bundle-membership-restore");

    await expect(
      bundle.adminSetMembershipV2(
        user.address,
        3,
        currentSpend,
        lifetimeSpend,
        now,
        restoreCase
      )
    )
      .to.emit(membership, "MembershipRestored")
      .withArgs(
        restoreCase,
        user.address,
        1,
        3,
        currentSpend,
        lifetimeSpend,
        now,
        now + 180 * 24 * 60 * 60
      );

    const migrationCase = ethers.id("bundle-membership-migration");
    await expect(
      bundle.adminMigrateMembershipV2(
        user.address,
        other.address,
        3,
        currentSpend,
        lifetimeSpend,
        now,
        migrationCase
      )
    )
      .to.emit(membership, "MembershipMigrated")
      .withArgs(
        migrationCase,
        user.address,
        other.address,
        1,
        2,
        3,
        currentSpend,
        lifetimeSpend,
        now,
        now + 180 * 24 * 60 * 60
      );

    await expect(
      bundle
        .connect(user)
        .adminSetMembershipV2(
          user.address,
          1,
          1,
          1,
          now,
          ethers.id("forbidden")
        )
    ).to.be.revertedWithCustomError(bundle, "MissingRole");
  });

  it("separates points configuration and membership operations from OPERATION_ROLE", async function () {
    const { admin, user, other, bundle, membership, refund, reward } =
      await deploySplitSuite();
    await bundle.grantRole(await bundle.OPERATION_ROLE(), user.address);
    await refund.grantRole(await refund.OPERATION_ROLE(), user.address);
    await reward.grantRole(await reward.OPERATION_ROLE(), user.address);

    await expect(
      bundle
        .connect(user)
        .configureDatabasePointsAuthorization(
          other.address,
          await membership.getAddress(),
          true
        )
    ).to.be.revertedWithCustomError(bundle, "MissingRole");

    await bundle.grantRole(await bundle.POINTS_CONFIG_ROLE(), user.address);
    await expect(
      bundle
        .connect(user)
        .configureDatabasePointsAuthorization(
          other.address,
          await membership.getAddress(),
          true
        )
    )
      .to.emit(bundle, "DatabasePointsAuthorizationConfigured")
      .withArgs(other.address, await membership.getAddress(), true);

    await expect(
      refund.connect(user).setDatabasePointsMode(true)
    ).to.be.revertedWithCustomError(refund, "MissingRole");
    await expect(
      reward.connect(user).setDatabasePointsMode(true)
    ).to.be.revertedWithCustomError(reward, "MissingRole");
    await refund.grantRole(await refund.POINTS_CONFIG_ROLE(), user.address);
    await reward.grantRole(await reward.POINTS_CONFIG_ROLE(), user.address);
    await expect(refund.connect(user).setDatabasePointsMode(true))
      .to.emit(refund, "DatabasePointsRefundModeConfigured")
      .withArgs(true);
    await expect(reward.connect(user).setDatabasePointsMode(true))
      .to.emit(reward, "DatabasePointsCollectionRewardModeConfigured")
      .withArgs(true);

    const now = await time.latest();
    await expect(
      bundle
        .connect(user)
        .adminSetMembershipV2(
          other.address,
          1,
          1,
          1,
          now,
          ethers.id("operation-role-cannot-restore-membership")
        )
    ).to.be.revertedWithCustomError(bundle, "MissingRole");

    await bundle.grantRole(
      await bundle.MEMBERSHIP_OPERATOR_ROLE(),
      user.address
    );
    await expect(
      bundle
        .connect(user)
        .adminSetMembershipV2(
          other.address,
          1,
          1,
          1,
          now,
          ethers.id("membership-operator-can-restore")
        )
    ).to.emit(membership, "MembershipRestored");

    expect(
      await bundle.hasRole(await bundle.POINTS_CONFIG_ROLE(), other.address)
    ).to.equal(false);
    expect(
      await bundle.hasRole(
        await bundle.MEMBERSHIP_OPERATOR_ROLE(),
        other.address
      )
    ).to.equal(false);
    expect(await bundle.hasRole(await bundle.OPERATION_ROLE(), other.address)).to
      .equal(false);
    expect(await bundle.hasRole(await bundle.UPGRADER_ROLE(), other.address)).to
      .equal(false);
    expect(
      await bundle.hasRole(await bundle.DEFAULT_ADMIN_ROLE(), other.address)
    ).to.equal(false);
  });

  it("rejects expired, modified, wrong-wallet, and incorrectly priced authorizations", async function () {
    const { admin, user, other, core, bundle, membership } =
      await deploySplitSuite();
    await createSeries(core);
    await bundle.configureDatabasePointsAuthorization(
      admin.address,
      await membership.getAddress(),
      true
    );
    const luckyNumbers = zeroLuckyNumbers(1);
    const base = buildPointsMintAuthorization({
      authorizationId: ethers.id("db-points-invalid-base"),
      buyer: user.address,
      seriesID: 0,
      luckyNumbers,
      grossPoints: ethers.parseEther("10"),
      deadline: (await time.latest()) + 600,
    });
    const signature = await signPointsMintAuthorization(admin, bundle, base);

    await expect(
      bundle
        .connect(other)
        .mintTicketsWithPointsAuthorization(base, luckyNumbers, signature)
    ).to.be.revertedWithCustomError(bundle, "InvalidPointsAuthorization");
    await expect(
      bundle
        .connect(user)
        .mintTicketsWithPointsAuthorization(
          { ...base, grossPoints: ethers.parseEther("11") },
          luckyNumbers,
          signature
        )
    ).to.be.revertedWithCustomError(bundle, "InvalidPointsAuthorization");
    await expect(
      bundle
        .connect(user)
        .mintTicketsWithPointsAuthorization(
          base,
          zeroLuckyNumbers(2),
          signature
        )
    ).to.be.revertedWithCustomError(bundle, "InvalidPointsAuthorization");

    const expired = {
      ...base,
      authorizationId: ethers.id("db-points-expired"),
      deadline: 1,
    };
    const expiredSignature = await signPointsMintAuthorization(
      admin,
      bundle,
      expired
    );
    await expect(
      bundle
        .connect(user)
        .mintTicketsWithPointsAuthorization(
          expired,
          luckyNumbers,
          expiredSignature
        )
    )
      .to.be.revertedWithCustomError(bundle, "PointsAuthorizationExpired")
      .withArgs(1);
  });

  it("mints tickets and immediately requests reveal through Core", async function () {
    const { user, other, points, vrf, router, core, bundle } =
      await deploySplitSuite();
    await createSeries(core, { useLuckyNumber: true });
    await issuePoints(points, user.address);

    await expect(bundle.connect(user).mintTickets(0, [1, 2, 3], true))
      .to.emit(core, "RevealDrawSent")
      .withArgs(1, [0, 1, 2])
      .and.to.emit(router, "VrfRandomWordsRequested")
      .withArgs(1, await core.getAddress(), await core.getAddress(), 1)
      .and.to.emit(bundle, "TicketPurchaseMinted")
      .withArgs(0, user.address, 3, ethers.parseEther("30"), true, 0);

    await expect(
      core.connect(other).reveal(0, [0])
    ).to.be.revertedWithCustomError(core, "NotTheTokenOwner");

    await vrf.fulfill(await router.getAddress(), 1, [123456]);

    for (const tokenID of [0, 1, 2]) {
      const status = await core.ticketStatusDetail(tokenID);
      expect(status.tokenRevealed).to.equal(true);
      expect(status.luckyNumber).to.be.greaterThan(0);
      expect(await core.ownerOf(tokenID)).to.equal(user.address);
    }
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("970")
    );

    await expect(
      bundle.connect(user).mintTickets(
        0,
        Array.from({ length: 12 }, (_, i) => i + 4),
        true
      )
    ).to.be.revertedWithCustomError(bundle, "RevealBatchTooLarge");
  });

  it("applies floor-tier rebates through the shared ticket purchase flow", async function () {
    const { user, points, vrf, router, core, bundle } =
      await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address, ethers.parseEther("2000"));

    await bundle.setSeriesRebateTiers(0, [
      { minimumTicketQuantity: 3, rebatePoints: ethers.parseEther("100") },
      { minimumTicketQuantity: 5, rebatePoints: ethers.parseEther("300") },
      { minimumTicketQuantity: 10, rebatePoints: ethers.parseEther("500") },
    ]);

    expect(await bundle.seriesRebateTierCount(0)).to.equal(3);

    await bundle.connect(user).mintTickets(0, zeroLuckyNumbers(2), false);
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("1980")
    );

    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(3), false)
    )
      .to.emit(bundle, "TicketPurchaseRebatePaid")
      .withArgs(0, user.address, 3, ethers.parseEther("100"));
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("2050")
    );

    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(6), false)
    )
      .to.emit(bundle, "TicketPurchaseRebatePaid")
      .withArgs(0, user.address, 6, ethers.parseEther("300"));
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("2290")
    );

    await expect(bundle.connect(user).mintTickets(0, zeroLuckyNumbers(8), true))
      .to.emit(bundle, "TicketPurchaseRebatePaid")
      .withArgs(0, user.address, 8, ethers.parseEther("300"))
      .and.to.emit(core, "RevealDrawSent")
      .withArgs(1, [11, 12, 13, 14, 15, 16, 17, 18]);
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("2510")
    );

    await vrf.fulfill(await router.getAddress(), 1, [987654]);
    expect((await core.ticketStatusDetail(11)).tokenRevealed).to.equal(true);

    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(10), true)
    )
      .to.emit(bundle, "TicketPurchaseRebatePaid")
      .withArgs(0, user.address, 10, ethers.parseEther("500"))
      .and.to.emit(core, "RevealDrawSent")
      .withArgs(2, [19, 20, 21, 22, 23, 24, 25, 26, 27, 28]);
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("2910")
    );

    await vrf.fulfill(await router.getAddress(), 2, [1234567]);
    expect((await core.ticketStatusDetail(19)).tokenRevealed).to.equal(true);

    await bundle.setSeriesRebateTiers(0, [
      { minimumTicketQuantity: 3, rebatePoints: ethers.parseEther("100") },
    ]);
    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(9), false)
    )
      .to.emit(bundle, "TicketPurchaseRebatePaid")
      .withArgs(0, user.address, 9, ethers.parseEther("100"));
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("2920")
    );
  });

  it("applies opening prices first and activates quantity rebates for the regular-price segment", async function () {
    const { user, points, core, bundle, refund } = await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);

    await bundle.setSeriesRebateTiers(0, [
      { minimumTicketQuantity: 3, rebatePoints: ethers.parseEther("5") },
    ]);
    await expect(bundle.setSeriesOpeningDiscount(0, 10, ethers.parseEther("7")))
      .to.emit(bundle, "OpeningDiscountConfigured")
      .withArgs(0, 10, ethers.parseEther("7"));

    expect(await bundle.quoteTicketPurchase(0, 8)).to.deep.equal([
      8n,
      0n,
      ethers.parseEther("56"),
      0n,
    ]);
    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(1), false)
    ).to.be.revertedWithCustomError(bundle, "PriceLimitRequired");

    await expect(
      bundle
        .connect(user)
        .mintTicketsWithPriceLimit(
          0,
          zeroLuckyNumbers(8),
          false,
          ethers.parseEther("56")
        )
    )
      .to.emit(bundle, "OpeningDiscountApplied")
      .withArgs(
        0,
        user.address,
        8,
        0,
        ethers.parseEther("7"),
        ethers.parseEther("56"),
        0
      )
      .and.to.emit(bundle, "TicketPurchaseMinted")
      .withArgs(0, user.address, 8, ethers.parseEther("56"), false, 0);

    expect(await bundle.quoteTicketPurchase(0, 5)).to.deep.equal([
      2n,
      3n,
      ethers.parseEther("44"),
      ethers.parseEther("5"),
    ]);
    await expect(
      bundle
        .connect(user)
        .mintTicketsWithPriceLimit(
          0,
          zeroLuckyNumbers(5),
          false,
          ethers.parseEther("44")
        )
    )
      .to.emit(bundle, "OpeningDiscountApplied")
      .withArgs(
        0,
        user.address,
        2,
        3,
        ethers.parseEther("7"),
        ethers.parseEther("44"),
        ethers.parseEther("5")
      )
      .and.to.emit(bundle, "TicketPurchaseRebatePaid")
      .withArgs(0, user.address, 3, ethers.parseEther("5"));

    expect(await bundle.openingDiscountUsed(0)).to.equal(10);
    expect(await bundle.quoteTicketPurchase(0, 3)).to.deep.equal([
      0n,
      3n,
      ethers.parseEther("30"),
      ethers.parseEther("5"),
    ]);
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("905")
    );

    for (const tokenID of Array.from({ length: 10 }, (_, i) => i)) {
      expect(await core.pointsPaid(tokenID)).to.equal(ethers.parseEther("7"));
    }
    const regularPaidPerTicket =
      ethers.parseEther("10") - ethers.parseEther("5") / 3n;
    expect(await core.pointsPaid(10)).to.equal(regularPaidPerTicket - 1n);
    expect(await core.pointsPaid(11)).to.equal(regularPaidPerTicket - 1n);
    expect(await core.pointsPaid(12)).to.equal(regularPaidPerTicket);
    expect(
      (await core.pointsPaid(10)) +
        (await core.pointsPaid(11)) +
        (await core.pointsPaid(12))
    ).to.equal(ethers.parseEther("25"));

    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(3), false)
    )
      .to.emit(bundle, "TicketPurchaseRebatePaid")
      .withArgs(0, user.address, 3, ethers.parseEther("5"));

    await refund.setSeriesRefund(0, true, 0);
    await expect(refund.connect(user).claimRefund([8, 9, 10, 11, 12]))
      .to.emit(refund, "RefundClaimed")
      .withArgs(0, user.address, [8, 9, 10, 11, 12], ethers.parseEther("39"));
  });

  it("reverts when opening inventory moves beyond the buyer's confirmed price", async function () {
    const { user, other, points, core, bundle } = await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);
    await issuePoints(points, other.address);
    await bundle.setSeriesRebateTiers(0, [
      { minimumTicketQuantity: 3, rebatePoints: ethers.parseEther("5") },
    ]);
    await bundle.setSeriesOpeningDiscount(0, 10, ethers.parseEther("7"));

    await bundle
      .connect(user)
      .mintTicketsWithPriceLimit(
        0,
        zeroLuckyNumbers(8),
        false,
        ethers.parseEther("56")
      );
    const staleQuote = await bundle.quoteTicketPurchase(0, 5);
    expect(staleQuote.grossPriceInPoints).to.equal(ethers.parseEther("44"));

    await ethers.provider.send("evm_increaseTime", [301]);
    await ethers.provider.send("evm_mine");
    await bundle
      .connect(other)
      .mintTicketsWithPriceLimit(
        0,
        zeroLuckyNumbers(2),
        false,
        ethers.parseEther("14")
      );

    await expect(
      bundle
        .connect(user)
        .mintTicketsWithPriceLimit(
          0,
          zeroLuckyNumbers(5),
          false,
          staleQuote.grossPriceInPoints
        )
    )
      .to.be.revertedWithCustomError(bundle, "PriceExceedsLimit")
      .withArgs(ethers.parseEther("50"), ethers.parseEther("44"));
    expect(await core.balanceOf(user.address)).to.equal(8);
  });

  it("blocks opening discount round changes during receiver callbacks", async function () {
    const { points, core, bundle } = await deploySplitSuite();
    await createSeries(core);
    const Receiver = await ethers.getContractFactory(
      "OpeningDiscountCallbackReceiver",
    );
    const receiver = await Receiver.deploy(await bundle.getAddress());
    await bundle.grantRole(
      await bundle.OPERATION_ROLE(),
      await receiver.getAddress(),
    );
    await issuePoints(points, await receiver.getAddress());
    const purchase = bundle.interface.encodeFunctionData(
      "mintTicketsWithPriceLimit",
      [0, [0], false, ethers.parseEther("7")],
    );
    const reentrantError = bundle.interface.encodeErrorResult("ReentrantCall");
    for (const action of [
      "clearSeriesOpeningDiscount",
      "setSeriesOpeningDiscount",
    ]) {
      await bundle.setSeriesOpeningDiscount(0, 1, ethers.parseEther("7"));
      const attack = bundle.interface.encodeFunctionData(
        action,
        action.startsWith("clear") ? [0] : [0, 5, ethers.parseEther("6")],
      );
      await receiver.configure(attack, true);
      const supply = await core.totalSupply();
      await expect(receiver.execute(purchase)).to.be.revertedWithCustomError(
        core,
        "InvalidERC721Receiver",
      );
      expect(await core.totalSupply()).to.equal(supply);
      expect(await bundle.openingDiscountUsed(0)).to.equal(0);
      await receiver.configure(attack, false);
      await expect(receiver.execute(purchase))
        .to.emit(bundle, "OpeningDiscountApplied")
        .withArgs(
          0,
          await receiver.getAddress(),
          1,
          0,
          ethers.parseEther("7"),
          ethers.parseEther("7"),
          0,
        );
      expect(await receiver.succeeded()).to.equal(false);
      expect(await receiver.result()).to.equal(reentrantError);
      expect(await bundle.seriesOpeningDiscounts(0)).to.deep.equal([
        1n,
        ethers.parseEther("7"),
        true,
      ]);
      expect(await bundle.openingDiscountUsed(0)).to.equal(1);
    }
  });

  for (const databasePoints of [false, true]) {
    it(`supports opening discount rounds and stale quotes (${databasePoints ? "database" : "legacy"} points)`, async function () {
      const { admin, user, other, points, core, bundle, membership } =
        await deploySplitSuite();
      await createSeries(core);
      if (databasePoints) {
        await bundle.configureDatabasePointsAuthorization(
          admin.address,
          await membership.getAddress(),
          true,
        );
      } else {
        await issuePoints(points, user.address);
      }
      let sequence = 0;
      const preparePurchase = async (quantity, gross) => {
        const luckyNumbers = zeroLuckyNumbers(quantity);
        if (!databasePoints)
          return () =>
            bundle
              .connect(user)
              .mintTicketsWithPriceLimit(
                0,
                luckyNumbers,
                false,
                ethers.parseEther(gross),
              );
        const authorization = buildPointsMintAuthorization({
          authorizationId: ethers.id(`opening-round-${++sequence}`),
          buyer: user.address,
          seriesID: 0,
          luckyNumbers,
          grossPoints: ethers.parseEther(gross),
          deadline: (await time.latest()) + 600,
        });
        const signature = await signPointsMintAuthorization(
          admin,
          bundle,
          authorization,
        );
        return () =>
          bundle
            .connect(user)
            .mintTicketsWithPointsAuthorization(
              authorization,
              luckyNumbers,
              signature,
            );
      };
      const state = async (limit, price, active, used) => {
        expect(await bundle.seriesOpeningDiscounts(0)).to.deep.equal([
          BigInt(limit),
          ethers.parseEther(price),
          active,
        ]);
        expect(await bundle.openingDiscountUsed(0)).to.equal(used);
      };
      await expect(
        bundle.clearSeriesOpeningDiscount(0),
      ).to.be.revertedWithCustomError(bundle, "InvalidConfig");
      await expect(
        bundle.setSeriesOpeningDiscount(999, 10, ethers.parseEther("7")),
      ).to.be.reverted;
      await expect(
        bundle.setSeriesOpeningDiscount(0, 10, ethers.parseEther("7")),
      )
        .to.emit(bundle, "OpeningDiscountConfigured")
        .withArgs(0, 10, ethers.parseEther("7"));
      await expect(
        bundle.setSeriesOpeningDiscount(0, 5, ethers.parseEther("6")),
      ).to.be.revertedWithCustomError(bundle, "InvalidConfig");
      await state(10, "7", true, 0);
      await (
        await preparePurchase(3, "21")
      )();
      await expect(
        bundle.setSeriesOpeningDiscount(0, 5, ethers.parseEther("6")),
      ).to.be.revertedWithCustomError(bundle, "InvalidConfig");
      await expect(bundle.connect(other).clearSeriesOpeningDiscount(0)).to.be
        .reverted;
      await expect(
        bundle
          .connect(other)
          .setSeriesOpeningDiscount(0, 5, ethers.parseEther("6")),
      ).to.be.reverted;
      const stalePurchase = await preparePurchase(1, "7");
      await expect(bundle.clearSeriesOpeningDiscount(0))
        .to.emit(bundle, "OpeningDiscountCleared")
        .withArgs(0);
      await state(10, "7", false, 3);
      expect(await bundle.quoteTicketPurchase(0, 1)).to.deep.equal([
        0n,
        1n,
        ethers.parseEther("10"),
        0n,
      ]);
      await expect(stalePurchase()).to.be.revertedWithCustomError(
        bundle,
        databasePoints ? "InvalidPointsAuthorization" : "PriceExceedsLimit",
      );
      await state(10, "7", false, 3);
      expect(await core.totalSupply()).to.equal(3);
      await expect(
        bundle.clearSeriesOpeningDiscount(0),
      ).to.be.revertedWithCustomError(bundle, "InvalidConfig");
      for (const [limit, price] of [
        [0, "7"],
        [5, "0"],
        [5, "10"],
        [5, "11"],
      ]) {
        await expect(
          bundle.setSeriesOpeningDiscount(0, limit, ethers.parseEther(price)),
        ).to.be.revertedWithCustomError(bundle, "InvalidConfig");
        await state(10, "7", false, 3);
      }
      await bundle.setSeriesOpeningDiscount(0, 5, ethers.parseEther("7"));
      await state(5, "7", true, 0);
      // A still-valid authorization/price limit is not bound to an earlier round.
      await stalePurchase();
      await (
        await preparePurchase(2, "14")
      )();
      await expect((await preparePurchase(5, "44"))())
        .to.emit(bundle, "OpeningDiscountApplied")
        .withArgs(
          0,
          user.address,
          2,
          3,
          ethers.parseEther("7"),
          ethers.parseEther("44"),
          0,
        );
      await state(5, "7", true, 5);
      for (let token = 0; token < 8; token++)
        expect(await core.pointsPaid(token)).to.equal(ethers.parseEther("7"));
      for (let token = 8; token < 11; token++)
        expect(await core.pointsPaid(token)).to.equal(ethers.parseEther("10"));
      await expect(
        bundle.setSeriesOpeningDiscount(0, 5, ethers.parseEther("7")),
      )
        .to.emit(bundle, "OpeningDiscountConfigured")
        .withArgs(0, 5, ethers.parseEther("7"));
      await state(5, "7", true, 0);
      await (
        await preparePurchase(5, "35")
      )();
      await bundle.clearSeriesOpeningDiscount(0);
      await state(5, "7", false, 5);
      expect(await points.balanceOf(user.address)).to.equal(
        ethers.parseEther(databasePoints ? "0" : "879"),
      );
    });
  }

  it("allows an unused opening discount to be cleared and rejects invalid prices", async function () {
    const { user, points, core, bundle } = await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);

    await expect(
      bundle
        .connect(user)
        .setSeriesOpeningDiscount(0, 10, ethers.parseEther("7"))
    ).to.be.reverted;
    await expect(
      bundle.setSeriesOpeningDiscount(0, 0, ethers.parseEther("7"))
    ).to.be.revertedWithCustomError(bundle, "InvalidConfig");
    await expect(
      bundle.setSeriesOpeningDiscount(0, 10, ethers.parseEther("10"))
    ).to.be.revertedWithCustomError(bundle, "InvalidConfig");
    await expect(
      bundle.setSeriesOpeningDiscount(0, 10, ethers.parseEther("11"))
    ).to.be.revertedWithCustomError(bundle, "InvalidConfig");

    await bundle.setSeriesOpeningDiscount(0, 10, ethers.parseEther("7"));
    await expect(bundle.clearSeriesOpeningDiscount(0))
      .to.emit(bundle, "OpeningDiscountCleared")
      .withArgs(0);
    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(1), false)
    ).to.emit(bundle, "TicketPurchaseMinted");
  });

  it("does not pay ticket purchase rebates when no floor tiers are configured", async function () {
    const { user, points, core, bundle } = await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);

    expect(await bundle.seriesRebateTierCount(0)).to.equal(0);
    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(4), false)
    ).to.not.emit(bundle, "TicketPurchaseRebatePaid");
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("960")
    );

    await bundle.setSeriesRebateTiers(0, [
      { minimumTicketQuantity: 3, rebatePoints: ethers.parseEther("100") },
    ]);
    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(4), false)
    )
      .to.emit(bundle, "TicketPurchaseRebatePaid")
      .withArgs(0, user.address, 4, ethers.parseEther("100"));
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("1020")
    );

    await bundle.setSeriesRebateTiers(0, []);
    expect(await bundle.seriesRebateTierCount(0)).to.equal(0);
    await expect(
      bundle.connect(user).mintTickets(0, zeroLuckyNumbers(4), false)
    ).to.not.emit(bundle, "TicketPurchaseRebatePaid");
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("980")
    );
  });

  it("runs a first-N free-order challenge and refunds the round net of its quantity rebate", async function () {
    const { user, other, points, vrf, router, core, bundle } =
      await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address, ethers.parseEther("2000"));

    await expect(bundle.setSeriesFreeOrderChallenge(0, 10, [1, 2, 3, 4]))
      .to.emit(bundle, "FreeOrderChallengeConfigured")
      .withArgs(0, 1, 10, [1, 2, 3, 4]);
    await bundle.setSeriesRebateTiers(0, [
      { minimumTicketQuantity: 5, rebatePoints: ethers.parseEther("5") },
    ]);

    await expect(
      bundle
        .connect(user)
        .mintFreeOrderChallenge(0, zeroLuckyNumbers(5), ethers.parseEther("50"))
    )
      .to.emit(bundle, "FreeOrderChallengePurchased")
      .withArgs(
        1,
        0,
        user.address,
        5,
        ethers.parseEther("50"),
        ethers.parseEther("5"),
        ethers.parseEther("45"),
        0
      )
      .and.to.emit(core, "RevealDrawSent")
      .withArgs(1, [0, 1, 2, 3, 4]);

    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("1955")
    );

    // The entire round must fit inside the configured first N tickets.
    await expect(
      bundle
        .connect(user)
        .mintFreeOrderChallenge(0, zeroLuckyNumbers(6), ethers.parseEther("60"))
    ).to.be.revertedWithCustomError(bundle, "FreeOrderChallengeNotEligible");
    await core.connect(user).mint(0, zeroLuckyNumbers(5));
    await expect(
      bundle
        .connect(user)
        .mintFreeOrderChallenge(0, zeroLuckyNumbers(1), ethers.parseEther("10"))
    ).to.be.revertedWithCustomError(bundle, "FreeOrderChallengeNotEligible");

    // A pending round keeps version 1 even if operations change the live trigger set.
    await bundle.setSeriesFreeOrderChallenge(0, 5, [4]);
    expect((await bundle.freeOrderChallengeConfigs(0)).version).to.equal(2);
    await vrf.fulfill(await router.getAddress(), 1, [123456]);

    // Settlement is permissionless, but the refund is always paid to the recorded buyer.
    await expect(bundle.connect(other).settleFreeOrderChallenge(1))
      .to.emit(bundle, "FreeOrderChallengeResult")
      .withArgs(
        1,
        0,
        user.address,
        true,
        ethers.parseEther("45"),
        anyValue,
        anyValue
      )
      .and.to.emit(bundle, "FreeOrderChallengeRefunded")
      .withArgs(1, 0, user.address, ethers.parseEther("45"));

    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("1950")
    );
    const round = await bundle.freeOrderChallengeRounds(1);
    expect(round.processed).to.equal(true);
    expect(round.won).to.equal(true);
    expect(round.claimed).to.equal(true);
    await expect(
      bundle.settleFreeOrderChallenge(1)
    ).to.be.revertedWithCustomError(bundle, "InvalidFreeOrderChallenge");
  });

  it("reverses membership and cashback for a winning database-points free-order refund", async function () {
    const {
      admin,
      user,
      points,
      vrf,
      router,
      core,
      bundle,
      membership,
      refund,
    } =
      await deploySplitSuite();
    await createSeries(core);
    await bundle.setSeriesFreeOrderChallenge(0, 10, [1, 2, 3, 4]);
    await bundle.setSeriesRebateTiers(0, [
      { minimumTicketQuantity: 5, rebatePoints: ethers.parseEther("5") },
    ]);
    await bundle.configureDatabasePointsAuthorization(
      admin.address,
      await membership.getAddress(),
      true
    );
    const now = await time.latest();
    await bundle.adminSetMembershipV2(
      user.address,
      2,
      ethers.parseEther("9000"),
      ethers.parseEther("9000"),
      now,
      ethers.id("free-order-refund-membership-start")
    );
    const luckyNumbers = zeroLuckyNumbers(5);
    const authorization = buildPointsMintAuthorization({
      authorizationId: ethers.id("db-points-free-order-refund"),
      buyer: user.address,
      seriesID: 0,
      luckyNumbers,
      grossPoints: ethers.parseEther("50"),
      deadline: (await time.latest()) + 600,
      revealImmediately: true,
      freeOrderChallenge: true,
    });
    await bundle
      .connect(user)
      .mintTicketsWithPointsAuthorization(
        authorization,
        luckyNumbers,
        await signPointsMintAuthorization(admin, bundle, authorization)
      );
    await vrf.fulfill(await router.getAddress(), 1, [123456]);

    const referenceId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "uint256"],
        ["FREE_ORDER_CHALLENGE", 1]
      )
    );

    await expect(bundle.settleFreeOrderChallenge(1))
      .to.emit(bundle, "DatabasePointsFreeOrderChallengeRefunded")
      .withArgs(1, 0, user.address, ethers.parseEther("45"))
      .and.to.emit(bundle, "DatabasePointsRefundSettlement")
      .withArgs(
        referenceId,
        0,
        user.address,
        ethers.parseEther("45"),
        ethers.parseEther("0.1125")
      )
      .and.to.emit(bundle, "FreeOrderChallengeRefunded")
      .withArgs(1, 0, user.address, ethers.parseEther("45"));

    expect(await points.balanceOf(user.address)).to.equal(0);
    const member = await membership.getMember(user.address);
    expect(member.currentQualifyingSpend).to.equal(ethers.parseEther("9000"));
    expect(member.lifetimeSpend).to.equal(ethers.parseEther("9000"));
    for (let tokenID = 0; tokenID < 5; tokenID += 1) {
      expect(await bundle.ticketDatabaseRefundSettled(tokenID)).to.equal(true);
    }
    await refund.setSeriesRefund(0, true, ethers.parseEther("10"));
    await refund.setDatabasePointsMode(true);
    await expect(
      refund.connect(user).claimRefund([0])
    ).to.be.revertedWithCustomError(bundle, "TicketRefundAlreadySettled");
  });

  it("enforces 1-10 tickets and lets the buyer retry a deferred free-order refund", async function () {
    const { admin, user, other, points, vrf, router, core, bundle } =
      await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);
    await expect(
      bundle.setSeriesFreeOrderChallenge(0, 61, [1])
    ).to.be.revertedWithCustomError(bundle, "InvalidFreeOrderChallenge");
    await bundle.setSeriesFreeOrderChallenge(0, 60, [1, 2, 3, 4]);

    await expect(
      bundle
        .connect(user)
        .mintFreeOrderChallenge(0, [], ethers.parseEther("10"))
    ).to.be.revertedWithCustomError(bundle, "InvalidFreeOrderChallenge");
    await expect(
      bundle
        .connect(user)
        .mintFreeOrderChallenge(
          0,
          zeroLuckyNumbers(11),
          ethers.parseEther("110")
        )
    ).to.be.revertedWithCustomError(bundle, "InvalidFreeOrderChallenge");

    await bundle
      .connect(user)
      .mintFreeOrderChallenge(0, zeroLuckyNumbers(1), ethers.parseEther("10"));
    await vrf.fulfill(await router.getAddress(), 1, [987654]);

    await points.revokeRole(
      await points.MINTER_ROLE(),
      await bundle.getAddress()
    );
    await expect(bundle.connect(other).settleFreeOrderChallenge(1))
      .to.emit(bundle, "FreeOrderChallengeRefundDeferred")
      .withArgs(1, 0, user.address, ethers.parseEther("10"));

    let round = await bundle.freeOrderChallengeRounds(1);
    expect(round.processed).to.equal(true);
    expect(round.won).to.equal(true);
    expect(round.claimed).to.equal(false);
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("990")
    );

    await points
      .connect(admin)
      .grantRole(await points.MINTER_ROLE(), await bundle.getAddress());
    await expect(bundle.connect(user).claimFreeOrderChallengeRefund(1))
      .to.emit(bundle, "FreeOrderChallengeRefunded")
      .withArgs(1, 0, user.address, ethers.parseEther("10"));
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("1000")
    );

    round = await bundle.freeOrderChallengeRounds(1);
    expect(round.claimed).to.equal(true);
    await expect(
      bundle.connect(user).claimFreeOrderChallengeRefund(1)
    ).to.be.revertedWithCustomError(bundle, "FreeOrderRefundAlreadyClaimed");
  });

  it("keeps the quantity rebate when a five-ticket free-order challenge loses", async function () {
    const { user, points, vrf, router, core, bundle } =
      await deploySplitSuite();
    await createSeries(core, { priceInPoints: ethers.parseEther("300") });
    await issuePoints(points, user.address, ethers.parseEther("2000"));
    await bundle.setSeriesFreeOrderChallenge(0, 60, [1]);
    await bundle.setSeriesRebateTiers(0, [
      { minimumTicketQuantity: 5, rebatePoints: ethers.parseEther("150") },
    ]);

    await expect(
      bundle
        .connect(user)
        .mintFreeOrderChallenge(
          0,
          zeroLuckyNumbers(5),
          ethers.parseEther("1500")
        )
    )
      .to.emit(bundle, "TicketPurchaseRebatePaid")
      .withArgs(0, user.address, 5, ethers.parseEther("150"))
      .and.to.emit(bundle, "FreeOrderChallengePurchased")
      .withArgs(
        1,
        0,
        user.address,
        5,
        ethers.parseEther("1500"),
        ethers.parseEther("150"),
        ethers.parseEther("1350"),
        0
      );
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("650")
    );

    const coder = ethers.AbiCoder.defaultAbiCoder();
    let randomWord = 0n;
    const hitsTriggerPrize = (candidate) => {
      const remainingQuantities = [10n, 10n, 10n, 30n];
      for (let tokenID = 0; tokenID < 5; tokenID += 1) {
        const totalRemaining = remainingQuantities.reduce(
          (total, quantity) => total + quantity,
          0n
        );
        const winningIndex =
          BigInt(
            ethers.keccak256(
              coder.encode(
                ["uint256", "uint256", "uint256"],
                [candidate, tokenID, tokenID]
              )
            )
          ) % totalRemaining;
        let cursor = 0n;
        for (
          let prizeIndex = 0;
          prizeIndex < remainingQuantities.length;
          prizeIndex += 1
        ) {
          cursor += remainingQuantities[prizeIndex];
          if (winningIndex < cursor) {
            if (prizeIndex === 0) return true;
            remainingQuantities[prizeIndex] -= 1n;
            break;
          }
        }
      }
      return false;
    };
    while (hitsTriggerPrize(randomWord)) {
      randomWord += 1n;
    }
    await vrf.fulfill(await router.getAddress(), 1, [randomWord]);

    await expect(bundle.settleFreeOrderChallenge(1))
      .to.emit(bundle, "FreeOrderChallengeResult")
      .withArgs(1, 0, user.address, false, 0, 0, 0)
      .and.to.not.emit(bundle, "FreeOrderChallengeRefunded")
      .and.to.not.emit(bundle, "FreeOrderChallengeEnded");

    // The buyer paid 1,500 points and keeps the 150-point quantity rebate.
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("650")
    );
    const round = await bundle.freeOrderChallengeRounds(1);
    expect(round.processed).to.equal(true);
    expect(round.won).to.equal(false);
    expect(round.claimed).to.equal(false);
  });

  it("automatically ends a free-order challenge after every trigger prize is exhausted", async function () {
    const { user, points, vrf, router, core, bundle } =
      await deploySplitSuite();
    await createSeries(core, {}, [
      {
        subPrizeID: 1,
        prizeGroup: "A",
        subPrizeName: "A1",
        subPrizeRemainingQuantity: 1,
      },
      {
        subPrizeID: 2,
        prizeGroup: "B",
        subPrizeName: "B1",
        subPrizeRemainingQuantity: 1,
      },
      {
        subPrizeID: 3,
        prizeGroup: "C",
        subPrizeName: "C1",
        subPrizeRemainingQuantity: 58,
      },
    ]);
    await issuePoints(points, user.address);
    await bundle.setSeriesFreeOrderChallenge(0, 60, [1, 2]);

    const coder = ethers.AbiCoder.defaultAbiCoder();
    const randomWordForFirstRemainingPrize = (tokenID, totalRemaining) => {
      let randomWord = 0n;
      while (
        BigInt(
          ethers.keccak256(
            coder.encode(
              ["uint256", "uint256", "uint256"],
              [randomWord, tokenID, 0]
            )
          )
        ) %
          BigInt(totalRemaining) !==
        0n
      ) {
        randomWord += 1n;
      }
      return randomWord;
    };

    // A normal (non-challenge) draw exhausts A, but B keeps the challenge active.
    await core.connect(user).mint(0, [0]);
    await core.connect(user).reveal(0, [0]);
    await vrf.fulfill(await router.getAddress(), 1, [
      randomWordForFirstRemainingPrize(0, 60),
    ]);
    expect(await core.seriesSubPrizeRemainingQuantity(0, 1)).to.equal(0);
    expect((await bundle.freeOrderChallengeConfigs(0)).active).to.equal(true);

    // This round is recorded before B is exhausted and remains settleable afterward.
    await bundle
      .connect(user)
      .mintFreeOrderChallenge(0, [0], ethers.parseEther("10"));
    await vrf.fulfill(await router.getAddress(), 2, [
      randomWordForFirstRemainingPrize(1, 59),
    ]);

    expect(await core.seriesSubPrizeRemainingQuantity(0, 2)).to.equal(0);

    // Revealing the winning ticket does not scan inventory or end the challenge.
    expect((await bundle.freeOrderChallengeConfigs(0)).active).to.equal(true);
    expect(await bundle.isSeriesFreeOrderTriggerPrize(0, 2)).to.equal(true);

    await expect(bundle.settleFreeOrderChallenge(2))
      .to.emit(bundle, "FreeOrderChallengeResult")
      .withArgs(2, 0, user.address, true, ethers.parseEther("10"), 1, 2)
      .and.to.emit(bundle, "FreeOrderChallengeEnded")
      .withArgs(0, 1)
      .and.to.emit(bundle, "FreeOrderChallengeRefunded")
      .withArgs(2, 0, user.address, ethers.parseEther("10"));
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("990")
    );
    expect((await bundle.freeOrderChallengeConfigs(0)).active).to.equal(false);
    expect(await bundle.isSeriesFreeOrderTriggerPrize(0, 2)).to.equal(false);
    await expect(
      bundle
        .connect(user)
        .mintFreeOrderChallenge(0, [0], ethers.parseEther("10"))
    ).to.be.revertedWithCustomError(bundle, "FreeOrderChallengeNotEligible");

    await expect(
      bundle.setSeriesFreeOrderChallenge(0, 60, [1, 2])
    ).to.be.revertedWithCustomError(bundle, "InvalidFreeOrderChallenge");
  });

  it("rejects invalid ticket quantity purchases", async function () {
    const { user, core, bundle } = await deploySplitSuite();

    await expect(
      bundle.connect(user).mintTickets(0, [], false)
    ).to.be.revertedWithCustomError(bundle, "InvalidConfig");
    await expect(
      bundle.connect(user).mintTickets(999, [0], false)
    ).to.be.revertedWithCustomError(bundle, "InvalidConfig");
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
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("1000")
    );
  });

  it("emits a database-points refund entitlement without minting legacy points", async function () {
    const { user, points, core, refund } = await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0]);
    await refund.setSeriesRefund(0, true, ethers.parseEther("8"));
    await refund.setDatabasePointsMode(true);

    await expect(refund.connect(user).claimRefund([0, 1]))
      .to.emit(refund, "DatabasePointsRefundClaimed")
      .withArgs(0, user.address, [0, 1], ethers.parseEther("20"))
      .and.to.emit(refund, "RefundClaimed")
      .withArgs(0, user.address, [0, 1], ethers.parseEther("20"));

    await expect(core.ownerOf(0)).to.be.reverted;
    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("980")
    );
  });

  it("reverses database-points membership progress and its per-ticket cashback on refund", async function () {
    const { admin, user, other, core, bundle, membership, refund } =
      await deploySplitSuite();
    await createSeries(core, { priceInPoints: ethers.parseEther("100") });
    await bundle.configureDatabasePointsAuthorization(
      admin.address,
      await membership.getAddress(),
      true
    );
    const now = await time.latest();
    await bundle.adminSetMembershipV2(
      user.address,
      2,
      ethers.parseEther("9000"),
      ethers.parseEther("9000"),
      now,
      ethers.id("refund-membership-start")
    );
    const luckyNumbers = zeroLuckyNumbers(2);
    const authorization = buildPointsMintAuthorization({
      authorizationId: ethers.id("refundable-db-points-mint"),
      buyer: user.address,
      seriesID: 0,
      luckyNumbers,
      grossPoints: ethers.parseEther("200"),
      deadline: (await time.latest()) + 600,
    });
    await bundle
      .connect(user)
      .mintTicketsWithPointsAuthorization(
        authorization,
        luckyNumbers,
        await signPointsMintAuthorization(admin, bundle, authorization)
      );

    expect(await bundle.ticketMembershipRewardPoints(0)).to.equal(
      ethers.parseEther("0.25")
    );
    expect(await bundle.ticketMembershipRewardPoints(1)).to.equal(
      ethers.parseEther("0.25")
    );
    await refund.setSeriesRefund(0, true, ethers.parseEther("100"));
    await refund.setDatabasePointsMode(true);
    const referenceId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "address", "uint256[]"],
        ["SERIES_REFUND", user.address, [0]]
      )
    );

    await expect(refund.connect(user).claimRefund([0]))
      .to.emit(membership, "MembershipConsumptionReversed")
      .withArgs(
        referenceId,
        user.address,
        1,
        ethers.parseEther("100"),
        2,
        2,
        ethers.parseEther("9100"),
        ethers.parseEther("9100")
      )
      .and.to.emit(refund, "DatabasePointsRefundSettlement")
      .withArgs(
        referenceId,
        0,
        user.address,
        ethers.parseEther("100"),
        ethers.parseEther("0.25")
      );

    const member = await membership.getMember(user.address);
    expect(member.currentQualifyingSpend).to.equal(ethers.parseEther("9100"));
    expect(member.lifetimeSpend).to.equal(ethers.parseEther("9100"));
    expect(await bundle.ticketDatabaseRefundSettled(0)).to.equal(true);
    await expect(
      bundle.consumeTicketRefundAccounting(1)
    ).to.be.revertedWithCustomError(bundle, "UnauthorizedRefundModule");

    await core
      .connect(user)
      .transferFrom(user.address, other.address, 1);
    await expect(refund.connect(other).claimRefund([1]))
      .to.be.revertedWithCustomError(refund, "RefundBuyerMismatch")
      .withArgs(1, user.address, other.address);
    expect(await core.ownerOf(1)).to.equal(other.address);
    expect(await bundle.ticketDatabaseRefundSettled(1)).to.equal(false);
    const unchangedMember = await membership.getMember(user.address);
    expect(unchangedMember.currentQualifyingSpend).to.equal(
      ethers.parseEther("9100")
    );
    expect(unchangedMember.lifetimeSpend).to.equal(ethers.parseEther("9100"));
  });

  it("redraws main prizes by burning revealed tickets and requesting reveal for replacements", async function () {
    const { user, points, vrf, router, core, redraw } =
      await deploySplitSuite();
    await createSeries(core);
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0]);
    await core.connect(user).reveal(0, [0, 1]);
    await vrf.fulfill(await router.getAddress(), 1, [777]);
    await redraw.setRedrawConfig(0, 2, 0);

    await expect(redraw.connect(user).redrawMain(0, [0, 1]))
      .to.emit(redraw, "RedrawMinted")
      .withArgs(0, user.address, 2, 2)
      .and.to.emit(core, "NewTicketStatus")
      .and.to.emit(core, "RevealDrawSent")
      .withArgs(2, [2, 3]);

    await expect(core.ownerOf(0)).to.be.reverted;
    await expect(core.ownerOf(1)).to.be.reverted;
    expect(await core.ownerOf(2)).to.equal(user.address);
    expect(await core.ownerOf(3)).to.equal(user.address);
    expect((await core.ticketStatusDetail(2)).tokenRevealed).to.equal(false);
    expect(await core.balanceOf(user.address)).to.equal(2);
  });

  it("redraws main prizes by burning the configured count and minting the configured count", async function () {
    const { user, points, vrf, router, core, redraw } =
      await deploySplitSuite();
    await createSeries(core, { useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0, 0]);
    await core.connect(user).reveal(0, [0, 1]);
    await vrf.fulfill(await router.getAddress(), 1, [777]);

    await redraw.setRedrawMainConfig(0, 2, 1);

    await expect(redraw.connect(user).redrawMain(0, [0, 1]))
      .to.emit(redraw, "RedrawMinted")
      .withArgs(0, user.address, 1, 3)
      .and.to.emit(core, "RevealDrawSent")
      .withArgs(2, [3]);

    await expect(core.ownerOf(0)).to.be.reverted;
    await expect(core.ownerOf(1)).to.be.reverted;
    expect(await core.ownerOf(2)).to.equal(user.address);
    expect(await core.ownerOf(3)).to.equal(user.address);
    expect((await core.ticketStatusDetail(3)).tokenRevealed).to.equal(false);
    expect(await core.balanceOf(user.address)).to.equal(2);
  });

  it("rejects main redraws that do not burn the configured count", async function () {
    const { user, points, vrf, router, core, redraw } =
      await deploySplitSuite();
    await createSeries(core, { useLuckyNumber: false, maxPerWallet: 0 });
    await issuePoints(points, user.address);
    await core.connect(user).mint(0, [0, 0]);
    await core.connect(user).reveal(0, [0, 1]);
    await vrf.fulfill(await router.getAddress(), 1, [777]);

    await redraw.setRedrawMainConfig(0, 2, 1);

    await expect(
      redraw.connect(user).redrawMain(0, [0])
    ).to.be.revertedWithCustomError(redraw, "RedrawCountMismatch");
  });

  it("claims collection rewards through the collection reward module", async function () {
    const { user, points, vrf, router, core, reward, book } =
      await deploySplitSuite();
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
      [
        {
          sourceContract: await core.getAddress(),
          seriesID: 0,
          prizeId: revealed.tokenRevealedPrize,
          quantity: 1,
        },
      ],
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

    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("1005")
    );
  });

  it("emits a database-points entitlement for a collection points reward", async function () {
    const { user, points, vrf, router, core, reward, book } =
      await deploySplitSuite();
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
    await reward.setDatabasePointsMode(true);
    await book.createBook(
      "Database points reward book",
      [
        {
          sourceContract: await core.getAddress(),
          seriesID: 0,
          prizeId: revealed.tokenRevealedPrize,
          quantity: 1,
        },
      ],
      1,
      0,
      true
    );
    await core.connect(user).approve(await book.getAddress(), 0);
    await book.connect(user).depositToBook(0, [0]);

    await expect(book.connect(user).claimBook(0))
      .to.emit(reward, "DatabasePointsCollectionRewardEntitled")
      .withArgs(0, user.address, ethers.parseEther("15"))
      .and.to.emit(reward, "CollectionRewardMinted")
      .withArgs(0, user.address, 1, ethers.parseEther("15"), 0);

    expect(await points.balanceOf(user.address)).to.equal(
      ethers.parseEther("990")
    );
  });
});
