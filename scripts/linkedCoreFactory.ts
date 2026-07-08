import { ethers } from "hardhat";

export const CORE_FQN = "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable";

export async function linkedCoreFactory() {
  const PrizeDrawLib = await ethers.getContractFactory(
    "contracts/helpers/DoudoPrizeDrawLib.sol:DoudoPrizeDrawLib"
  );
  const prizeDrawLib = await PrizeDrawLib.deploy();
  await prizeDrawLib.waitForDeployment();

  const TokenURILib = await ethers.getContractFactory(
    "contracts/helpers/DoudoTokenURILib.sol:DoudoTokenURILib"
  );
  const tokenURILib = await TokenURILib.deploy();
  await tokenURILib.waitForDeployment();

  const prizeDrawLibAddress = await prizeDrawLib.getAddress();
  const tokenURILibAddress = await tokenURILib.getAddress();
  console.log("DoudoPrizeDrawLib:", prizeDrawLibAddress);
  console.log("DoudoTokenURILib:", tokenURILibAddress);

  return ethers.getContractFactory(CORE_FQN, {
    libraries: {
      DoudoPrizeDrawLib: prizeDrawLibAddress,
      DoudoTokenURILib: tokenURILibAddress,
    },
  });
}
