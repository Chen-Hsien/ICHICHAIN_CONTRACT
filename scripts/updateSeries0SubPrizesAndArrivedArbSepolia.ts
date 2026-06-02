import { ethers } from "hardhat";

const DOUDOCHAIN = "0x3cC5c9Df4359ADC3F9f61bf972F3DD8369D14b91";
const SERIES_ID = 0;

const subPrizes = [
  {
    subPrizeID: 1,
    prizeGroup: "A",
    subPrizeName: "A1",
    subPrizeRemainingQuantity: 2,
  },
  {
    subPrizeID: 2,
    prizeGroup: "B",
    subPrizeName: "B1",
    subPrizeRemainingQuantity: 2,
  },
  {
    subPrizeID: 3,
    prizeGroup: "C",
    subPrizeName: "C1",
    subPrizeRemainingQuantity: 2,
  },
  {
    subPrizeID: 4,
    prizeGroup: "D",
    subPrizeName: "D1",
    subPrizeRemainingQuantity: 6,
  },
  {
    subPrizeID: 5,
    prizeGroup: "E",
    subPrizeName: "E1",
    subPrizeRemainingQuantity: 14,
  },
  {
    subPrizeID: 6,
    prizeGroup: "F",
    subPrizeName: "F1",
    subPrizeRemainingQuantity: 24,
  },
  {
    subPrizeID: 7,
    prizeGroup: "G",
    subPrizeName: "G1",
    subPrizeRemainingQuantity: 30,
  },
];

async function main() {
  const doudochain = await ethers.getContractAt(
    "contracts/DOUDOCHAIN.sol:DOUDOCHAIN",
    DOUDOCHAIN
  );
  const totalSubPrizeQuantity = subPrizes.reduce(
    (sum, prize) => sum + prize.subPrizeRemainingQuantity,
    0
  );
  const beforeSeries = await doudochain.ICHISeries(SERIES_ID);

  console.log("DOUDOCHAIN:", DOUDOCHAIN);
  console.log("seriesID:", SERIES_ID);
  console.log("seriesName:", beforeSeries.seriesName);
  console.log("totalTicketNumbers:", beforeSeries.totalTicketNumbers.toString());
  console.log("isGoodsArrived before:", beforeSeries.isGoodsArrived);
  console.log("totalSubPrizeQuantity:", totalSubPrizeQuantity);

  const updateTx = await doudochain.updateSeriesSubPrize(SERIES_ID, subPrizes);
  console.log("updateSeriesSubPrize tx:", updateTx.hash);
  await updateTx.wait();

  const arrivedTx = await doudochain.goodsArrived(SERIES_ID);
  console.log("goodsArrived tx:", arrivedTx.hash);
  await arrivedTx.wait();

  const afterSeries = await doudochain.ICHISeries(SERIES_ID);
  console.log("isGoodsArrived after:", afterSeries.isGoodsArrived);
  console.log("estimateDeliverTime after:", afterSeries.estimateDeliverTime.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
