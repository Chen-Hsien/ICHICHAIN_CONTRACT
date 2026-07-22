import { ethers } from "hardhat";

const POINTS_ADDRESS = process.env.DOUDO_POINTS_ADDRESS || "";
const VRF_COORDINATOR = "0x5CE8D5A2BC84beb22a398CCA51996F7930313D61";
const KEY_HASH = "0x1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be";
const SUBSCRIPTION_ID =
  "106016056432422253373974444299096295296684744368940754254159766683809634643463";
const REQUEST_CONFIRMATIONS = 0;
const COLLECTION_BOOK_ADDRESS = process.env.COLLECTION_BOOK_ADDRESS || "";

async function main() {
  if (!POINTS_ADDRESS) {
    throw new Error("Set DOUDO_POINTS_ADDRESS");
  }

  const factory = await ethers.getContractFactory("contracts/DOUDOCHAINV2.sol:DOUDOCHAINV2");
  const core = await factory.deploy(
    POINTS_ADDRESS,
    VRF_COORDINATOR,
    SUBSCRIPTION_ID,
    KEY_HASH,
    REQUEST_CONFIRMATIONS
  );
  await core.waitForDeployment();
  console.log("DOUDOCHAINV2:", await core.getAddress());

  if (COLLECTION_BOOK_ADDRESS) {
    const tx = await core.grantRole(await core.COLLECTION_BOOK_ROLE(), COLLECTION_BOOK_ADDRESS);
    await tx.wait();
    console.log("COLLECTION_BOOK_ROLE granted to:", COLLECTION_BOOK_ADDRESS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
