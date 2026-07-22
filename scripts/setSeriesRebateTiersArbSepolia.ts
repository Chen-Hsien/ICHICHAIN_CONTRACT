import { ethers } from "hardhat";

const BUNDLE_PROXY =
  process.env.DOUDO_BUNDLE_MODULE_PROXY_ADDRESS || "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6";
const SERIES_ID = BigInt(process.env.SERIES_ID || "7");

const TIERS = [
  {
    minimumTicketQuantity: 3n,
    rebatePoints: ethers.parseEther(process.env.REBATE_3 || "1000"),
  },
  {
    minimumTicketQuantity: 5n,
    rebatePoints: ethers.parseEther(process.env.REBATE_5 || "2000"),
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const network = await ethers.provider.getNetwork();
  const bundle = await ethers.getContractAt(
    "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable",
    BUNDLE_PROXY
  );

  const operationRole = await bundle.OPERATION_ROLE();
  const hasOperationRole = await bundle.hasRole(operationRole, deployerAddress);

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Bundle proxy:", BUNDLE_PROXY);
  console.log("Series ID:", SERIES_ID.toString());
  console.log("Deployer:", deployerAddress);
  console.log("Has OPERATION_ROLE:", hasOperationRole);
  console.log("Tiers:");
  for (const tier of TIERS) {
    console.log(
      `  - min ${tier.minimumTicketQuantity} tickets => ${ethers.formatEther(tier.rebatePoints)} DOUDO`
    );
  }

  if (!hasOperationRole) {
    throw new Error(`Deployer ${deployerAddress} does not have OPERATION_ROLE on Bundle`);
  }

  const beforeCount = await bundle.seriesRebateTierCount(SERIES_ID);
  console.log("seriesRebateTierCount before:", beforeCount.toString());

  await bundle.setSeriesRebateTiers.staticCall(SERIES_ID, TIERS);
  const tx = await bundle.setSeriesRebateTiers(SERIES_ID, TIERS);
  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Block:", receipt?.blockNumber);
  console.log("Gas used:", receipt?.gasUsed.toString());

  const afterCount = await bundle.seriesRebateTierCount(SERIES_ID);
  console.log("seriesRebateTierCount after:", afterCount.toString());

  const configured = await bundle.queryFilter(
    bundle.filters.BundleRebateTierConfigured(SERIES_ID),
    receipt?.blockNumber,
    receipt?.blockNumber
  );
  for (const event of configured) {
    console.log(
      "Configured tier",
      event.args.tierIndex.toString(),
      "min",
      event.args.minimumTicketQuantity.toString(),
      "rebate",
      ethers.formatEther(event.args.rebatePoints)
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
