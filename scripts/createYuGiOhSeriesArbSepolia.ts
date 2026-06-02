import { ethers } from "hardhat";

const DOUDOCHAIN = "0x3cC5c9Df4359ADC3F9f61bf972F3DD8369D14b91";

const DOUDOCHAIN_ABI = [
  "event NewSeries(uint256 indexed seriesID, string seriesName, uint256 totalTicketNumbers, uint256 remainingTicketNumbers, uint256 priceInUSDTWei, uint256 priceInTWD, bool isGoodsArrived, uint256 estimateDeliverTime, uint256 exchangeExpireTime, string exchangeTokenURI, string unrevealTokenURI, string revealTokenURI, string seriesMetaDataURI, address lastPrizeOwner, bool isRefund, bool isPreOrder)",
  "function createSeries(string seriesName, uint256 priceInUSDTWei, uint256 priceInTWD, uint256 estimateDeliverTime, uint256 totalPrizeQuantity, bool isPreOrder, string exchangeTokenURI, string unrevealTokenURI, string revealTokenURI, string seriesMetaDataURI) external",
  "function ICHISeries(uint256 seriesID) external view returns (string seriesName, uint256 totalTicketNumbers, uint256 remainingTicketNumbers, uint256 priceInUSDTWei, bool isGoodsArrived, uint256 estimateDeliverTime, uint256 exchangeExpireTime, string exchangeTokenURI, string unrevealTokenURI, string revealTokenURI, string seriesMetaDataURI, uint256 priceInTWD, bool isRefund, bool isPreOrder)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const doudochain = await ethers.getContractAt(DOUDOCHAIN_ABI, DOUDOCHAIN);
  const estimateDeliverTime = Math.floor(Date.now() / 1000);

  console.log("Wallet:", await signer.getAddress());
  console.log("DOUDOCHAIN:", DOUDOCHAIN);
  console.log("estimateDeliverTime:", estimateDeliverTime);

  const tx = await doudochain.createSeries(
    "YU-GI-OH! SERIES VOL.3",
    3000000,
    100,
    estimateDeliverTime,
    80,
    false,
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/Qmf5db116gdHfssfDGW83CyEYD1oUpoLnqR8ECLT4EiAG5/",
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmU9brYLGCpTB6kuVLSeM466mwWGHAio6Gc7U1k2Sp8aEm",
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmU5aNDhTVLdFNGyvu5NX4qCmJr1QFfUCCMiKhAgWKRvRu/",
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmPmUrBSNhW6DaThVfhwv2Xt9fchwTJ7SiyETYkMYZCP5Y"
  );

  console.log("createSeries tx:", tx.hash);
  const receipt = await tx.wait();
  const event = receipt?.logs
    .map((log: any) => {
      try {
        return doudochain.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === "NewSeries");

  if (!event) {
    throw new Error("NewSeries event not found in transaction receipt.");
  }

  const seriesID = event.args.seriesID;
  const series = await doudochain.ICHISeries(seriesID);

  console.log("seriesID:", seriesID.toString());
  console.log("seriesName:", series.seriesName);
  console.log("totalTicketNumbers:", series.totalTicketNumbers.toString());
  console.log("remainingTicketNumbers:", series.remainingTicketNumbers.toString());
  console.log("priceInUSDTWei:", series.priceInUSDTWei.toString());
  console.log("priceInTWD:", series.priceInTWD.toString());
  console.log("isGoodsArrived:", series.isGoodsArrived);
  console.log("isRefund:", series.isRefund);
  console.log("isPreOrder:", series.isPreOrder);
  console.log("exchangeTokenURI:", series.exchangeTokenURI);
  console.log("unrevealTokenURI:", series.unrevealTokenURI);
  console.log("revealTokenURI:", series.revealTokenURI);
  console.log("seriesMetaDataURI:", series.seriesMetaDataURI);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
