import { ethers, upgrades } from "hardhat";

async function main() {
  const proxyAddress = process.env.DOUDOCOIN_NFT_PROXY_ADDRESS;
  if (!proxyAddress || !ethers.isAddress(proxyAddress)) {
    throw new Error("DOUDOCOIN_NFT_PROXY_ADDRESS is required");
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 421614n) {
    throw new Error(`Expected Arbitrum Sepolia (421614), got ${network.chainId}`);
  }

  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const Factory = await ethers.getContractFactory("DOUDOCOINNFT");
  const currentImplementation =
    await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const nft = await ethers.getContractAt("DOUDOCOINNFT", proxyAddress);
  const upgraderRole = await nft.UPGRADER_ROLE();

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Proxy:", proxyAddress);
  console.log("Current implementation:", currentImplementation);
  console.log("Signer:", signerAddress);
  console.log(
    "Has UPGRADER_ROLE:",
    await nft.hasRole(upgraderRole, signerAddress)
  );

  await upgrades.validateUpgrade(proxyAddress, Factory, { kind: "uups" });
  console.log("Upgrade safety validation: passed");
  if (process.env.EXECUTE_DOUDOCOIN_NFT_UUPS_UPGRADE !== "1") {
    console.log(
      "Dry run only. Set EXECUTE_DOUDOCOIN_NFT_UUPS_UPGRADE=1 to submit the upgrade."
    );
    return;
  }

  if (!(await nft.hasRole(upgraderRole, signerAddress))) {
    throw new Error("Signer does not have UPGRADER_ROLE");
  }
  const upgraded = await upgrades.upgradeProxy(proxyAddress, Factory, {
    kind: "uups",
  });
  await upgraded.waitForDeployment();
  console.log(
    "New implementation:",
    await upgrades.erc1967.getImplementationAddress(proxyAddress)
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
