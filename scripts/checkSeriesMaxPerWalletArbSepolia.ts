import { ethers } from "hardhat";

const CORE_PROXY =
  process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5";
const SERIES_ID = BigInt(process.env.SERIES_ID || "7");
const SERIES_DATA_SLOT = 204n;
const MAX_PER_WALLET_STRUCT_SLOT = 13n;

async function main() {
  const baseSlot = BigInt(
    ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [SERIES_ID, SERIES_DATA_SLOT])
    )
  );
  const capSlot = baseSlot + MAX_PER_WALLET_STRUCT_SLOT;
  const raw = await ethers.provider.getStorage(CORE_PROXY, capSlot);
  const maxPerWallet = BigInt(raw);

  const core = await ethers.getContractAt(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    CORE_PROXY
  );

  let price: bigint | null = null;
  try {
    [price] = await core.seriesMintConfig(SERIES_ID);
  } catch {
    // Older Core implementations may not expose this getter.
  }

  const events = await core.queryFilter(core.filters.NewSeries(SERIES_ID));

  console.log("Core proxy:", CORE_PROXY);
  console.log("Series ID:", SERIES_ID.toString());
  console.log(
    "maxPerWallet:",
    maxPerWallet.toString(),
    maxPerWallet === 0n ? "(0 = unlimited)" : ""
  );
  if (price !== null) {
    console.log("priceInPoints:", ethers.formatEther(price));
  }

  if (events.length > 0) {
    const e = events[events.length - 1];
    console.log("seriesName:", e.args.seriesName);
    console.log("totalTicketNumbers:", e.args.totalTicketNumbers.toString());
    console.log("remainingTicketNumbers:", e.args.remainingTicketNumbers.toString());
    console.log("isGoodsArrived:", e.args.isGoodsArrived);
    console.log("isPreOrder:", e.args.isPreOrder);
    console.log("create tx:", e.transactionHash);
  } else {
    console.log("NewSeries event: not found (series may not exist)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
