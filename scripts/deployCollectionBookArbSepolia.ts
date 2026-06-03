import { ethers } from "hardhat";

const POINTS_ADDRESS = process.env.DOUDO_POINTS_ADDRESS || "";
const DOUDOCHAIN_V2_ADDRESS = process.env.DOUDOCHAIN_V2_ADDRESS || "";

async function main() {
  if (!POINTS_ADDRESS) {
    throw new Error("Set DOUDO_POINTS_ADDRESS");
  }

  const factory = await ethers.getContractFactory("contracts/CollectionBook.sol:CollectionBook");
  const book = await factory.deploy(POINTS_ADDRESS);
  await book.waitForDeployment();
  console.log("CollectionBook:", await book.getAddress());

  if (DOUDOCHAIN_V2_ADDRESS) {
    const tx = await book.setDoudochainV2RewardTarget(DOUDOCHAIN_V2_ADDRESS);
    await tx.wait();
    console.log("DOUDOCHAINV2 reward target:", DOUDOCHAIN_V2_ADDRESS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
