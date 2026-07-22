import { ethers, upgrades, run } from "hardhat";
import * as fs from "fs";
import { CORE_FQN, linkedCoreFactory } from "./linkedCoreFactory";

const DEFAULTS = {
  points: "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E",
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  bundle: "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6",
  refund: "0x8ee19238DAa466B7792BE33569c6E4f6993CCf20",
  redraw: "0xE75461828f41C890fbc811e7cABFe2143B3F4afE",
  collectionReward: "0x680618a6933DD68fF84Ff9F64760120d27400B3C",
};

const BUNDLE_FQN = "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable";
const REFUND_FQN = "contracts/modules/DoudoRefundModuleUpgradeable.sol:DoudoRefundModuleUpgradeable";
const REDRAW_FQN = "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable";
const COLLECTION_REWARD_FQN =
  "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable";
const SERIES_OPS_FQN = "contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol:DoudoSeriesOpsModuleUpgradeable";

async function verify(address: string, contract: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract,
    });
    console.log("Verified:", address, contract);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified:", address, contract);
      return;
    }
    console.warn("Verify failed:", address, contract, message);
  }
}

async function validateAndUpgrade(
  label: string,
  proxyAddress: string,
  contractFqn: string,
  dryRun: boolean
) {
  const isCore = contractFqn === CORE_FQN;
  const factory = isCore ? await linkedCoreFactory() : await ethers.getContractFactory(contractFqn);
  const oldImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`${label} proxy:`, proxyAddress);
  console.log(`${label} old implementation:`, oldImplementation);

  await upgrades.validateUpgrade(proxyAddress, factory, {
    kind: "uups",
    unsafeAllowLinkedLibraries: isCore,
  });
  console.log(`${label} storage-layout validation: OK`);

  if (dryRun) {
    return { contract: await ethers.getContractAt(contractFqn, proxyAddress), implementation: oldImplementation };
  }

  const upgraded: any = await upgrades.upgradeProxy(proxyAddress, factory, {
    kind: "uups",
    unsafeAllowLinkedLibraries: isCore,
  });
  await upgraded.waitForDeployment();

  const newImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`${label} new implementation:`, newImplementation);
  console.log(
    `${label} implementation changed:`,
    newImplementation.toLowerCase() !== oldImplementation.toLowerCase()
  );

  await verify(newImplementation, contractFqn);
  return { contract: upgraded, implementation: newImplementation };
}

async function requireTrue(label: string, value: boolean) {
  if (!value) {
    throw new Error(`Post-upgrade assertion failed: ${label}`);
  }
  console.log("OK:", label);
}

async function deploySeriesOps(coreProxy: string) {
  const SeriesOps = await ethers.getContractFactory(SERIES_OPS_FQN);
  const seriesOps: any = await upgrades.deployProxy(SeriesOps, [coreProxy], {
    initializer: "initialize",
    kind: "uups",
  });
  await seriesOps.waitForDeployment();
  const proxy = await seriesOps.getAddress();
  const implementation = await upgrades.erc1967.getImplementationAddress(proxy);
  console.log("SeriesOps proxy:", proxy);
  console.log("SeriesOps implementation:", implementation);
  await verify(implementation, SERIES_OPS_FQN);
  return { seriesOps, proxy };
}

async function seedSeriesOpsIfProvided(seriesOps: any) {
  const seedJson = process.env.SERIES_OPS_SEED_JSON_FILE
    ? fs.readFileSync(process.env.SERIES_OPS_SEED_JSON_FILE, "utf8")
    : process.env.SERIES_OPS_SEED_JSON;
  if (!seedJson) {
    console.log("SERIES_OPS_SEED_JSON(_FILE) not provided; skipping SeriesOps migration seed.");
    return;
  }
  const seeds = JSON.parse(seedJson) as Array<{
    seriesID: string | number;
    maxPerWallet: string | number;
    revealEnabled: boolean;
    minted?: Array<{ user: string; count: string | number }>;
  }>;
  for (const seed of seeds) {
    let tx = await seriesOps.seedSeriesConfig(seed.seriesID, seed.maxPerWallet, seed.revealEnabled);
    console.log("SeriesOps seedSeriesConfig tx:", seed.seriesID, tx.hash);
    await tx.wait();
    for (const minted of seed.minted || []) {
      tx = await seriesOps.seedMintedCount(seed.seriesID, minted.user, minted.count);
      console.log("SeriesOps seedMintedCount tx:", seed.seriesID, minted.user, tx.hash);
      await tx.wait();
    }
  }
}

async function pauseCoreForUpgrade(core: any) {
  if (await core.paused()) {
    console.log("Core already paused");
    return false;
  }
  await (await core.pause()).wait();
  console.log("Core paused");
  return true;
}

