const { expect } = require("chai");
const { ethers, upgrades, artifacts } = require("hardhat");
const {
  deployFixedProbabilityProxy,
  fixedProbabilityFactory,
} = require("./helpers/fixed-probability-uups");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FixedProbabilityLotteryV3 native buyback", function () {
  async function fixture() {
    const [admin, signer, operator, buyer, other, upgrader] =
      await ethers.getSigners();
    const Router = await ethers.getContractFactory(
      "FixedProbabilityV3RouterMock",
    );
    const router = await Router.deploy();
    const Membership = await ethers.getContractFactory(
      "FixedProbabilityV3MembershipMock",
    );
    const membership = await Membership.deploy();
    const { lottery, libraries, factory } = await deployFixedProbabilityProxy([
      await router.getAddress(),
      signer.address,
      operator.address,
      await membership.getAddress(),
      admin.address,
      upgrader.address,
    ]);
    await Promise.all([
      router.waitForDeployment(),
      membership.waitForDeployment(),
      lottery.waitForDeployment(),
    ]);

    await lottery.grantRole(
      await lottery.BUYBACK_AUTHORIZER_ROLE(),
      signer.address,
    );
    const config = {
      pricePoints: ethers.parseEther("100"),
      drawCap: 0,
      maxBatchSize: 10,
      prizeIds: [1, 2, 3],
      weights: [2000, 3000, 5000],
      discountQuantities: [5, 10],
      discountPoints: [ethers.parseEther("50"), ethers.parseEther("100")],
      freeOrderMode: 2,
      freeOrderFirstDraws: 0,
      freeOrderPrizeIds: [1],
      gateMode: 1,
      minMemberLevel: 2,
      eligibilityPolicyId: ethers.ZeroHash,
      eligibilityScope: ethers.ZeroHash,
      maxEligibleDraws: 0,
      contentHash: ethers.keccak256(ethers.toUtf8Bytes("series manifest")),
      contentURI: "ipfs://series-v3.json",
    };
    await lottery.connect(operator).createSeries(config);
    await lottery.connect(operator).setSeriesStatus(1, 2);
    return {
      admin,
      signer,
      operator,
      buyer,
      other,
      router,
      membership,
      lottery,
      libraries,
      factory,
      upgrader,
    };
  }

  async function authorizationFor(f, overrides = {}) {
    const quantity = overrides.quantity ?? 5;
    const [grossPoints, rebatePoints, netPoints] = await f.lottery.quoteOrder(
      1,
      quantity,
    );
    const authorization = {
      authorizationId:
        overrides.authorizationId ?? ethers.keccak256(ethers.randomBytes(32)),
      buyer: f.buyer.address,
      seriesId: 1,
      configHash: (await f.lottery.getSeries(1)).configHash,
      quantity,
      grossPoints,
      rebatePoints,
      netPoints,
      freeOrderChallenge: overrides.freeOrderChallenge ?? false,
      eligibilityKey: ethers.ZeroHash,
      deadline: await time.latest().then((now) => now + 3600),
    };
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const signature = await f.signer.signTypedData(
      {
        name: "FixedProbabilityLottery",
        version: "3",
        chainId,
        verifyingContract: await f.lottery.getAddress(),
      },
      {
        DrawAuthorization: [
          { name: "authorizationId", type: "bytes32" },
          { name: "buyer", type: "address" },
          { name: "seriesId", type: "uint256" },
          { name: "configHash", type: "bytes32" },
          { name: "quantity", type: "uint16" },
          { name: "grossPoints", type: "uint256" },
          { name: "rebatePoints", type: "uint256" },
          { name: "netPoints", type: "uint256" },
          { name: "freeOrderChallenge", type: "bool" },
          { name: "eligibilityKey", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      authorization,
    );
    return { authorization, signature };
  }

  async function ready(f, quantity = 2) {
    const { authorization, signature } = await authorizationFor(f, {
      quantity,
    });
    await f.lottery.connect(f.buyer).requestDraws(authorization, signature);
    await f.router.fulfill(1, Array(quantity).fill(9000));
  }
  async function signed(
    f,
    patch = {},
    ids = [1n, 2n],
    points = [30n, 10n],
    domainPatch = {},
  ) {
    const target = await f.lottery.getAddress();
    const auth = {
      batchId: ethers.id("native-buyback"),
      buyer: f.buyer.address,
      coreAddress: target,
      itemsHash: ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256[]", "uint256[]"],
          [ids, points],
        ),
      ),
      quoteHash: ethers.id("accepted-quote"),
      totalPoints: points.reduce((a, b) => a + b, 0n),
      deadline: (await time.latest()) + 300,
      ...patch,
    };
    const types = {
      BuybackAuthorization: [
        { name: "batchId", type: "bytes32" },
        { name: "buyer", type: "address" },
        { name: "coreAddress", type: "address" },
        { name: "itemsHash", type: "bytes32" },
        { name: "quoteHash", type: "bytes32" },
        { name: "totalPoints", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const domain = {
      name: "DOUDO Prize Buyback",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: target,
      ...domainPatch,
    };
    const signature = await f.signer.signTypedData(domain, types, auth);
    return [auth, ids, points, signature];
  }
  it("burns with the exact entitlement and preserves draw, order, accounting and supply-cap facts", async () => {
    const f = await fixture();
    await ready(f);
    const order = await f.lottery.getOrder(1),
      series = await f.lottery.getSeries(1);
    const args = await signed(f);
    await expect(f.lottery.connect(f.buyer).buyback(...args))
      .to.emit(f.lottery, "PrizeBuybackBurned")
      .withArgs(
        args[0].batchId,
        f.buyer.address,
        await f.lottery.getAddress(),
        args[1],
        args[2],
        40,
        args[0].quoteHash,
      );
    await expect(f.lottery.ownerOf(1)).to.be.reverted;
    expect(await f.lottery.consumed(args[0].batchId)).to.equal(true);
    expect((await f.lottery.getDraw(1)).exchanged).to.equal(false);
    expect((await f.lottery.getDraw(1)).prizeId).to.equal(3);
    expect(await f.lottery.getOrder(1)).to.deep.equal(order);
    expect((await f.lottery.getSeries(1)).acceptedDraws).to.equal(
      series.acceptedDraws,
    );
    await expect(f.lottery.connect(f.buyer).buyback(...args)).to.be.reverted;
  });
  it("rejects unminted, unrevealed, transferred, exchanged and operator-submitted assets atomically", async () => {
    const f = await fixture();
    await ready(f);
    const args = await signed(f);
    await expect(f.lottery.connect(f.other).buyback(...args)).to.be.reverted;
    await f.lottery
      .connect(f.buyer)
      .transferFrom(f.buyer.address, f.other.address, 2);
    await expect(f.lottery.connect(f.buyer).buyback(...args)).to.be.reverted;
    expect(await f.lottery.ownerOf(1)).to.equal(f.buyer.address);
    expect(await f.lottery.consumed(args[0].batchId)).to.equal(false);
    await expect(
      f.lottery
        .connect(f.buyer)
        .buyback(...(await signed(f, {}, [999n], [1n]))),
    ).to.be.reverted;
    await f.lottery.connect(f.buyer).exchangePrize([1]);
    await expect(
      f.lottery.connect(f.buyer).buyback(...(await signed(f, {}, [1n], [1n]))),
    ).to.be.reverted;
    const pending = await authorizationFor(f, { quantity: 1 });
    await f.lottery
      .connect(f.buyer)
      .requestDraws(pending.authorization, pending.signature);
    await expect(
      f.lottery.connect(f.buyer).buyback(...(await signed(f, {}, [3n], [1n]))),
    ).to.be.reverted;
  });
  it("binds the separate buyback domain, caller, NFT target, amounts and signer role", async () => {
    const f = await fixture();
    await ready(f);
    for (const patch of [
      { coreAddress: f.other.address },
      { buyer: f.other.address },
      { quoteHash: ethers.ZeroHash },
      { batchId: ethers.ZeroHash },
      { deadline: (await time.latest()) - 1 },
      { totalPoints: 41n },
    ])
      await expect(
        f.lottery.connect(f.buyer).buyback(...(await signed(f, patch))),
      ).to.be.reverted;
    for (const patch of [
      { name: "FixedProbabilityLottery", version: "3" },
      { chainId: 1 },
      { verifyingContract: f.other.address },
    ])
      await expect(
        f.lottery
          .connect(f.buyer)
          .buyback(...(await signed(f, {}, undefined, undefined, patch))),
      ).to.be.reverted;
    await f.lottery.revokeRole(
      await f.lottery.BUYBACK_AUTHORIZER_ROLE(),
      f.signer.address,
    );
    await expect(f.lottery.connect(f.buyer).buyback(...(await signed(f)))).to.be
      .reverted;
  });
  it("rejects duplicate, unordered, zero and oversized items without consuming authorization", async () => {
    const f = await fixture();
    await ready(f);
    for (const [ids, points] of [
      [[], []],
      [
        [1n, 1n],
        [1n, 1n],
      ],
      [
        [2n, 1n],
        [1n, 1n],
      ],
      [[1n], [0n]],
      [Array.from({ length: 51 }, (_, i) => BigInt(i + 1)), Array(51).fill(1n)],
    ])
      await expect(
        f.lottery
          .connect(f.buyer)
          .buyback(...(await signed(f, {}, ids, points))),
      ).to.be.reverted;
  });
  it("accepts deadline equality and rejects one second later; honors pause", async () => {
    const f = await fixture();
    await ready(f);
    const end = (await time.latest()) + 60;
    const args = await signed(f, { deadline: end }, [1n], [1n]);
    await time.setNextBlockTimestamp(end);
    await f.lottery.connect(f.buyer).buyback(...args);
    await expect(
      f.lottery
        .connect(f.buyer)
        .buyback(...(await signed(f, { deadline: end }, [2n], [1n]))),
    ).to.be.reverted;
    await f.lottery.connect(f.operator).pause();
    await expect(
      f.lottery.connect(f.buyer).buyback(...(await signed(f, {}, [2n], [1n]))),
    ).to.be.reverted;
  });
  it("supports 50 tokens within EIP-170 and records bounded local gas", async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) {
      const a = await authorizationFor(f, { quantity: 10 });
      await f.lottery
        .connect(f.buyer)
        .requestDraws(a.authorization, a.signature);
      await f.router.fulfill(i + 1, Array(10).fill(9000));
    }
    const ids = Array.from({ length: 50 }, (_, i) => BigInt(i + 1));
    const tx = await f.lottery
      .connect(f.buyer)
      .buyback(...(await signed(f, {}, ids, Array(50).fill(1n))));
    expect((await tx.wait()).gasUsed).to.be.lessThan(5000000n);
    expect(
      ((
        await ethers.provider.getCode(
          await upgrades.erc1967.getImplementationAddress(
            await f.lottery.getAddress(),
          ),
        )
      ).length -
        2) /
        2,
    ).to.be.at.most(24576);
    expect(await f.lottery.balanceOf(f.buyer.address)).to.equal(0);
  });
  it("preserves all legacy callable selectors, return tuples and indexed workflow events", async () => {
    const f = await fixture();
    const legacy = new ethers.Interface(
      (await artifacts.readArtifact("FixedProbabilityLotteryV3")).abi,
    );
    const shape = (p) => ({
      name: p.name,
      type: p.type,
      ...(p.components ? { components: p.components.map(shape) } : {}),
    });
    for (const fn of legacy.fragments.filter((x) => x.type === "function")) {
      const actual = f.factory.interface.getFunction(fn.format("sighash"));
      expect(actual, fn.name).not.to.equal(null);
      expect(actual.selector).to.equal(
        legacy.getFunction(fn.format("sighash")).selector,
      );
      expect(actual.inputs.map(p=>({...shape(p),name:""}))).to.deep.equal(fn.inputs.map(p=>({...shape(p),name:""})));
      expect(actual.outputs.map(shape)).to.deep.equal(fn.outputs.map(shape));
    }
    for (const name of [
      "OrderRequested",
      "DrawSettled",
      "OrderSettled",
      "OrderAccountingFinalized",
      "Transfer",
      "NewTicketStatus",
      "UpdateTicketStatus",
      "DatabasePointsPurchaseMinted",
      "DatabasePointsFreeOrderChallengeRefunded",
      "SeriesCreated",
    ]) {
      const previous = legacy.getEvent(name),
        actual = f.factory.interface.getEvent(name);
      expect(actual.topicHash).to.equal(previous.topicHash);
      expect(
        actual.inputs.map((p) => ({ ...shape(p), indexed: p.indexed })),
      ).to.deep.equal(
        previous.inputs.map((p) => ({ ...shape(p), indexed: p.indexed })),
      );
    }
  });
  it("locks implementation initialization, rejects repeated initialization and separates upgrade authority", async () => {
    const f = await fixture();
    const args = [
      await f.router.getAddress(),
      f.signer.address,
      f.operator.address,
      await f.membership.getAddress(),
      f.admin.address,
      f.upgrader.address,
    ];
    const implementation = f.factory.attach(
      await upgrades.erc1967.getImplementationAddress(
        await f.lottery.getAddress(),
      ),
    );
    await expect(implementation.initialize(...args)).to.be.revertedWith(
      "Initializable: contract is already initialized",
    );
    await expect(f.lottery.initialize(...args)).to.be.revertedWith(
      "Initializable: contract is already initialized",
    );
    expect(await implementation.proxiableUUID()).to.equal(
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    );
    await expect(f.lottery.proxiableUUID()).to.be.reverted;
    const next = await f.factory.deploy();
    for (const user of [f.other, f.admin, f.operator, f.signer])
      await expect(f.lottery.connect(user).upgradeTo(await next.getAddress()))
        .to.be.revertedWithCustomError(f.lottery, "MissingRole")
        .withArgs(await f.lottery.UPGRADER_ROLE(), user.address);
    await expect(implementation.upgradeTo(await next.getAddress())).to.be
      .reverted;
    await expect(
      f.lottery.connect(f.upgrader).upgradeTo(await f.router.getAddress()),
    ).to.be.reverted;
    expect(
      await f.lottery.hasRole(
        await f.lottery.BUYBACK_AUTHORIZER_ROLE(),
        f.upgrader.address,
      ),
    ).to.equal(false);
    for (let i = 0; i < args.length; i++) {
      const invalid = [...args];
      invalid[i] = ethers.ZeroAddress;
      await expect(
        deployFixedProbabilityProxy(invalid),
      ).to.be.revertedWithCustomError(f.lottery, "InvalidConfig");
    }
  });
  it("preserves proxy NFTs, pending VRF, accounting, claims and pre-upgrade authorizations across a validated upgrade", async () => {
    const f = await fixture();
    await ready(f, 3);
    const auth = await signed(f, {}, [1n], [1n]);
    const used = auth[0].batchId;
    const spent = await signed(
      f,
      { batchId: ethers.id("already-burned-before-upgrade") },
      [2n],
      [1n],
    );
    await f.lottery.connect(f.buyer).buyback(...spent);
    const pending = await authorizationFor(f, { quantity: 1 });
    await f.lottery
      .connect(f.buyer)
      .requestDraws(pending.authorization, pending.signature);
    await f.lottery.connect(f.buyer).exchangePrize([3]);
    await f.lottery.connect(f.buyer).approve(f.other.address, 1);
    await f.lottery.connect(f.operator).pause();
    const before = {
      series: await f.lottery.getSeries(1),
      order: await f.lottery.getOrder(1),
      draw: await f.lottery.getDraw(1),
      nextDrawId: await f.lottery.nextDrawId(),
      requestToOrder: await f.lottery.requestToOrder(2),
      domain: await f.lottery.eip712Domain(),
      digest: await f.lottery.buybackAuthorizationDigest(auth[0]),
    };
    const V2 = await fixedProbabilityFactory(
      f.libraries,
      f.upgrader,
      "FixedProbabilityLotteryV3UpgradeableV2",
    );
    await upgrades.validateUpgrade(await f.lottery.getAddress(), V2, {
      kind: "uups",
      unsafeAllowLinkedLibraries: true,
    });
    const upgraded = await upgrades.upgradeProxy(
      await f.lottery.getAddress(),
      V2,
      {
        kind: "uups",
        unsafeAllowLinkedLibraries: true,
        call: { fn: "initializeV2", args: [42] },
      },
    );
    expect(
      ((await ethers.provider.getCode(await upgraded.getAddress())).length -
        2) /
        2,
    ).to.be.at.most(24576);
    expect(
      ((
        await ethers.provider.getCode(
          await upgrades.erc1967.getImplementationAddress(
            await upgraded.getAddress(),
          ),
        )
      ).length -
        2) /
        2,
    ).to.be.at.most(24576);
    expect(await upgraded.revision()).to.equal(2);
    expect(await upgraded.upgradeMarker()).to.equal(42);
    expect(await upgraded.getAddress()).to.equal(await f.lottery.getAddress());
    expect(await upgraded.getSeries(1)).to.deep.equal(before.series);
    expect(await upgraded.getOrder(1)).to.deep.equal(before.order);
    expect(await upgraded.getDraw(1)).to.deep.equal(before.draw);
    expect(await upgraded.ownerOf(1)).to.equal(f.buyer.address);
    expect(await upgraded.nextDrawId()).to.equal(before.nextDrawId);
    expect(await upgraded.requestToOrder(2)).to.equal(before.requestToOrder);
    expect(await upgraded.eip712Domain()).to.deep.equal(before.domain);
    expect(await upgraded.buybackAuthorizationDigest(auth[0])).to.equal(
      before.digest,
    );
    expect(await upgraded.consumed(spent[0].batchId)).to.equal(true);
    expect((await upgraded.getDraw(3)).exchanged).to.equal(true);
    expect(
      await upgraded.hasRole(
        await upgraded.UPGRADER_ROLE(),
        f.upgrader.address,
      ),
    ).to.equal(true);
    await expect(upgraded.initializeV2(7)).to.be.reverted;
    expect(await upgraded.getApproved(1)).to.equal(f.other.address);
    expect(await upgraded.paused()).to.equal(true);
    await upgraded.connect(f.operator).unpause();
    await f.router.fulfill(2, [9000]);
    expect((await upgraded.getOrder(2)).state).to.equal(3);
    await upgraded.connect(f.buyer).buyback(...auth);
    expect(await upgraded.consumed(used)).to.equal(true);
    await expect(upgraded.connect(f.buyer).buyback(...spent)).to.be.reverted;
    await upgraded.connect(f.buyer).exchangePrize([4]);
    await upgraded.finalizeOrderAccounting(1);
    expect((await upgraded.getOrder(1)).accountingFinalized).to.equal(true);
    const Bad = await fixedProbabilityFactory(
      f.libraries,
      f.upgrader,
      "FixedProbabilityLotteryV3Incompatible",
    );
    await expect(
      upgrades.validateUpgrade(await upgraded.getAddress(), Bad, {
        kind: "uups",
        unsafeAllowLinkedLibraries: true,
      }),
    ).to.be.rejected;
  });
});

