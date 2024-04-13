// deploy fakeUSDT contract
import { ethers } from "hardhat";

async function main() {
  const fakeUSDTFactory = await ethers.getContractFactory("FakeUSDT");
  const fakeUSDTContract = await fakeUSDTFactory.deploy();
  await fakeUSDTContract.waitForDeployment();

  console.log("Contract deployed to:", fakeUSDTContract.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