async function main() {
  const dryRun = (process.env.DRY_RUN || "false").toLowerCase() === "true";
  const addresses = {
    points: process.env.DOUDO_POINTS_ADDRESS || DEFAULTS.points,
    router: process.env.DOUDO_VRF_ROUTER_ADDRESS || "",
    core: process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core,
    seriesOps: process.env.DOUDO_SERIES_OPS_MODULE_PROXY_ADDRESS || "",
    bundle: process.env.DOUDO_BUNDLE_MODULE_PROXY_ADDRESS || DEFAULTS.bundle,
    refund: process.env.DOUDO_REFUND_MODULE_PROXY_ADDRESS || DEFAULTS.refund,
    redraw: process.env.DOUDO_REDRAW_MODULE_PROXY_ADDRESS || DEFAULTS.redraw,
    collectionReward:
      process.env.DOUDO_COLLECTION_REWARD_MODULE_PROXY_ADDRESS || DEFAULTS.collectionReward,
  };

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Dry run:", dryRun);
  console.log("Upgrader / official ops wallet:", deployerAddress);
  console.log("Upgrader balance:", ethers.formatEther(balance));

  if (network.chainId !== 421614n) {
    throw new Error(`Expected Arbitrum Sepolia chainId 421614, got ${network.chainId.toString()}`);
  }

  const currentCore: any = await ethers.getContractAt(CORE_FQN, addresses.core);
  const currentBundle: any = await ethers.getContractAt(BUNDLE_FQN, addresses.bundle);
  const currentRedraw: any = await ethers.getContractAt(REDRAW_FQN, addresses.redraw);
  const currentCollectionReward: any = await ethers.getContractAt(
    COLLECTION_REWARD_FQN,
    addresses.collectionReward
  );
  const points: any = await ethers.getContractAt("contracts/DDOUDOCOIN.sol:DOUDOCOIN", addresses.points);
  const pausedCore = dryRun ? false : await pauseCoreForUpgrade(currentCore);

  try {
  const coreResult = await validateAndUpgrade("Core", addresses.core, CORE_FQN, dryRun);
  const bundleResult = await validateAndUpgrade("Bundle", addresses.bundle, BUNDLE_FQN, dryRun);
  const refundResult = await validateAndUpgrade("Refund", addresses.refund, REFUND_FQN, dryRun);
  const redrawResult = await validateAndUpgrade("Redraw", addresses.redraw, REDRAW_FQN, dryRun);
  const collectionRewardResult = await validateAndUpgrade(
    "CollectionReward",
    addresses.collectionReward,
    COLLECTION_REWARD_FQN,
    dryRun
  );

  const core: any = coreResult.contract;
  const bundle: any = bundleResult.contract;
  const refund: any = refundResult.contract;
  const redraw: any = redrawResult.contract;
  const collectionReward: any = collectionRewardResult.contract;
  const seriesOpsResult = addresses.seriesOps
    ? {
        seriesOps: await ethers.getContractAt(SERIES_OPS_FQN, addresses.seriesOps),
        proxy: addresses.seriesOps,
      }
    : dryRun
      ? {
          seriesOps: await ethers.getContractAt(SERIES_OPS_FQN, ethers.ZeroAddress),
          proxy: ethers.ZeroAddress,
        }
      : await deploySeriesOps(addresses.core);

  if (!dryRun) {
    const wireTx = await core.setSeriesOpsModule(seriesOpsResult.proxy);
    console.log("Core setSeriesOpsModule tx:", wireTx.hash);
    await wireTx.wait();
    await seedSeriesOpsIfProvided(seriesOpsResult.seriesOps);
  }

  await requireTrue(
    "core points address",
    (await core.doudoPoints()).toLowerCase() === addresses.points.toLowerCase()
  );
  const coreRouter = await core.vrfRouter();
  await requireTrue("core router nonzero", coreRouter !== ethers.ZeroAddress);
  if (addresses.router) {
    await requireTrue(
      "core router address",
      coreRouter.toLowerCase() === addresses.router.toLowerCase()
    );
  } else {
    console.log("Core router address:", coreRouter);
  }
  await requireTrue(
    "bundle core address",
    (await bundle.core()).toLowerCase() === addresses.core.toLowerCase()
  );
  await requireTrue(
    "bundle points address",
    (await bundle.doudoPoints()).toLowerCase() === addresses.points.toLowerCase()
  );
  await requireTrue(
    "refund core address",
    (await refund.core()).toLowerCase() === addresses.core.toLowerCase()
  );
  await requireTrue(
    "refund points address",
    (await refund.doudoPoints()).toLowerCase() === addresses.points.toLowerCase()
  );
  await requireTrue(
    "bundle redraw module",
    (await bundle.redrawModule()).toLowerCase() === addresses.redraw.toLowerCase()
  );
  await requireTrue(
    "redraw bundle module",
    (await redraw.bundleModule()).toLowerCase() === addresses.bundle.toLowerCase()
  );
  await requireTrue(
    "collection reward core address",
    (await collectionReward.core()).toLowerCase() === addresses.core.toLowerCase()
  );
  await requireTrue(
    "collection reward points address",
    (await collectionReward.doudoPoints()).toLowerCase() === addresses.points.toLowerCase()
  );

  await requireTrue(
    "core MODULE_ROLE bundle",
    await core.hasRole(await core.MODULE_ROLE(), addresses.bundle)
  );
  await requireTrue(
    "core MODULE_ROLE refund",
    await core.hasRole(await core.MODULE_ROLE(), addresses.refund)
  );
  await requireTrue(
    "points MINTER_ROLE refund",
    await points.hasRole(await points.MINTER_ROLE(), addresses.refund)
  );

  if (dryRun) {
    console.log("Dry run complete. No transaction sent.");
  } else {
    if (await core.paused()) {
      await (await core.unpause()).wait();
      console.log("Core unpaused");
    }
    const rebateTierCount = await bundle.seriesRebateTierCount(0);
    console.log("Bundle seriesRebateTierCount(0):", rebateTierCount.toString());
    console.log(
      "Core + Bundle + Refund + Redraw + CollectionReward upgrade and implementation verification complete."
    );
  }
  } finally {
    if (!dryRun && pausedCore && await currentCore.paused()) {
      await (await currentCore.unpause()).wait();
      console.log("Core unpaused after upgrade attempt");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
