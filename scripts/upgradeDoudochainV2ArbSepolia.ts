import { ethers, upgrades } from "hardhat";

async function upgradeProxy(proxyAddress: string, factoryName: string, label: string) {
  const Factory = await ethers.getContractFactory(factoryName);
  const upgraded = await upgrades.upgradeProxy(proxyAddress, Factory);
  await upgraded.waitForDeployment();
  const implementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`${label} proxy:`, proxyAddress);
  console.log(`${label} implementation:`, implementation);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Upgrader / official ops wallet:", await deployer.getAddress());

  const doudochainProxy = process.env.DOUDOCHAIN_V2_PROXY_ADDRESS || "";
  const collectionBookProxy = process.env.COLLECTION_BOOK_PROXY_ADDRESS || "";

  if (!doudochainProxy && !collectionBookProxy) {
    throw new Error("Set DOUDOCHAIN_V2_PROXY_ADDRESS and/or COLLECTION_BOOK_PROXY_ADDRESS");
  }

  if (doudochainProxy) {
    await upgradeProxy(
      doudochainProxy,
      "contracts/DOUDOCHAINV2Upgradeable.sol:DOUDOCHAINV2Upgradeable",
      "DOUDOCHAINV2Upgradeable"
    );
  }

  if (collectionBookProxy) {
    await upgradeProxy(
      collectionBookProxy,
      "contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable",
      "CollectionBookUpgradeable"
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
