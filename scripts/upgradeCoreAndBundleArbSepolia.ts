import { ethers, upgrades, run } from "hardhat";

const DEFAULTS = {
  points: "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E",
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  bundle: "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6",
  redraw: "0xE75461828f41C890fbc811e7cABFe2143B3F4afE",
};

const CORE_FQN = "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable";
const BUNDLE_FQN = "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable";
const REDRAW_FQN = "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable";

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
  const factory = await ethers.getContractFactory(contractFqn);
  const oldImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`${label} proxy:`, proxyAddress);
  console.log(`${label} old implementation:`, oldImplementation);

  await upgrades.validateUpgrade(proxyAddress, factory, { kind: "uups" });
  console.log(`${label} storage-layout validation: OK`);

  if (dryRun) {
    return { contract: await ethers.getContractAt(contractFqn, proxyAddress), implementation: oldImplementation };
  }

  const upgraded: any = await upgrades.upgradeProxy(proxyAddress, factory, { kind: "uups" });
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
    bundle: process.env.DOUDO_BUNDLE_MODULE_PROXY_ADDRESS || DEFAULTS.bundle,
    redraw: process.env.DOUDO_REDRAW_MODULE_PROXY_ADDRESS || DEFAULTS.redraw,
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
  const pausedCore = dryRun ? false : await pauseCoreForUpgrade(currentCore);

  const coreResult = await validateAndUpgrade("Core", addresses.core, CORE_FQN, dryRun);
  const bundleResult = await validateAndUpgrade("Bundle", addresses.bundle, BUNDLE_FQN, dryRun);
  const redrawResult = await validateAndUpgrade("Redraw", addresses.redraw, REDRAW_FQN, dryRun);

  const core: any = coreResult.contract;
  const bundle: any = bundleResult.contract;
  const redraw: any = redrawResult.contract;

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
    "bundle redraw module",
    (await bundle.redrawModule()).toLowerCase() === addresses.redraw.toLowerCase()
  );
  await requireTrue(
    "redraw bundle module",
    (await redraw.bundleModule()).toLowerCase() === addresses.bundle.toLowerCase()
  );

  await requireTrue(
    "core MODULE_ROLE bundle",
    await core.hasRole(await core.MODULE_ROLE(), addresses.bundle)
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
    console.log("Core + Bundle + Redraw upgrade and implementation verification complete.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
