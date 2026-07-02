import { ethers, upgrades } from "hardhat";

const ADDRESSES = {
  core: process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  bundle: process.env.DOUDO_BUNDLE_MODULE_PROXY_ADDRESS || "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6",
  redraw: process.env.DOUDO_REDRAW_MODULE_PROXY_ADDRESS || "0xE75461828f41C890fbc811e7cABFe2143B3F4afE",
};

async function main() {
  const core = await ethers.getContractAt(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable",
    ADDRESSES.core
  );
  const bundle = await ethers.getContractAt(
    "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable",
    ADDRESSES.bundle
  );

  const mintTicketsSelector = bundle.interface.getFunction("mintTickets")!.selector;
  const seriesMintConfigSelector = core.interface.getFunction("seriesMintConfig")!.selector;

  console.log("Core proxy:", ADDRESSES.core);
  console.log("Core implementation:", await upgrades.erc1967.getImplementationAddress(ADDRESSES.core));
  console.log("Core paused:", await core.paused());
  console.log("seriesMintConfig selector:", seriesMintConfigSelector);

  console.log("Bundle proxy:", ADDRESSES.bundle);
  console.log("Bundle implementation:", await upgrades.erc1967.getImplementationAddress(ADDRESSES.bundle));
  console.log("mintTickets selector:", mintTicketsSelector);

  console.log("Redraw implementation:", await upgrades.erc1967.getImplementationAddress(ADDRESSES.redraw));

  const seriesID = BigInt(process.env.SERIES_ID || "7");
  const [price, useLuckyNumber] = await core.seriesMintConfig(seriesID);
  console.log(`seriesMintConfig(${seriesID}):`, {
    priceInPoints: ethers.formatEther(price),
    useLuckyNumber,
  });
  console.log(`seriesRebateTierCount(${seriesID}):`, (await bundle.seriesRebateTierCount(seriesID)).toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
