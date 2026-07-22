import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const Token = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
  const token = await Token.deploy(deployerAddress, deployerAddress);
  await token.waitForDeployment();

  console.log("DOUDOCOIN soulbound points:", await token.getAddress());
  console.log("DEFAULT_ADMIN_ROLE:", deployerAddress);
  console.log("MINTER_ROLE:", deployerAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
