const { expect } = require("chai");
const { ethers, upgrades, artifacts } = require("hardhat");

function prizeTable(total = 4) {
  return [
    {
      subPrizeID: 1,
      prizeGroup: "A",
      subPrizeName: "A1",
      subPrizeRemainingQuantity: total,
    },
  ];
}

function seriesInput(name, includeSourceFields) {
  const input = {
    seriesName: name,
    totalTicketNumbers: 4,
    priceInPoints: ethers.parseEther("3"),
    priceInTWD: 100,
    estimateDeliverTime: 1780000000,
    exchangeTokenURI: "ipfs://exchange/",
    unrevealTokenURI: "ipfs://unrevealed",
    revealTokenURI: "ipfs://revealed/",
    seriesMetaDataURI: "ipfs://series",
    isPreOrder: false,
    useLuckyNumber: true,
    maxPerWallet: 0,
  };
  if (includeSourceFields) {
    input.packingType = 1;
    input.sourceType = 1;
  }
  return input;
}

async function deployPoints(admin) {
  const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
  const points = await Points.deploy(admin.address, admin.address);
  await points.waitForDeployment();
  return points;
}

async function deployObserver(target) {
  const Observer = await ethers.getContractFactory(
    "contracts/test/ERC721ATicketStateReceiver.sol:ERC721ATicketStateReceiver"
  );
  const observer = await Observer.deploy(await target.getAddress());
  await observer.waitForDeployment();
  return observer;
}

async function createTwoSeries(core, includeSourceFields) {
  await core.createSeriesWithSubPrizes(
    seriesInput("Series Zero", includeSourceFields),
    prizeTable(),
    true
  );
  await core.createSeriesWithSubPrizes(
    seriesInput("Series One", includeSourceFields),
    prizeTable(),
    true
  );
}

async function expectInitializedCallback(observer, expected = {}) {
  expect(await observer.callbackCount()).to.equal(expected.callbackCount ?? 1);
  expect(await observer.observedSeriesId()).to.equal(1);
  expect(await observer.observedPrizeId()).to.equal(expected.prizeId ?? 0);
  expect(await observer.observedExchanged()).to.equal(false);
  expect(await observer.observedRevealed()).to.equal(expected.revealed ?? false);
  expect(await observer.observedLuckyNumber()).to.equal(expected.luckyNumber ?? 2);
  expect(await observer.observedPointsPaid()).to.equal(expected.pointsPaid ?? 0);
}

describe("V2 ERC721A mint callback state", function () {
  it("keeps all V2 runtime bytecode within the EIP-170 deployment limit", async function () {
    const contracts = [
      "contracts/DOUDOCHAINV2.sol:DOUDOCHAINV2",
      "contracts/DOUDOCHAINV2Upgradeable.sol:DOUDOCHAINV2Upgradeable",
      "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    ];

    for (const name of contracts) {
      const artifact = await artifacts.readArtifact(name);
      const runtimeSize = (artifact.deployedBytecode.length - 2) / 2;
      expect(runtimeSize, name).to.be.at.most(24576);
    }
  });

  it("initializes DOUDOCHAINV2 ticket and reward state before callbacks", async function () {
    const [admin] = await ethers.getSigners();
    const points = await deployPoints(admin);
    const Core = await ethers.getContractFactory("contracts/DOUDOCHAINV2.sol:DOUDOCHAINV2");
    const core = await Core.deploy(
      await points.getAddress(),
      admin.address,
      0,
      ethers.ZeroHash,
      0
    );
    await core.waitForDeployment();
    await createTwoSeries(core, true);
    const observer = await deployObserver(core);

    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.mint(await observer.getAddress(), ethers.parseEther("10"));
    await observer.execute(core.interface.encodeFunctionData("mint", [1, [2]]));
    await expectInitializedCallback(observer, {
      pointsPaid: ethers.parseEther("3"),
    });

    await core.setCollectionRewardConfig(77, 1, 1, true);
    await core.grantRole(await core.COLLECTION_BOOK_ROLE(), await observer.getAddress());
    await observer.configureReentry(
      core.interface.encodeFunctionData("mintCollectionReward", [await observer.getAddress(), 77])
    );
    await core.mintCollectionReward(await observer.getAddress(), 77);
    await expectInitializedCallback(observer, {
      callbackCount: 2,
      prizeId: 1,
      revealed: true,
      luckyNumber: 0,
    });
    expect(await observer.reentrySucceeded()).to.equal(false);
  });

  it("initializes the legacy UUPS V2 ticket state before callbacks", async function () {
    const [admin] = await ethers.getSigners();
    const points = await deployPoints(admin);
    const Core = await ethers.getContractFactory(
      "contracts/DOUDOCHAINV2Upgradeable.sol:DOUDOCHAINV2Upgradeable"
    );
    const core = await upgrades.deployProxy(
      Core,
      [await points.getAddress(), admin.address, 0, ethers.ZeroHash, 0],
      { initializer: "initialize", kind: "uups" }
    );
    await core.waitForDeployment();
    await createTwoSeries(core, false);
    const observer = await deployObserver(core);

    await core.adminMint(await observer.getAddress(), 1, [2]);
    await expectInitializedCallback(observer);
  });

  it("initializes the split UUPS Core ticket state before callbacks", async function () {
    const [admin] = await ethers.getSigners();
    const points = await deployPoints(admin);

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

    const Core = await ethers.getContractFactory(
      "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
      {
        libraries: {
          DoudoPrizeDrawLib: await prizeDrawLib.getAddress(),
          DoudoTokenURILib: await tokenURILib.getAddress(),
        },
      }
    );
    const core = await upgrades.deployProxy(
      Core,
      [await points.getAddress(), admin.address],
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
      { initializer: "initialize", kind: "uups" }
    );
    await seriesOps.waitForDeployment();
    await core.setSeriesOpsModule(await seriesOps.getAddress());
    await createTwoSeries(core, true);
    const observer = await deployObserver(core);

    await core.adminMint(await observer.getAddress(), 1, [2]);
    await expectInitializedCallback(observer);
  });
});
