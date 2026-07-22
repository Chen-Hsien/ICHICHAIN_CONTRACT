import { ethers } from "hardhat";

const DOUDOCHAIN = "0x3cC5c9Df4359ADC3F9f61bf972F3DD8369D14b91";

async function main() {
  const [signer] = await ethers.getSigners();
  const doudochain = await ethers.getContractAt(
    "contracts/DOUDOCHAIN.sol:DOUDOCHAIN",
    DOUDOCHAIN
  );
  const estimateDeliverTime = Math.floor(Date.now() / 1000);

  console.log("Wallet:", await signer.getAddress());
  console.log("DOUDOCHAIN:", DOUDOCHAIN);
  console.log("estimateDeliverTime:", estimateDeliverTime);

  const createTx = await doudochain.createSeries(
    "Dragon Ball 40th Anniversary - Part 2",
    14000000,
    420,
    estimateDeliverTime,
    81,
    false,
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmT2mcgTsGD7fSqrXmyb8jsxeJEV3KeWKxTu6ZdMTgDPEg/",
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/Qmc6kccXsWFV3EHKc7Jo4Jvf5BTW6Qq1XJmcGmkcmqsFCB",
    "https://lime-basic-thrush-351.mypinata.cloud/ipfs/QmTmXTnQ5CU5KVCyd9VN6NViVZu8PUkPmsNF8EKngA5m6h/",
    "https://gateway.pinata.cloud/ipfs/QmQp5fBop832GxzDr33jC5uMHDhYzdP8viUoT8gyneqkEK"
  );

  console.log("createSeries tx:", createTx.hash);
  const createReceipt = await createTx.wait();
  const event = createReceipt?.logs
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
  const goodsArrivedTx = await doudochain.goodsArrived(seriesID);

  console.log("seriesID:", seriesID.toString());
  console.log("goodsArrived tx:", goodsArrivedTx.hash);
  await goodsArrivedTx.wait();

  const series = await doudochain.ICHISeries(seriesID);

  console.log("seriesName:", series.seriesName);
  console.log("totalTicketNumbers:", series.totalTicketNumbers.toString());
  console.log("remainingTicketNumbers:", series.remainingTicketNumbers.toString());
  console.log("priceInUSDTWei:", series.priceInUSDTWei.toString());
  console.log("priceInTWD:", series.priceInTWD.toString());
  console.log("isGoodsArrived:", series.isGoodsArrived);
  console.log("estimateDeliverTime:", series.estimateDeliverTime.toString());
  console.log("exchangeTokenURI:", series.exchangeTokenURI);
  console.log("unrevealTokenURI:", series.unrevealTokenURI);
  console.log("revealTokenURI:", series.revealTokenURI);
  console.log("seriesMetaDataURI:", series.seriesMetaDataURI);
  console.log("isRefund:", series.isRefund);
  console.log("isPreOrder:", series.isPreOrder);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
