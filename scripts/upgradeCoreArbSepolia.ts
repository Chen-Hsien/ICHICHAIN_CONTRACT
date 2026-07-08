import { ethers, upgrades, run } from "hardhat";
import { CORE_FQN, linkedCoreFactory } from "./linkedCoreFactory";

const SERIES_OPS_FQN = "contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol:DoudoSeriesOpsModuleUpgradeable";

// Focused, single-proxy upgrade for the split Core implementation only.
// This does NOT redeploy the VRF router or re-wire/re-grant anything. The Core
// storage change is append-only: TicketStatus now records reveal timestamps.
const DEFAULTS = {
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
};

async function verify(address: string, contract?: string) {
  try {
    await run("verify:verify", { address, constructorArguments: [], contract });
    console.log("Verified:", address, contract || "");
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified:", address, contract || "");
      return;
    }
    console.warn("Verify failed:", address, contract || "", message);
  }
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
  const seedJson = process.env.SERIES_OPS_SEED_JSON;
  if (!seedJson) {
    console.log("SERIES_OPS_SEED_JSON not provided; skipping SeriesOps migration seed.");
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

async function main() {
  const coreProxy = process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core;
  const configuredSeriesOps = process.env.DOUDO_SERIES_OPS_MODULE_PROXY_ADDRESS || "";

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, network.chainId.toString());
  console.log("Upgrader / official ops wallet:", await deployer.getAddress());
  console.log("Core proxy:", coreProxy);

  const oldImpl = await upgrades.erc1967.getImplementationAddress(coreProxy);
  console.log("Old Core implementation:", oldImpl);

  const Core = await linkedCoreFactory();

  // Read-only storage-layout validation. Throws (no tx) if the upgrade is unsafe.
  await upgrades.validateUpgrade(coreProxy, Core, {
    kind: "uups",
    unsafeAllowLinkedLibraries: true,
  });
  console.log("Storage-layout validation: OK");

  const core: any = await upgrades.upgradeProxy(coreProxy, Core, {
    kind: "uups",
    unsafeAllowLinkedLibraries: true,
  });
  await core.waitForDeployment();

  const newImpl = await upgrades.erc1967.getImplementationAddress(coreProxy);
  console.log("New Core implementation:", newImpl);

  if (newImpl.toLowerCase() === oldImpl.toLowerCase()) {
    throw new Error("Implementation address did not change — upgrade may not have applied.");
  }

  // Sanity: proxy still answers and core wiring is intact (unchanged by this upgrade).
  const router = await core.vrfRouter();
  if (router === ethers.ZeroAddress) {
    throw new Error("Post-upgrade sanity failed: vrfRouter() is zero.");
  }
  console.log("Sanity OK — vrfRouter:", router);

  const seriesOpsResult = configuredSeriesOps
    ? {
        seriesOps: await ethers.getContractAt(SERIES_OPS_FQN, configuredSeriesOps),
        proxy: configuredSeriesOps,
      }
    : await deploySeriesOps(coreProxy);
  const wireTx = await core.setSeriesOpsModule(seriesOpsResult.proxy);
  console.log("Core setSeriesOpsModule tx:", wireTx.hash);
  await wireTx.wait();
  await seedSeriesOpsIfProvided(seriesOpsResult.seriesOps);

  await verify(newImpl, CORE_FQN);

  console.log("Core upgrade complete. SeriesOps module:", seriesOpsResult.proxy);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
