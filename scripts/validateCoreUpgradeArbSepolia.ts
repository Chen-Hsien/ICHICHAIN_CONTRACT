import { ethers, upgrades } from "hardhat";

// Read-only: validates that the new Core implementation is storage-layout
// compatible with the currently-deployed proxy. Sends no transaction.
const DEFAULTS = { core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5" };
const CORE_FQN = "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable";

async function main() {
  const coreProxy = process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core;
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, network.chainId.toString());
  console.log("Core proxy:", coreProxy);

  const oldImpl = await upgrades.erc1967.getImplementationAddress(coreProxy);
  console.log("Current Core implementation:", oldImpl);

  const Core = await ethers.getContractFactory(CORE_FQN);
  await upgrades.validateUpgrade(coreProxy, Core, { kind: "uups" });
  console.log("Storage-layout validation: OK (upgrade is safe, no tx sent)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
