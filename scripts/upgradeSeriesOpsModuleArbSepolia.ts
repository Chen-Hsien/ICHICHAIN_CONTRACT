import { ethers, upgrades, run } from "hardhat";

const DEFAULT_SERIES_OPS_PROXY = "0x2FF7521dEF3903fc5c6f2877252cdf5019380070";
const SERIES_OPS_FQN =
  "contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol:DoudoSeriesOpsModuleUpgradeable";

async function verify(address: string, contract?: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract,
    });
  } catch (error: any) {
    const message = String(error?.message || error);
    if (!message.toLowerCase().includes("already verified")) throw error;
  }
}

async function main() {
  const proxy =
    process.env.DOUDO_SERIES_OPS_MODULE_PROXY_ADDRESS ||
    DEFAULT_SERIES_OPS_PROXY;
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Upgrader:", await deployer.getAddress());
  console.log("SeriesOps proxy:", proxy);
  console.log(
    "Old implementation:",
    await upgrades.erc1967.getImplementationAddress(proxy)
  );

  const SeriesOps = await ethers.getContractFactory(SERIES_OPS_FQN);
  const seriesOps: any = await upgrades.upgradeProxy(proxy, SeriesOps);
  await seriesOps.waitForDeployment();

  const implementation = await upgrades.erc1967.getImplementationAddress(proxy);
  console.log("New implementation:", implementation);

  if ((await seriesOps.defaultLockDuration()) !== 300n) {
    const tx = await seriesOps.setDefaultLockDuration(300);
    console.log("Set default lock duration tx:", tx.hash);
    await tx.wait();
  }
  if ((await seriesOps.MAX_MINT_LOCK_DURATION()) !== 300n) {
    throw new Error("Unexpected max mint lock duration");
  }

  await verify(implementation, SERIES_OPS_FQN);
  await verify(proxy);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
