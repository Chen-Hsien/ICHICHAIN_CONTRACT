import { ethers, upgrades, run } from "hardhat";

const DEFAULTS = {
  redraw: "0xE75461828f41C890fbc811e7cABFe2143B3F4afE",
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  router: "0x5A59D45437559C7CE0A012630a456321180C21e1",
  bundle: "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6",
};

async function verify(address: string, contract?: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract,
    });
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

async function setAddressIfNeeded(label: string, current: string, expected: string, setter: () => Promise<any>) {
  if (current.toLowerCase() === expected.toLowerCase()) {
    console.log(`${label} already set:`, expected);
    return;
  }
  const tx = await setter();
  console.log(`${label} set tx:`, tx.hash);
  await tx.wait();
  console.log(`${label} set:`, expected);
}

async function main() {
  const redrawProxy = process.env.DOUDO_REDRAW_MODULE_PROXY_ADDRESS || DEFAULTS.redraw;
  const expectedCore = process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core;
  const expectedRouter = process.env.DOUDO_VRF_ROUTER_ADDRESS || DEFAULTS.router;
  const expectedBundle = process.env.DOUDO_BUNDLE_MODULE_PROXY_ADDRESS || DEFAULTS.bundle;

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, network.chainId.toString());
  console.log("Upgrader / official ops wallet:", await deployer.getAddress());
  console.log("Redraw proxy:", redrawProxy);
  console.log("Old Redraw implementation:", await upgrades.erc1967.getImplementationAddress(redrawProxy));

  const Redraw = await ethers.getContractFactory(
    "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable"
  );
  const redraw: any = await upgrades.upgradeProxy(redrawProxy, Redraw);
  await redraw.waitForDeployment();

  const newImplementation = await upgrades.erc1967.getImplementationAddress(redrawProxy);
  console.log("New Redraw implementation:", newImplementation);

  await setAddressIfNeeded("Redraw router", await redraw.router(), expectedRouter, () =>
    redraw.setRouter(expectedRouter)
  );

  if ((await redraw.core()).toLowerCase() !== expectedCore.toLowerCase()) {
    throw new Error("Unexpected Redraw core wiring");
  }
  if ((await redraw.router()).toLowerCase() !== expectedRouter.toLowerCase()) {
    throw new Error("Unexpected Redraw router wiring");
  }
  if ((await redraw.bundleModule()).toLowerCase() !== expectedBundle.toLowerCase()) {
    throw new Error("Unexpected Redraw bundle wiring");
  }
  console.log("Redraw wiring checks passed.");

  await verify(
    newImplementation,
    "contracts/modules/DoudoRedrawModuleUpgradeable.sol:DoudoRedrawModuleUpgradeable"
  );
  await verify(redrawProxy);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
