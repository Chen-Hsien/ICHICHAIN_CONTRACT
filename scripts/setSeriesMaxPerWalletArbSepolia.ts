import { ethers } from "hardhat";

const CORE_PROXY =
  process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5";
const SERIES_ID = BigInt(process.env.SERIES_ID || "0");
const CAP = BigInt(process.env.CAP || "0");

async function main() {
  if (CAP < 0n) {
    throw new Error("CAP must be >= 0");
  }

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const network = await ethers.provider.getNetwork();
  const core = await ethers.getContractAt(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    CORE_PROXY
  );

  const operationRole = await core.OPERATION_ROLE();
  const hasOperationRole = await core.hasRole(operationRole, deployerAddress);

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Core proxy:", CORE_PROXY);
  console.log("Series ID:", SERIES_ID.toString());
  console.log("New maxPerWallet:", CAP.toString(), CAP === 0n ? "(unlimited)" : "");
  console.log("Deployer:", deployerAddress);
  console.log("Has OPERATION_ROLE:", hasOperationRole);

  if (!hasOperationRole) {
    throw new Error(`Deployer ${deployerAddress} does not have OPERATION_ROLE`);
  }

  await core.setSeriesMaxPerWallet.staticCall(SERIES_ID, CAP);
  const tx = await core.setSeriesMaxPerWallet(SERIES_ID, CAP);
  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Block:", receipt?.blockNumber);
  console.log("Gas used:", receipt?.gasUsed.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
