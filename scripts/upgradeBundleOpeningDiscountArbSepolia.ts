import { ethers, upgrades, run } from "hardhat";

const BUNDLE_FQN =
  "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable";
const DEFAULT_BUNDLE_PROXY = "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6";
const DEFAULT_CORE_PROXY = "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5";
const DEFAULT_POINTS = "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E";
const DEFAULT_REDRAW_PROXY = "0xE75461828f41C890fbc811e7cABFe2143B3F4afE";

async function verifyImplementation(address: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract: BUNDLE_FQN,
    });
    console.log("Implementation verified:", address);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Implementation already verified:", address);
      return;
    }
    console.warn("Implementation verification failed:", message);
  }
}

async function main() {
  const dryRun = (process.env.DRY_RUN || "false").toLowerCase() === "true";
  const bundleProxy =
    process.env.DOUDO_BUNDLE_MODULE_PROXY_ADDRESS || DEFAULT_BUNDLE_PROXY;
  const expectedCore =
    process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULT_CORE_PROXY;
  const expectedPoints = process.env.DOUDO_POINTS_ADDRESS || DEFAULT_POINTS;
  const expectedRedraw =
    process.env.DOUDO_REDRAW_MODULE_PROXY_ADDRESS || DEFAULT_REDRAW_PROXY;

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("ARB_TESTNET_PK is missing or invalid");

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 421614n) {
    throw new Error(
      `Expected Arbitrum Sepolia chainId 421614, got ${network.chainId.toString()}`,
    );
  }

  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);
  const oldImplementation =
    await upgrades.erc1967.getImplementationAddress(bundleProxy);
  const bundle: any = await ethers.getContractAt(BUNDLE_FQN, bundleProxy);
  const upgraderRole = await bundle.UPGRADER_ROLE();

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Dry run:", dryRun);
  console.log("Bundle proxy:", bundleProxy);
  console.log("Current implementation:", oldImplementation);
  console.log("Upgrader wallet:", deployerAddress);
  console.log("Upgrader balance:", ethers.formatEther(balance));

  if (!(await bundle.hasRole(upgraderRole, deployerAddress))) {
    throw new Error("Configured wallet does not have Bundle UPGRADER_ROLE");
  }
  if ((await bundle.core()).toLowerCase() !== expectedCore.toLowerCase()) {
    throw new Error("Unexpected Bundle core wiring");
  }
  if ((await bundle.doudoPoints()).toLowerCase() !== expectedPoints.toLowerCase()) {
    throw new Error("Unexpected Bundle points wiring");
  }
  if ((await bundle.redrawModule()).toLowerCase() !== expectedRedraw.toLowerCase()) {
    throw new Error("Unexpected Bundle redraw wiring");
  }

  const Bundle = await ethers.getContractFactory(BUNDLE_FQN);
  await upgrades.validateUpgrade(bundleProxy, Bundle, { kind: "uups" });
  console.log("Storage-layout validation: OK");
  console.log("Wiring and upgrader checks: OK");

  if (dryRun) return;

  const upgraded: any = await upgrades.upgradeProxy(bundleProxy, Bundle, {
    kind: "uups",
  });
  const upgradeTransaction = upgraded.deploymentTransaction();
  if (upgradeTransaction) {
    console.log("Upgrade transaction:", upgradeTransaction.hash);
  }
  await upgraded.waitForDeployment();

  const newImplementation =
    await upgrades.erc1967.getImplementationAddress(bundleProxy);
  if (newImplementation.toLowerCase() === oldImplementation.toLowerCase()) {
    throw new Error("Bundle implementation did not change");
  }

  const openingDiscount = await upgraded.seriesOpeningDiscounts(0);
  if (
    openingDiscount.ticketLimit !== 0n ||
    openingDiscount.priceInPoints !== 0n ||
    openingDiscount.active !== false
  ) {
    throw new Error("Unexpected opening discount default state");
  }
  if ((await upgraded.core()).toLowerCase() !== expectedCore.toLowerCase()) {
    throw new Error("Bundle core wiring changed after upgrade");
  }
  if ((await upgraded.doudoPoints()).toLowerCase() !== expectedPoints.toLowerCase()) {
    throw new Error("Bundle points wiring changed after upgrade");
  }
  if ((await upgraded.redrawModule()).toLowerCase() !== expectedRedraw.toLowerCase()) {
    throw new Error("Bundle redraw wiring changed after upgrade");
  }

  console.log("New implementation:", newImplementation);
  console.log("Post-upgrade opening-discount and wiring checks: OK");
  await verifyImplementation(newImplementation);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
