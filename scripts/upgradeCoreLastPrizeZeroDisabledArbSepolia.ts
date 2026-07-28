import { ethers, upgrades, run } from "hardhat";
import { CORE_FQN, linkedCoreFactory } from "./linkedCoreFactory";

const CHAIN_ID = 421614n;
const CORE_PROXY =
  process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS ||
  "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5";
const BACKFILLS = [
  { seriesID: 21n, quantity: 1 },
  { seriesID: 24n, quantity: 1 },
  { seriesID: 26n, quantity: 1 },
  { seriesID: 27n, quantity: 1 },
] as const;

async function verifyImplementation(address: string) {
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract: CORE_FQN,
    });
    console.log("Core implementation verified:", address);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Core implementation already verified:", address);
      return;
    }
    console.warn("Core implementation verification failed:", message);
  }
}

async function requireRole(
  core: any,
  roleName: "OPERATION_ROLE" | "UPGRADER_ROLE",
  signer: string
) {
  const role = await core[roleName]();
  if (!(await core.hasRole(role, signer))) {
    throw new Error(`${signer} does not have ${roleName}`);
  }
}

async function main() {
  if (process.env.EXECUTE_CORE_LAST_PRIZE_ZERO_DISABLED_UPGRADE !== "1") {
    throw new Error(
      "Set EXECUTE_CORE_LAST_PRIZE_ZERO_DISABLED_UPGRADE=1 to execute the Core upgrade."
    );
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(
      `Expected Arbitrum Sepolia chainId ${CHAIN_ID}, got ${network.chainId}`
    );
  }

  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const balance = await ethers.provider.getBalance(signerAddress);
  const core: any = await ethers.getContractAt(CORE_FQN, CORE_PROXY, signer);
  const oldImplementation =
    await upgrades.erc1967.getImplementationAddress(CORE_PROXY);
  const pausedBefore = await core.paused();
  const pointsBefore = await core.doudoPoints();
  const routerBefore = await core.vrfRouter();

  console.log("Network:", network.name, network.chainId.toString());
  console.log("Core proxy:", CORE_PROXY);
  console.log("Signer:", signerAddress);
  console.log("Signer balance:", ethers.formatEther(balance));
  console.log("Old implementation:", oldImplementation);
  console.log("Core paused before upgrade:", pausedBefore);

  await requireRole(core, "OPERATION_ROLE", signerAddress);
  await requireRole(core, "UPGRADER_ROLE", signerAddress);

  let pausedByScript = false;
  let newImplementation = oldImplementation;

  try {
    if (!pausedBefore) {
      const pauseTx = await core.pause();
      console.log("Pause tx:", pauseTx.hash);
      await pauseTx.wait();
      pausedByScript = true;
      console.log("Core paused");
    }

    for (const backfill of BACKFILLS) {
      const tx = await core.setSeriesLastPrizeQuantity(
        backfill.seriesID,
        backfill.quantity
      );
      console.log(
        `Backfill series ${backfill.seriesID} quantity ${backfill.quantity} tx:`,
        tx.hash
      );
      await tx.wait();
    }

    const Core = await linkedCoreFactory();
    await upgrades.validateUpgrade(CORE_PROXY, Core, {
      kind: "uups",
      unsafeAllowLinkedLibraries: true,
    });
    console.log("Storage-layout validation: OK");

    const upgraded: any = await upgrades.upgradeProxy(CORE_PROXY, Core, {
      kind: "uups",
      unsafeAllowLinkedLibraries: true,
    });
    const upgradeTx = upgraded.deploymentTransaction();
    if (upgradeTx) {
      console.log("Core upgrade tx:", upgradeTx.hash);
    }
    await upgraded.waitForDeployment();

    newImplementation =
      await upgrades.erc1967.getImplementationAddress(CORE_PROXY);
    if (newImplementation.toLowerCase() === oldImplementation.toLowerCase()) {
      throw new Error("Core implementation address did not change");
    }
    if ((await upgraded.doudoPoints()).toLowerCase() !== pointsBefore.toLowerCase()) {
      throw new Error("Core points wiring changed during upgrade");
    }
    if ((await upgraded.vrfRouter()).toLowerCase() !== routerBefore.toLowerCase()) {
      throw new Error("Core VRF router wiring changed during upgrade");
    }
    console.log("New implementation:", newImplementation);
    console.log("Core wiring verification: OK");
  } finally {
    if (pausedByScript && (await core.paused())) {
      const unpauseTx = await core.unpause();
      console.log("Unpause tx:", unpauseTx.hash);
      await unpauseTx.wait();
      console.log("Core unpaused");
    }
  }

  await verifyImplementation(newImplementation);
  console.log("Core last-prize zero-disabled upgrade complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
