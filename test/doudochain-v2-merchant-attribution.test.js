const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const ZERO32 = ethers.ZeroHash;
const MERCHANT_A = ethers.keccak256(ethers.toUtf8Bytes("merchant-A"));
const MERCHANT_B = ethers.keccak256(ethers.toUtf8Bytes("merchant-B"));

function prizeTable(total = 6) {
  return [
    { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 2 },
    { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: total - 2 },
  ];
}

function seriesInput(overrides = {}) {
  return {
    seriesName: "Merchant Series",
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

async function deployRegistryOnly() {
  const [admin, human, user, other] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory(
    "contracts/MerchantSeriesRegistry.sol:MerchantSeriesRegistry"
  );
  const registry = await upgrades.deployProxy(Registry, [admin.address], {
    initializer: "initialize",
    kind: "uups",
  });
  await registry.waitForDeployment();
  await registry.grantRole(await registry.LINKER_ROLE(), admin.address);
  return { admin, human, user, other, registry };
}

async function deployFullSuite() {
  const [admin, operator, human, user] = await ethers.getSigners();

  const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
  const points = await Points.deploy(admin.address, admin.address);
  await points.waitForDeployment();
  const routerPlaceholder = admin.address;

  const Core = await ethers.getContractFactory(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable"
  );
  const core = await upgrades.deployProxy(
    Core,
    [await points.getAddress(), routerPlaceholder],
    { initializer: "initialize", kind: "uups" }
  );
  await core.waitForDeployment();

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
  const publisher = await Publisher.deploy(admin.address, await registry.getAddress());
  await publisher.waitForDeployment();

  await core.grantRole(await core.OPERATION_ROLE(), await publisher.getAddress());
  await registry.grantRole(await registry.LINKER_ROLE(), await publisher.getAddress());
  await publisher.grantRole(await publisher.PUBLISHER_OPERATION_ROLE(), operator.address);

  return { admin, operator, human, user, points, core, registry, publisher };
}

describe("Merchant publish - atomic flow", function () {
  it("publishes a series and links the merchant in one transaction", async function () {
    const { operator, core, registry, publisher } = await deployFullSuite();
    const coreAddr = await core.getAddress();
    await publisher
      .connect(operator)
      .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, MERCHANT_A);
    expect(await registry.merchantOf(coreAddr, 0)).to.equal(MERCHANT_A);
  });

  it("emits NewSeries (Core) and SeriesMerchantLinked (Registry) in the same tx", async function () {
    const { operator, core, registry, publisher } = await deployFullSuite();
    const coreAddr = await core.getAddress();
    const publisherAddr = await publisher.getAddress();
    await expect(
      publisher
        .connect(operator)
        .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, MERCHANT_A)
    )
      .to.emit(core, "NewSeries")
      .and.to.emit(registry, "SeriesMerchantLinked")
      .withArgs(coreAddr, 0, MERCHANT_A, publisherAddr);
  });

  it("reverts atomically - a failed link does not advance the series counter", async function () {
    const { operator, core, registry, publisher } = await deployFullSuite();
    const coreAddr = await core.getAddress();
    await expect(
      publisher
        .connect(operator)
        .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, ZERO32)
    ).to.be.revertedWithCustomError(registry, "ZeroMerchantRef");
    await publisher
      .connect(operator)
      .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, MERCHANT_A);
    expect(await registry.merchantOf(coreAddr, 0)).to.equal(MERCHANT_A);
  });

  it("allows one merchant to own many series", async function () {
    const { operator, core, registry, publisher } = await deployFullSuite();
    const coreAddr = await core.getAddress();
    await publisher
      .connect(operator)
      .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, MERCHANT_A);
    await publisher
      .connect(operator)
      .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, MERCHANT_A);
    expect(await registry.merchantOf(coreAddr, 0)).to.equal(MERCHANT_A);
    expect(await registry.merchantOf(coreAddr, 1)).to.equal(MERCHANT_A);
  });
});

describe("Publisher access control", function () {
  it("rejects publish from a wallet without PUBLISHER_OPERATION_ROLE", async function () {
    const { human, core, publisher } = await deployFullSuite();
    await expect(
      publisher
        .connect(human)
        .publishSeriesWithMerchant(await core.getAddress(), seriesInput(), prizeTable(), false, MERCHANT_A)
    ).to.be.revertedWith(/is missing role/);
  });

  it("rejects a direct createSeries from a wallet without OPERATION_ROLE", async function () {
    const { human, core } = await deployFullSuite();
    await expect(
      core.connect(human).createSeriesWithSubPrizes(seriesInput(), prizeTable(), false)
    ).to.be.revertedWithCustomError(core, "MissingRole");
  });
});

describe("MerchantSeriesRegistry rules", function () {
  it("rejects a zero merchantRef", async function () {
    const { admin, registry } = await deployRegistryOnly();
    await expect(
      registry.linkSeries(admin.address, 1, ZERO32)
    ).to.be.revertedWithCustomError(registry, "ZeroMerchantRef");
  });

  it("links a series once then rejects a second link", async function () {
    const { admin, registry } = await deployRegistryOnly();
    await registry.linkSeries(admin.address, 1, MERCHANT_A);
    await expect(
      registry.linkSeries(admin.address, 1, MERCHANT_B)
    ).to.be.revertedWithCustomError(registry, "AlreadyLinked");
  });

  it("rejects linkSeries from a wallet without LINKER_ROLE", async function () {
    const { human, registry } = await deployRegistryOnly();
    await expect(
      registry.connect(human).linkSeries(human.address, 1, MERCHANT_A)
    ).to.be.revertedWithCustomError(registry, "MissingRole");
  });

  it("isolates the same seriesID across different series contracts", async function () {
    const { registry, user, other } = await deployRegistryOnly();
    await registry.linkSeries(user.address, 1, MERCHANT_A);
    await registry.linkSeries(other.address, 1, MERCHANT_B);
    expect(await registry.merchantOf(user.address, 1)).to.equal(MERCHANT_A);
    expect(await registry.merchantOf(other.address, 1)).to.equal(MERCHANT_B);
  });

  it("lets admin relink with an audit event and blocks non-admin relink", async function () {
    const { admin, human, registry } = await deployRegistryOnly();
    await registry.linkSeries(admin.address, 1, MERCHANT_A);
    await expect(registry.relinkSeries(admin.address, 1, MERCHANT_B))
      .to.emit(registry, "SeriesMerchantRelinked")
      .withArgs(admin.address, 1, MERCHANT_A, MERCHANT_B, admin.address);
    expect(await registry.merchantOf(admin.address, 1)).to.equal(MERCHANT_B);
    await expect(
      registry.connect(human).relinkSeries(admin.address, 1, MERCHANT_A)
    ).to.be.revertedWithCustomError(registry, "MissingRole");
  });

  it("rejects relink of an unlinked series", async function () {
    const { admin, registry } = await deployRegistryOnly();
    await expect(
      registry.relinkSeries(admin.address, 99, MERCHANT_A)
    ).to.be.revertedWithCustomError(registry, "NotLinked");
  });

  it("allows only UPGRADER_ROLE to authorize an upgrade", async function () {
    const { human, registry } = await deployRegistryOnly();
    await expect(
      registry.connect(human).upgradeToAndCall(human.address, "0x")
    ).to.be.revertedWithCustomError(registry, "MissingRole");
  });
});
