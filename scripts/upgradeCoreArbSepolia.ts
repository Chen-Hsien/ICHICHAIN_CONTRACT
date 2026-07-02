import { ethers, upgrades, run } from "hardhat";

// Focused, single-proxy upgrade for the split Core implementation only.
// This does NOT redeploy the VRF router or re-wire/re-grant anything. The Core
// storage change is append-only: TicketStatus now records reveal timestamps.
const DEFAULTS = {
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
};

const CORE_FQN = "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable";

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

async function main() {
  const coreProxy = process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core;

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, network.chainId.toString());
  console.log("Upgrader / official ops wallet:", await deployer.getAddress());
  console.log("Core proxy:", coreProxy);

  const oldImpl = await upgrades.erc1967.getImplementationAddress(coreProxy);
  console.log("Old Core implementation:", oldImpl);

  const Core = await ethers.getContractFactory(CORE_FQN);

  // Read-only storage-layout validation. Throws (no tx) if the upgrade is unsafe.
  await upgrades.validateUpgrade(coreProxy, Core, { kind: "uups" });
  console.log("Storage-layout validation: OK");

  const core: any = await upgrades.upgradeProxy(coreProxy, Core, { kind: "uups" });
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

  await verify(newImpl, CORE_FQN);

  console.log("Core upgrade complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
