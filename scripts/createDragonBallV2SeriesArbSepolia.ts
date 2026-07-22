import { ethers } from "hardhat";

const CORE_PROXY =
  process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5";

const input = {
  seriesName: "Dragon Ball 40th Anniversary - Part 2",
  totalTicketNumbers: 81,
  priceInPoints: ethers.parseEther("200"),
  priceInTWD: 100,
  estimateDeliverTime: 1780041668,
  exchangeTokenURI:
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmT2mcgTsGD7fSqrXmyb8jsxeJEV3KeWKxTu6ZdMTgDPEg/",
  unrevealTokenURI:
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/Qmc6kccXsWFV3EHKc7Jo4Jvf5BTW6Qq1XJmcGmkcmqsFCB",
  revealTokenURI:
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmTmXTnQ5CU5KVCyd9VN6NViVZu8PUkPmsNF8EKngA5m6h/",
  seriesMetaDataURI: "https://gateway.pinata.cloud/ipfs/QmVfaqTBhRtopfmsbCxo3q8sh58PNsLSsZzvXVnamg55ct",
  isPreOrder: false,
  useLuckyNumber: true,
  maxPerWallet: 0,
};

const subPrizes = [
  { subPrizeID: 1, prizeGroup: "SP", subPrizeName: "SP1", subPrizeRemainingQuantity: 1 },
  { subPrizeID: 2, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 2 },
  { subPrizeID: 3, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: 2 },
  { subPrizeID: 4, prizeGroup: "C", subPrizeName: "C1", subPrizeRemainingQuantity: 2 },
  { subPrizeID: 5, prizeGroup: "D", subPrizeName: "D1", subPrizeRemainingQuantity: 1 },
  { subPrizeID: 6, prizeGroup: "E", subPrizeName: "E1", subPrizeRemainingQuantity: 1 },
  { subPrizeID: 7, prizeGroup: "F", subPrizeName: "F1", subPrizeRemainingQuantity: 20 },
  { subPrizeID: 8, prizeGroup: "G", subPrizeName: "G1", subPrizeRemainingQuantity: 21 },
  { subPrizeID: 9, prizeGroup: "H", subPrizeName: "H1", subPrizeRemainingQuantity: 18 },
  { subPrizeID: 10, prizeGroup: "I", subPrizeName: "I1", subPrizeRemainingQuantity: 13 },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const totalSubPrizeQuantity = subPrizes.reduce(
    (total, subPrize) => total + subPrize.subPrizeRemainingQuantity,
    0
  );

  if (totalSubPrizeQuantity !== input.totalTicketNumbers) {
    throw new Error(
      `SubPrize total ${totalSubPrizeQuantity} does not match totalTicketNumbers ${input.totalTicketNumbers}`
    );
  }

  const core = await ethers.getContractAt(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    CORE_PROXY
  );

  const deployerAddress = await deployer.getAddress();
  const operationRole = await core.OPERATION_ROLE();
  const hasOperationRole = await core.hasRole(operationRole, deployerAddress);

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Core proxy:", CORE_PROXY);
  console.log("Deployer:", deployerAddress);
  console.log("Has OPERATION_ROLE:", hasOperationRole);
  console.log("Series name:", input.seriesName);
  console.log("Total tickets:", input.totalTicketNumbers);
  console.log("SubPrize total:", totalSubPrizeQuantity);
  console.log("Price in points:", input.priceInPoints.toString());
  console.log("Price in TWD:", input.priceInTWD);
  console.log("Mark goods arrived:", true);

  if (!hasOperationRole) {
    throw new Error(`Deployer ${deployerAddress} does not have OPERATION_ROLE`);
  }

  const expectedSeriesID = await core.createSeriesWithSubPrizes.staticCall(input, subPrizes, true);
  const estimatedGas = await core.createSeriesWithSubPrizes.estimateGas(input, subPrizes, true);
  console.log("Static expected seriesID:", expectedSeriesID.toString());
  console.log("Estimated gas:", estimatedGas.toString());

  const tx = await core.createSeriesWithSubPrizes(input, subPrizes, true);
  console.log("Create tx:", tx.hash);

  const receipt = await tx.wait();
  console.log("Block:", receipt?.blockNumber);
  console.log("Gas used:", receipt?.gasUsed.toString());

  if (!receipt) {
    throw new Error("Missing transaction receipt");
  }

  for (const log of receipt.logs) {
    try {
      const parsed = core.interface.parseLog(log);
      if (parsed?.name === "NewSeries") {
        console.log("NewSeries seriesID:", parsed.args.seriesID.toString());
        console.log("NewSeries remainingTicketNumbers:", parsed.args.remainingTicketNumbers.toString());
        console.log("NewSeries isGoodsArrived:", parsed.args.isGoodsArrived);
        console.log("NewSeries estimateDeliverTime:", parsed.args.estimateDeliverTime.toString());
        console.log("NewSeries exchangeExpireTime:", parsed.args.exchangeExpireTime.toString());
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
