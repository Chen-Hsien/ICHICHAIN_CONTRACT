import { promises as fs } from "fs";
import path from "path";
import { ethers, network, run, upgrades } from "hardhat";

const CHAIN_ID = 42161n;
const ADMIN = "0xaf48208B55e4F21AEa32aa2E3ffa09284270E0f2";
const BUNDLE_FQN =
  "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable";
const checkpointPath = path.join(
  process.cwd(),
  "deployments",
  "arbitrum-one.json"
);

type DeploymentCheckpoint = {
  chainId: string;
  admin: string;
  addresses: Record<string, string>;
  implementations: Record<string, string>;
  transactions: Record<string, string>;
  completed: string[];
};

async function loadCheckpoint(): Promise<DeploymentCheckpoint> {
  const checkpoint = JSON.parse(
    await fs.readFile(checkpointPath, "utf8")
  ) as DeploymentCheckpoint;
  if (
    checkpoint.chainId !== CHAIN_ID.toString() ||
    checkpoint.admin.toLowerCase() !== ADMIN.toLowerCase()
  ) {
    throw new Error(`Checkpoint identity mismatch: ${checkpointPath}`);
  }
  return checkpoint;
}

async function saveCheckpoint(checkpoint: DeploymentCheckpoint) {
  await fs.writeFile(
    checkpointPath,
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    "utf8"
  );
}

async function verifyImplementation(address: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract: BUNDLE_FQN,
    });
    console.log("Implementation verified:", address);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Implementation already verified:", address);
      return;
    }
    console.warn("Implementation verification failed:", message);
  }
}

async function findUpgradeReceipt(proxy: string, implementation: string) {
  const latestBlock = await ethers.provider.getBlockNumber();
  const logs = await ethers.provider.getLogs({
    address: proxy,
    fromBlock: Math.max(0, latestBlock - 10_000),
    toBlock: "latest",
    topics: [
      ethers.id("Upgraded(address)"),
      ethers.zeroPadValue(implementation, 32),
    ],
  });
  const upgradeLog = logs.at(-1);
  if (!upgradeLog) {
    throw new Error(`Upgraded event not found for ${implementation}`);
  }
  const receipt = await ethers.provider.getTransactionReceipt(
    upgradeLog.transactionHash
  );
  if (!receipt || receipt.status !== 1) {
    throw new Error("Bundle upgrade receipt is missing or unsuccessful");
  }
  return receipt;
}

async function main() {
  const execute = process.env.EXECUTE_ARBITRUM_ONE_BUNDLE_UPGRADE === "1";
  const checkpoint = await loadCheckpoint();
  const bundleProxy = checkpoint.addresses.DOUDO_BUNDLE_MODULE;
  const expectedCore = checkpoint.addresses.DOUDO_CORE;
  const expectedPoints = checkpoint.addresses.DOUDOCOIN;
  const expectedRedraw = checkpoint.addresses.DOUDO_REDRAW_MODULE;
  if (!bundleProxy || !expectedCore || !expectedPoints || !expectedRedraw) {
    throw new Error(
      "Arbitrum One checkpoint is missing Bundle wiring addresses"
    );
  }

  const activeNetwork = await ethers.provider.getNetwork();
  if (activeNetwork.chainId !== CHAIN_ID) {
    throw new Error(
      `Expected Arbitrum One (${CHAIN_ID}), got ${activeNetwork.chainId}`
    );
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("ARB_MAINNET_PK is missing or invalid");
  const deployerAddress = await deployer.getAddress();
  if (deployerAddress.toLowerCase() !== ADMIN.toLowerCase()) {
    throw new Error(
      `Configured signer ${deployerAddress} does not match ADMIN ${ADMIN}`
    );
  }

  const bundle: any = await ethers.getContractAt(BUNDLE_FQN, bundleProxy);
  const currentImplementation = await upgrades.erc1967.getImplementationAddress(
    bundleProxy
  );
  const upgraderRole = await bundle.UPGRADER_ROLE();
  const balance = await ethers.provider.getBalance(deployerAddress);

  console.log("Arbitrum One Bundle opening-discount upgrade preflight");
  console.log("Execute:", execute);
  console.log("Bundle proxy:", bundleProxy);
  console.log("Current implementation:", currentImplementation);
  console.log("Upgrader:", deployerAddress);
  console.log("Upgrader balance:", ethers.formatEther(balance), "ETH");

  if (!(await bundle.hasRole(upgraderRole, deployerAddress))) {
    throw new Error("Configured wallet does not have Bundle UPGRADER_ROLE");
  }
  if ((await bundle.core()).toLowerCase() !== expectedCore.toLowerCase()) {
    throw new Error("Unexpected Bundle core wiring");
  }
  if (
    (await bundle.doudoPoints()).toLowerCase() !== expectedPoints.toLowerCase()
  ) {
    throw new Error("Unexpected Bundle points wiring");
  }
  if (
    (await bundle.redrawModule()).toLowerCase() !== expectedRedraw.toLowerCase()
  ) {
    throw new Error("Unexpected Bundle redraw wiring");
  }

  const Bundle = await ethers.getContractFactory(BUNDLE_FQN);
  await upgrades.validateUpgrade(bundleProxy, Bundle, { kind: "uups" });
  console.log("Storage-layout validation: OK");
  console.log("Wiring and upgrader checks: OK");

  if (!execute) {
    console.log(
      "Read-only preflight complete; set EXECUTE_ARBITRUM_ONE_BUNDLE_UPGRADE=1 to execute."
    );
    return;
  }

  const upgraded: any = await upgrades.upgradeProxy(bundleProxy, Bundle, {
    kind: "uups",
  });
  await upgraded.waitForDeployment();

  const newImplementation = await upgrades.erc1967.getImplementationAddress(
    bundleProxy
  );
  if (newImplementation.toLowerCase() === currentImplementation.toLowerCase()) {
    throw new Error("Bundle implementation did not change");
  }
  const receipt = await findUpgradeReceipt(bundleProxy, newImplementation);
  console.log("Upgrade transaction:", receipt.hash);

  const openingDiscount = await upgraded.seriesOpeningDiscounts(0);
  if (
    openingDiscount.ticketLimit !== 0n ||
    openingDiscount.priceInPoints !== 0n ||
    openingDiscount.active !== false
  ) {
    throw new Error("Unexpected opening discount default state");
  }
  if ((await upgraded.core()).toLowerCase() !== expectedCore.toLowerCase()) {
    throw new Error("Bundle core wiring changed after upgrade");
  }
  if (
    (await upgraded.doudoPoints()).toLowerCase() !==
    expectedPoints.toLowerCase()
  ) {
    throw new Error("Bundle points wiring changed after upgrade");
  }
  if (
    (await upgraded.redrawModule()).toLowerCase() !==
    expectedRedraw.toLowerCase()
  ) {
    throw new Error("Bundle redraw wiring changed after upgrade");
  }

  checkpoint.implementations.DOUDO_BUNDLE_MODULE = newImplementation;
  checkpoint.transactions["upgrade:DOUDO_BUNDLE_MODULE:openingDiscount"] =
    receipt.hash;
  if (!checkpoint.completed.includes("upgrade:bundle:openingDiscount")) {
    checkpoint.completed.push("upgrade:bundle:openingDiscount");
  }
  await saveCheckpoint(checkpoint);

  console.log("New implementation:", newImplementation);
  console.log("Upgrade block:", receipt.blockNumber);
  console.log("Post-upgrade opening-discount and wiring checks: OK");
  await verifyImplementation(newImplementation);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