describe("native buyback pure validation parity", function () {
  it("keeps the same invalid SeriesConfig selectors as the V3 core", async function () {
    const [admin, signer, operator] = await ethers.getSigners();
    const router = await (
      await ethers.getContractFactory("FixedProbabilityV3RouterMock")
    ).deploy();
    const membership = await (
      await ethers.getContractFactory("FixedProbabilityV3MembershipMock")
    ).deploy();
    const original = await (
      await ethers.getContractFactory("FixedProbabilityLotteryV3")
    ).deploy(
      await router.getAddress(),
      signer.address,
      operator.address,
      await membership.getAddress(),
    );
    const { lottery: native } = await deployFixedProbabilityProxy([
      await router.getAddress(),
      signer.address,
      operator.address,
      await membership.getAddress(),
      admin.address,
      admin.address,
    ]);
    const config = {
      pricePoints: 100n,
      drawCap: 0n,
      maxBatchSize: 10,
      prizeIds: [1n, 2n],
      weights: [5000, 5000],
      discountQuantities: [],
      discountPoints: [],
      freeOrderMode: 0,
      freeOrderFirstDraws: 0n,
      freeOrderPrizeIds: [],
      gateMode: 0,
      minMemberLevel: 0,
      eligibilityPolicyId: ethers.ZeroHash,
      eligibilityScope: ethers.ZeroHash,
      maxEligibleDraws: 0n,
      contentHash: ethers.id("content"),
      contentURI: "ipfs://series",
    };
    await original.connect(operator).createSeries(config);
    await native.connect(operator).createSeries(config);
    for (const patch of [
      { pricePoints: 0n },
      { maxBatchSize: 11 },
      { prizeIds: [1n, 1n] },
      { weights: [4999, 5000] },
      { weights: [0, 10000] },
      { discountQuantities: [2, 1], discountPoints: [0n, 0n] },
      { freeOrderMode: 1 },
      { gateMode: 3 },
      { contentURI: "" },
      { contentURI: "x".repeat(513) },
    ]) {
      await expect(
        original.connect(operator).createSeries({ ...config, ...patch }),
      ).to.be.revertedWithCustomError(original, "InvalidConfig");
      await expect(
        native.connect(operator).createSeries({ ...config, ...patch }),
      ).to.be.revertedWithCustomError(native, "InvalidConfig");
    }
  });
});
