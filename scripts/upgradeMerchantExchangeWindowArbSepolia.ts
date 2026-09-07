import { ethers, upgrades, run } from "hardhat";
import { CORE_FQN, linkedCoreFactory } from "./linkedCoreFactory";

const PUBLISHER_FQN =
  "contracts/MerchantSeriesPublisher.sol:MerchantSeriesPublisher";
const REGISTRY_FQN =
  "contracts/MerchantSeriesRegistry.sol:MerchantSeriesRegistry";

const EXPECTED_CHAIN_ID = 421614n;
const DEFAULTS = {
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  publisher: "0xB0EC5ca70a9AeCaeb260FdCDF238a64Ad37F5515",
  registry: "0x03dBEE1f231A29b06032aa24D2CFb96a1321C1A6",
};

async function verifyImplementation(address: string, contract: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract,
    });
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
  const execute = process.env.EXECUTE_MERCHANT_EXCHANGE_WINDOW_UPGRADE === "1";
  const coreProxy = process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core;
  const publisherProxy =
    process.env.MERCHANT_PUBLISHER_ADDRESS || DEFAULTS.publisher;
  const registryAddress =
    process.env.MERCHANT_REGISTRY_ADDRESS || DEFAULTS.registry;

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("ARB_TESTNET_PK is not configured");

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Wrong network: expected ${EXPECTED_CHAIN_ID}, got ${network.chainId}`
    );
  }

  const deployerAddress = await deployer.getAddress();
  const Core = await linkedCoreFactory();
  const Publisher = await ethers.getContractFactory(PUBLISHER_FQN);
  const core: any = await ethers.getContractAt(CORE_FQN, coreProxy);
  const publisher: any = await ethers.getContractAt(
    PUBLISHER_FQN,
    publisherProxy
  );
  const registry: any = await ethers.getContractAt(
    REGISTRY_FQN,
    registryAddress
  );

  const coreUpgraderRole = await core.UPGRADER_ROLE();
  const coreOperationRole = await core.OPERATION_ROLE();
  const publisherUpgraderRole = await publisher.UPGRADER_ROLE();
  const registryLinkerRole = await registry.LINKER_ROLE();

  if (!(await core.hasRole(coreUpgraderRole, deployerAddress))) {
    throw new Error("Deployer is missing Core UPGRADER_ROLE");
  }
  if (!(await core.hasRole(ethers.ZeroHash, deployerAddress))) {
    throw new Error("Deployer is missing Core DEFAULT_ADMIN_ROLE");
  }
  if (!(await publisher.hasRole(publisherUpgraderRole, deployerAddress))) {
    throw new Error("Deployer is missing Publisher UPGRADER_ROLE");
  }
  if (
    (await publisher.registry()).toLowerCase() !== registryAddress.toLowerCase()
  ) {
    throw new Error("Publisher registry does not match the expected registry");
  }
  if (!(await registry.hasRole(registryLinkerRole, publisherProxy))) {
    throw new Error("Publisher is missing Registry LINKER_ROLE");
  }
  if (!(await core.hasRole(coreOperationRole, publisherProxy))) {
    throw new Error("Publisher is missing Core OPERATION_ROLE before upgrade");
  }

  const oldCoreImplementation = await upgrades.erc1967.getImplementationAddress(
    coreProxy
  );
  const oldPublisherImplementation =
    await upgrades.erc1967.getImplementationAddress(publisherProxy);

  console.log("Network: arbitrum-sepolia", network.chainId.toString());
  console.log("Deployer:", deployerAddress);
  console.log("Core proxy:", coreProxy);
  console.log("Current Core implementation:", oldCoreImplementation);
  console.log("Publisher proxy:", publisherProxy);
  console.log("Current Publisher implementation:", oldPublisherImplementation);

  await upgrades.validateUpgrade(coreProxy, Core, {
    kind: "uups",
    unsafeAllowLinkedLibraries: true,
  });
  await upgrades.validateUpgrade(publisherProxy, Publisher, { kind: "uups" });
  console.log("Storage-layout validation: OK");

  if (!execute) {
    console.log(
      "Preflight only; set EXECUTE_MERCHANT_EXCHANGE_WINDOW_UPGRADE=1 to send transactions."
    );
    return;
  }

  const revokeTx = await core.revokeRole(coreOperationRole, publisherProxy);
  console.log(
    "Temporarily revoked Publisher Core OPERATION_ROLE:",
    revokeTx.hash
  );
  await revokeTx.wait();

  const upgradedCore: any = await upgrades.upgradeProxy(coreProxy, Core, {
    kind: "uups",
    unsafeAllowLinkedLibraries: true,
  });
  await upgradedCore.waitForDeployment();
  const newCoreImplementation = await upgrades.erc1967.getImplementationAddress(
    coreProxy
  );
  console.log("New Core implementation:", newCoreImplementation);

  const upgradedPublisher: any = await upgrades.upgradeProxy(
    publisherProxy,
    Publisher,
    { kind: "uups" }
  );
  await upgradedPublisher.waitForDeployment();
  const newPublisherImplementation =
    await upgrades.erc1967.getImplementationAddress(publisherProxy);
  console.log("New Publisher implementation:", newPublisherImplementation);

  if (
    newCoreImplementation.toLowerCase() === oldCoreImplementation.toLowerCase()
  ) {
    throw new Error("Core implementation address did not change");
  }
  if (
    newPublisherImplementation.toLowerCase() ===
    oldPublisherImplementation.toLowerCase()
  ) {
    throw new Error("Publisher implementation address did not change");
  }
  if (
    (await upgradedPublisher.registry()).toLowerCase() !==
    registryAddress.toLowerCase()
  ) {
    throw new Error("Publisher registry changed during upgrade");
  }
  if (!(await registry.hasRole(registryLinkerRole, publisherProxy))) {
    throw new Error("Publisher lost Registry LINKER_ROLE during upgrade");
  }

  const grantTx = await upgradedCore.grantRole(
    coreOperationRole,
    publisherProxy
  );
  console.log("Restored Publisher Core OPERATION_ROLE:", grantTx.hash);
  await grantTx.wait();

  if (!(await upgradedCore.hasRole(coreOperationRole, publisherProxy))) {
    throw new Error("Publisher Core OPERATION_ROLE restoration failed");
  }

  console.log("Post-upgrade role and wiring checks: OK");
  await verifyImplementation(newCoreImplementation, CORE_FQN);
  await verifyImplementation(newPublisherImplementation, PUBLISHER_FQN);
  console.log("Merchant exchange-window upgrade complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
