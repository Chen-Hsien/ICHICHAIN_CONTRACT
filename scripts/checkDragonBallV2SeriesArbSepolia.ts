import { ethers } from "hardhat";

const CORE_PROXY =
  process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5";
const SERIES_ID = 0;
const CREATE_BLOCK = 273485885;

async function main() {
  const core = await ethers.getContractAt(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    CORE_PROXY
  );

  const newSeriesEvents = await core.queryFilter(
    core.filters.NewSeries(SERIES_ID),
    CREATE_BLOCK,
    CREATE_BLOCK
  );
  const newSubPrizeEvents = await core.queryFilter(
    core.filters.NewSubPrize(SERIES_ID),
    CREATE_BLOCK,
    CREATE_BLOCK
  );

  console.log("Core proxy:", CORE_PROXY);
  console.log("Series ID:", SERIES_ID);
  console.log("Create block:", CREATE_BLOCK);
  console.log("NewSeries events:", newSeriesEvents.length);
  console.log("NewSubPrize events:", newSubPrizeEvents.length);

  for (const event of newSeriesEvents) {
    console.log("Series name:", event.args.seriesName);
    console.log("Total tickets:", event.args.totalTicketNumbers.toString());
    console.log("Remaining tickets:", event.args.remainingTicketNumbers.toString());
    console.log("Price in points:", event.args.priceInUSDTWei.toString());
    console.log("Price in TWD:", event.args.priceInTWD.toString());
    console.log("Is goods arrived:", event.args.isGoodsArrived);
    console.log("Estimate deliver time:", event.args.estimateDeliverTime.toString());
    console.log("Exchange expire time:", event.args.exchangeExpireTime.toString());
  }

  for (const event of newSubPrizeEvents) {
    console.log(
      "SubPrize:",
      event.args.subPrizeID.toString(),
      event.args.prizeGroup,
      event.args.subPrizeName,
      event.args.subPrizeRemainingQuantity.toString()
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
