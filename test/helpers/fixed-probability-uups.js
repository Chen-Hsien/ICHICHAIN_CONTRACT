const { ethers, upgrades } = require("hardhat");

async function fixedProbabilityFactory(
  libraries,
  signer,
  name = "FixedProbabilityLotteryV3Upgradeable",
) {
  return ethers.getContractFactory(name, { libraries, signer });
}
async function deployFixedProbabilityProxy(args) {
  const validation = await (
    await ethers.getContractFactory("FixedProbabilityConfigValidation")
  ).deploy();
  const settlement = await (
    await ethers.getContractFactory("FixedProbabilitySettlement")
  ).deploy();
  const buyback = await (
    await ethers.getContractFactory("FixedProbabilityBuybackValidation")
  ).deploy();
  const libraries = {
    FixedProbabilityBuybackValidation: await buyback.getAddress(),
    FixedProbabilityConfigValidation: await validation.getAddress(),
    FixedProbabilitySettlement: await settlement.getAddress(),
  };
  const factory = await fixedProbabilityFactory(libraries);
  const lottery = await upgrades.deployProxy(factory, args, {
    kind: "uups",
    unsafeAllowLinkedLibraries: true,
  });
  await lottery.waitForDeployment();
  return { lottery, libraries, factory };
}
module.exports = { deployFixedProbabilityProxy, fixedProbabilityFactory };
