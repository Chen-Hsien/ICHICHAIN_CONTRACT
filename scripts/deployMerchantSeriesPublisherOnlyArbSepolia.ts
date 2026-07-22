import { ethers, upgrades, run } from "hardhat";

const DEFAULTS = {
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  registry: "0x03dBEE1f231A29b06032aa24D2CFb96a1321C1A6",
  previousPublishers: [
    "0x259FB223A10D0116e5802d30FF5f441353C8972d",
    "0x7E78f2fA9FDD2156ddAb905222a78d6E40fd1C0a",
  ],
};

const PUBLISHER_FQN = "contracts/MerchantSeriesPublisher.sol:MerchantSeriesPublisher";
const CORE_FQN = "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable";
const REGISTRY_FQN = "contracts/MerchantSeriesRegistry.sol:MerchantSeriesRegistry";

async function verify(address: string, contract: string, args: unknown[]) {
  try {
    await run("verify:verify", { address, constructorArguments: args, contract });
    console.log("Verified:", address, contract);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified:", address, contract);
      return;
    }
    console.warn("Verify failed:", address, contract, message);
  }
}

async function main() {
  const coreProxy = process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core;
  const registryAddr = process.env.MERCHANT_REGISTRY_ADDRESS || DEFAULTS.registry;
  const previousPublishers = (
    process.env.PREVIOUS_MERCHANT_PUBLISHERS || DEFAULTS.previousPublishers.join(",")
  )
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);

  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const admin = process.env.MERCHANT_REGISTRY_ADMIN || deployerAddr;
  const operator = process.env.MERCHANT_PUBLISHER_OPERATOR || deployerAddr;

  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, network.chainId.toString());
  console.log("Deployer:", deployerAddr);
  console.log("Core proxy:", coreProxy);
  console.log("MerchantSeriesRegistry:", registryAddr);
  console.log("Publisher admin:", admin);
  console.log("Publisher operator:", operator);
  console.log("Previous publishers to revoke:", previousPublishers.join(", ") || "(none)");

  const Publisher = await ethers.getContractFactory(PUBLISHER_FQN);
  const publisher = await upgrades.deployProxy(Publisher, [admin, registryAddr], {
    initializer: "initialize",
    kind: "uups",
  });
  await publisher.waitForDeployment();
  const publisherAddr = await publisher.getAddress();
  const publisherImpl = await upgrades.erc1967.getImplementationAddress(publisherAddr);
  console.log("MerchantSeriesPublisher proxy:", publisherAddr);
  console.log("MerchantSeriesPublisher implementation:", publisherImpl);

  const core = await ethers.getContractAt(CORE_FQN, coreProxy);
  const registry = await ethers.getContractAt(REGISTRY_FQN, registryAddr);

  const OPERATION_ROLE = await core.OPERATION_ROLE();
  const LINKER_ROLE = await registry.LINKER_ROLE();
  const PUBLISHER_OPERATION_ROLE = await publisher.PUBLISHER_OPERATION_ROLE();

  if (!(await core.hasRole(OPERATION_ROLE, publisherAddr))) {
    const tx = await core.grantRole(OPERATION_ROLE, publisherAddr);
    await tx.wait();
    console.log("Granted Core OPERATION_ROLE:", tx.hash);
  }
  if (!(await registry.hasRole(LINKER_ROLE, publisherAddr))) {
    const tx = await registry.grantRole(LINKER_ROLE, publisherAddr);
    await tx.wait();
    console.log("Granted Registry LINKER_ROLE:", tx.hash);
  }
  if (!(await publisher.hasRole(PUBLISHER_OPERATION_ROLE, operator))) {
    const tx = await publisher.grantRole(PUBLISHER_OPERATION_ROLE, operator);
    await tx.wait();
    console.log("Granted Publisher PUBLISHER_OPERATION_ROLE:", tx.hash);
  }

  if (!(await core.hasRole(OPERATION_ROLE, publisherAddr))) {
    throw new Error("Publisher is missing Core OPERATION_ROLE");
  }
  if (!(await registry.hasRole(LINKER_ROLE, publisherAddr))) {
    throw new Error("Publisher is missing Registry LINKER_ROLE");
  }
  if (!(await publisher.hasRole(PUBLISHER_OPERATION_ROLE, operator))) {
    throw new Error("Operator is missing Publisher PUBLISHER_OPERATION_ROLE");
  }

  for (const previousPublisher of previousPublishers) {
    if (previousPublisher.toLowerCase() === publisherAddr.toLowerCase()) {
      continue;
    }
    if (await core.hasRole(OPERATION_ROLE, previousPublisher)) {
      const tx = await core.revokeRole(OPERATION_ROLE, previousPublisher);
      await tx.wait();
      console.log("Revoked Core OPERATION_ROLE:", previousPublisher, tx.hash);
    }
    if (await registry.hasRole(LINKER_ROLE, previousPublisher)) {
      const tx = await registry.revokeRole(LINKER_ROLE, previousPublisher);
      await tx.wait();
      console.log("Revoked Registry LINKER_ROLE:", previousPublisher, tx.hash);
    }
  }

  console.log("Role wiring OK.");
  await verify(publisherImpl, PUBLISHER_FQN, []);
  console.log("Publisher deploy complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
