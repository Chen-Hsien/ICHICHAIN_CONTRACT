import { ethers } from "hardhat";

async function main() {

  const ICHICHAINContract = await ethers.deployContract("ICHICHAIN", [process.env.LINK_SUBSCRIPTIONS || "", process.env.LINK_TOKEN || ""]);
  await ICHICHAINContract.waitForDeployment();

  console.log("Contract deployed to:" , ICHICHAINContract.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});