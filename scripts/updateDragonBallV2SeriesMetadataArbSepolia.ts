import { ethers } from "hardhat";

const CORE_PROXY =
  process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5";
const SERIES_ID = 0;

const exchangeTokenURI =
  "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmT2mcgTsGD7fSqrXmyb8jsxeJEV3KeWKxTu6ZdMTgDPEg/";
const unrevealTokenURI =
  "https://lime-basic-thrush-351.mypinata.cloud/ipfs/Qmc6kccXsWFV3EHKc7Jo4Jvf5BTW6Qq1XJmcGmkcmqsFCB";
const revealTokenURI =
  "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmTmXTnQ5CU5KVCyd9VN6NViVZu8PUkPmsNF8EKngA5m6h/";
const seriesMetaDataURI = "https://gateway.pinata.cloud/ipfs/Qme1upVBgPKNZuD9A8ug275cfBgoMxh6qXrXJYQyhSR671";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const core = await ethers.getContractAt(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    CORE_PROXY
  );

  const deployerAddress = await deployer.getAddress();
  const operationRole = await core.OPERATION_ROLE();
  const hasOperationRole = await core.hasRole(operationRole, deployerAddress);

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Core proxy:", CORE_PROXY);
  console.log("Series ID:", SERIES_ID);
  console.log("Deployer:", deployerAddress);
  console.log("Has OPERATION_ROLE:", hasOperationRole);
  console.log("New seriesMetaDataURI:", seriesMetaDataURI);

  if (!hasOperationRole) {
    throw new Error(`Deployer ${deployerAddress} does not have OPERATION_ROLE`);
  }

  await core.setSeriesMetadata.staticCall(
    SERIES_ID,
    exchangeTokenURI,
    unrevealTokenURI,
    revealTokenURI,
    seriesMetaDataURI,
    0
  );
  const estimatedGas = await core.setSeriesMetadata.estimateGas(
    SERIES_ID,
    exchangeTokenURI,
    unrevealTokenURI,
    revealTokenURI,
    seriesMetaDataURI,
    0
  );
  console.log("Estimated gas:", estimatedGas.toString());

  const tx = await core.setSeriesMetadata(
    SERIES_ID,
    exchangeTokenURI,
    unrevealTokenURI,
    revealTokenURI,
    seriesMetaDataURI
  );
  console.log("Update tx:", tx.hash);

  const receipt = await tx.wait();
  console.log("Block:", receipt?.blockNumber);
  console.log("Gas used:", receipt?.gasUsed.toString());

  if (!receipt) {
    throw new Error("Missing transaction receipt");
  }

  for (const log of receipt.logs) {
    try {
      const parsed = core.interface.parseLog(log);
      if (parsed?.name === "UpdateSeriesInformation") {
        console.log("UpdateSeriesInformation seriesID:", parsed.args.seriesID.toString());
        console.log("UpdateSeriesInformation exchangeTokenURI:", parsed.args.exchangeTokenURI);
        console.log("UpdateSeriesInformation unrevealTokenURI:", parsed.args.unrevealTokenURI);
        console.log("UpdateSeriesInformation revealTokenURI:", parsed.args.revealTokenURI);
        console.log("UpdateSeriesInformation seriesMetaDataURI:", parsed.args.seriesMetaDataURI);
      }
    } catch {
      // Ignore logs emitted by other contracts.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
