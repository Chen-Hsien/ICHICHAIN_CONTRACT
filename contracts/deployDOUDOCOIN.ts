// deploy fakeUSDT contract
import { ethers } from "hardhat";

async function main() {
  const doudoCoinFactory = await ethers.getContractFactory("DOUDOCOIN");
  const doudoCoinContract = await doudoCoinFactory.deploy('0xaf48208B55e4F21AEa32aa2E3ffa09284270E0f2', '0xaf48208B55e4F21AEa32aa2E3ffa09284270E0f2');
  await doudoCoinContract.waitForDeployment();

  console.log("Contract deployed to:", doudoCoinContract.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
