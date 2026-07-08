import { ethers } from "hardhat";

const SERIES_OPS_MODULE_PROXY = process.env.DOUDO_SERIES_OPS_MODULE_PROXY_ADDRESS || "";
const SERIES_ID = BigInt(process.env.SERIES_ID || "0");
const CAP = BigInt(process.env.CAP || "0");

async function main() {
  if (!SERIES_OPS_MODULE_PROXY) {
    throw new Error("DOUDO_SERIES_OPS_MODULE_PROXY_ADDRESS is required");
  }
  if (CAP < 0n) {
    throw new Error("CAP must be >= 0");
  }

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const network = await ethers.provider.getNetwork();
  const seriesOps = await ethers.getContractAt(
    "contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol:DoudoSeriesOpsModuleUpgradeable",
    SERIES_OPS_MODULE_PROXY
  );

  const operationRole = await seriesOps.OPERATION_ROLE();
  const hasOperationRole = await seriesOps.hasRole(operationRole, deployerAddress);

  console.log("Network:", network.name, network.chainId.toString());
  console.log("SeriesOps module proxy:", SERIES_OPS_MODULE_PROXY);
  console.log("Series ID:", SERIES_ID.toString());
  console.log("New maxPerWallet:", CAP.toString(), CAP === 0n ? "(unlimited)" : "");
  console.log("Deployer:", deployerAddress);
  console.log("Has OPERATION_ROLE:", hasOperationRole);

  if (!hasOperationRole) {
    throw new Error(`Deployer ${deployerAddress} does not have OPERATION_ROLE`);
  }

  await seriesOps.setSeriesMaxPerWallet.staticCall(SERIES_ID, CAP);
  const tx = await seriesOps.setSeriesMaxPerWallet(SERIES_ID, CAP);
  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Block:", receipt?.blockNumber);
  console.log("Gas used:", receipt?.gasUsed.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
