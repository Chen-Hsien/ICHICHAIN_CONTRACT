import { ethers, upgrades, run } from "hardhat";

const DEFAULTS = {
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
};

const REGISTRY_FQN = "contracts/MerchantSeriesRegistry.sol:MerchantSeriesRegistry";
const PUBLISHER_FQN = "contracts/MerchantSeriesPublisher.sol:MerchantSeriesPublisher";
const CORE_FQN = "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable";

async function verify(address: string, contract?: string, args: unknown[] = []) {
  try {
    await run("verify:verify", { address, constructorArguments: args, contract });
    console.log("Verified:", address, contract || "");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified:", address, contract || "");
      return;
    }
    console.warn("Verify failed:", address, contract || "", message);
  }
}

async function main() {
  const coreProxy = process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core;
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const admin = process.env.MERCHANT_REGISTRY_ADMIN || deployerAddr;
  const operator = process.env.MERCHANT_PUBLISHER_OPERATOR || deployerAddr;

  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, network.chainId.toString());
  console.log("Deployer:", deployerAddr);
  console.log("Core proxy:", coreProxy);
  console.log("Registry admin:", admin);
  console.log("Publisher operator:", operator);

  const Registry = await ethers.getContractFactory(REGISTRY_FQN);
  const registry = await upgrades.deployProxy(Registry, [admin], {
    initializer: "initialize",
    kind: "uups",
  });
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("MerchantSeriesRegistry proxy:", registryAddr);

  const Publisher = await ethers.getContractFactory(PUBLISHER_FQN);
  const publisher = await upgrades.deployProxy(Publisher, [admin, registryAddr], {
    initializer: "initialize",
    kind: "uups",
  });
  await publisher.waitForDeployment();
  const publisherAddr = await publisher.getAddress();
  console.log("MerchantSeriesPublisher proxy:", publisherAddr);

  const core = await ethers.getContractAt(CORE_FQN, coreProxy);
  const OPERATION_ROLE = await core.OPERATION_ROLE();
  const LINKER_ROLE = await registry.LINKER_ROLE();
  const PUBLISHER_OPERATION_ROLE = await publisher.PUBLISHER_OPERATION_ROLE();

  await (await core.grantRole(OPERATION_ROLE, publisherAddr)).wait();
  await (await registry.grantRole(LINKER_ROLE, publisherAddr)).wait();
  if (operator.toLowerCase() !== admin.toLowerCase()) {
    await (await publisher.grantRole(PUBLISHER_OPERATION_ROLE, operator)).wait();
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
  console.log("Role wiring OK.");

  const registryImpl = await upgrades.erc1967.getImplementationAddress(registryAddr);
  console.log("Registry implementation:", registryImpl);
  await verify(registryImpl, REGISTRY_FQN);
  const publisherImpl = await upgrades.erc1967.getImplementationAddress(publisherAddr);
  console.log("Publisher implementation:", publisherImpl);
  await verify(publisherImpl, PUBLISHER_FQN);

  console.log("");
  console.log("NEXT OPS STEP (manual, after confirming a Publisher publish works):");
  console.log("Revoke Core OPERATION_ROLE from every human/back-end wallet so all");
  console.log("series creation must go through the Publisher. Review whether any");
  console.log("non-publish operational setters need a separate role first.");
  console.log("Example: core.revokeRole(OPERATION_ROLE, <humanWallet>)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
