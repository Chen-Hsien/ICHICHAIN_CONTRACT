// deploy fakeUSDT contract
import { ethers } from "hardhat";

async function main() {
  const doudoCoinFactory = await ethers.getContractFactory("DOUDOCOIN");
  const doudoCoinContract = await doudoCoinFactory.deploy('0x2f758DE9c4B83ed1a3B777b5f905d46Fa1c2C725', '0x2f758DE9c4B83ed1a3B777b5f905d46Fa1c2C725');
  await doudoCoinContract.waitForDeployment();

  console.log("Contract deployed to:", doudoCoinContract.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
