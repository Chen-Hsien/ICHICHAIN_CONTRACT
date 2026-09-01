import { ethers, upgrades } from "hardhat";

const LEGACY_FQN = "contracts/DOUDOCOINNFT.sol:DOUDOCOINNFT";

const requiredAddress = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} must be a valid address`);
  }
  return ethers.getAddress(value);
};

const requiredValue = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

async function main() {
  const execute = process.env.EXECUTE_LEGACY_SNAPSHOT_BLOCK_FIX === "1";
  const legacyProxy = requiredAddress("DOUDOCOIN_NFT_PROXY_ADDRESS");
  const expectedImplementation = requiredAddress(
    "EXPECTED_LEGACY_NFT_IMPLEMENTATION"
  );
  const snapshotBlock = BigInt(requiredValue("LEGACY_SNAPSHOT_BLOCK"));
  const snapshotRoot = requiredValue("LEGACY_SNAPSHOT_ROOT");
  const cancelledTokenUri = requiredValue("LEGACY_CANCELLED_TOKEN_URI");
  if (!ethers.isHexString(snapshotRoot, 32)) {
    throw new Error("LEGACY_SNAPSHOT_ROOT must be a bytes32 value");
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 42161n && network.chainId !== 421614n) {
    throw new Error(`Expected an Arbitrum network, got ${network.chainId}`);
  }
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("A configured upgrade signer is required");
  const signerAddress = await signer.getAddress();
  const currentImplementation = ethers.getAddress(
    await upgrades.erc1967.getImplementationAddress(legacyProxy)
  );
  if (currentImplementation !== expectedImplementation) {
    throw new Error(
      `Legacy NFT implementation mismatch: expected ${expectedImplementation}, got ${currentImplementation}`
    );
  }

  const Legacy = await ethers.getContractFactory(LEGACY_FQN);
  const legacy: any = await ethers.getContractAt(LEGACY_FQN, legacyProxy);
  if (!(await legacy.hasRole(await legacy.UPGRADER_ROLE(), signerAddress))) {
    throw new Error("Upgrade signer is missing legacy NFT UPGRADER_ROLE");
  }
  if (!(await legacy.hasRole(await legacy.DEFAULT_ADMIN_ROLE(), signerAddress))) {
    throw new Error("Upgrade signer is missing legacy NFT DEFAULT_ADMIN_ROLE");
  }
  if (await legacy.legacyCollectionCancelled()) {
    throw new Error("Legacy collection is already cancelled");
  }

  await upgrades.validateUpgrade(legacyProxy, Legacy, { kind: "uups" });
  console.log("Legacy snapshot block fix preflight passed", {
    execute,
    chainId: network.chainId.toString(),
    legacyProxy,
    currentImplementation,
    snapshotBlock: snapshotBlock.toString(),
    signer: signerAddress,
  });
  if (!execute) return;
  if (process.env.OPERATIONS_PAUSED !== "1") {
    throw new Error("OPERATIONS_PAUSED=1 is required for execution");
  }

  const upgraded: any = await upgrades.upgradeProxy(legacyProxy, Legacy, {
    kind: "uups",
  });
  await upgraded.waitForDeployment();
  const receipt = await upgraded.deploymentTransaction()?.wait();
  const newImplementation = ethers.getAddress(
    await upgrades.erc1967.getImplementationAddress(legacyProxy)
  );
  if (newImplementation === currentImplementation) {
    throw new Error("Legacy NFT implementation did not change");
  }

  const callData = upgraded.interface.encodeFunctionData(
    "cancelLegacyCollection",
    [snapshotBlock, snapshotRoot, cancelledTokenUri]
  );
  await ethers.provider.call({
    from: signerAddress,
    to: legacyProxy,
    data: callData,
  });
  console.log("Legacy snapshot block fix upgraded and simulated", {
    legacyProxy,
    previousImplementation: currentImplementation,
    newImplementation,
    upgradeTransactionHash: receipt?.hash,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
