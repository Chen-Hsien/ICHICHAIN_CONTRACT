import { promises as fs } from "fs";
import path from "path";
import { artifacts, ethers, network, run, upgrades } from "hardhat";

const FQN =
  "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable";
const targets: Record<
  string,
  { chainId: bigint; bundle: string; core: string }
> = {
  arbitrumOne: {
    chainId: 42161n,
    bundle: "0x0aDe18AD89B9971229d5E6588a76d4bEeAaE4b8f",
    core: "0x4749289F940F0C6B7cf68A19b0BDc611b80cdb0A",
  },
  arbitrumSepolia: {
    chainId: 421614n,
    bundle: "0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6",
    core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  },
};

let stage = "network";
async function main() {
  const target = targets[network.name];
  if (
    !target ||
    (await ethers.provider.getNetwork()).chainId !== target.chainId
  )
    throw new Error("Unexpected upgrade network");
  const execute =
    process.env.EXECUTE_OPENING_DISCOUNT_ROUND_IDS_UPGRADE ===
    target.chainId.toString();
  stage = "signer";
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("Upgrade signer is unavailable");
  stage = "wiring-and-role";
  const bundle: any = await ethers.getContractAt(FQN, target.bundle);
  if ((await bundle.core()).toLowerCase() !== target.core.toLowerCase())
    throw new Error("Unexpected Core wiring");
  if (!(await bundle.hasRole(await bundle.UPGRADER_ROLE(), signer.address)))
    throw new Error("Signer lacks UPGRADER_ROLE");
  const oldImplementation = await upgrades.erc1967.getImplementationAddress(
    target.bundle,
  );
  const factory = await ethers.getContractFactory(FQN);
  stage = "storage-layout";
  await upgrades.validateUpgrade(target.bundle, factory, { kind: "uups" });
  const artifact = await artifacts.readArtifact(FQN);
  const size = (artifact.deployedBytecode.length - 2) / 2;
  if (size > 24576) throw new Error("Bundle exceeds EIP-170 runtime limit");
  stage = "series-inventory";
  const block = await ethers.provider.getBlockNumber();
  const core: any = await ethers.getContractAt("IDoudoCore", target.core);
  const snapshot: Array<{ seriesId: number; config: string[]; used: string }> =
    [];
  for (let seriesId = 0; seriesId < 10000; seriesId++) {
    stage = `series-inventory:${seriesId}`;
    const config = await core.seriesMintConfig(seriesId, { blockTag: block });
    // Series IDs are sequential; a nonexistent ID has a zero total quantity.
    if (config[3] === 0n) break;
    snapshot.push({
      seriesId,
      config: Array.from(
        await bundle.seriesOpeningDiscounts(seriesId, { blockTag: block }),
        String,
      ),
      used: String(
        await bundle.openingDiscountUsed(seriesId, { blockTag: block }),
      ),
    });
    if (seriesId === 9999) throw new Error("Series inventory limit exceeded");
  }
  const getters = [
    "core",
    "doudoPoints",
    "redrawModule",
    "databasePointsModeEnabled",
    "pointsAuthorizationSigner",
    "membershipV2",
  ];
  const wiring: Record<string, string> = {};
  for (const getter of getters) {
    stage = `wiring-snapshot:${getter}`;
    wiring[getter] = String(await bundle[getter]({ blockTag: block }));
  }
  const report: Record<string, unknown> = {
    network: network.name,
    chainId: target.chainId.toString(),
    proxy: target.bundle,
    oldImplementation,
    signer: signer.address,
    runtimeBytes: size,
    creationBytecodeHash: ethers.keccak256(factory.bytecode),
    snapshotBlock: block,
    wiring,
    series: snapshot,
    executed: false,
  };
  const reportPath = path.join(
    process.cwd(),
    "deployments",
    `opening-discount-round-ids-${target.chainId}.json`,
  );
  console.log(JSON.stringify({ ...report, series: snapshot.length }, null, 2));
  if (!execute) {
    console.log("Read-only preflight passed; no transaction submitted.");
    return;
  }
  const previousReport = await fs
    .readFile(reportPath, "utf8")
    .then((text) => JSON.parse(text))
    .catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (previousReport) {
    if (
      previousReport.executed &&
      previousReport.implementation?.toLowerCase() ===
        oldImplementation.toLowerCase() &&
      previousReport.creationBytecodeHash === report.creationBytecodeHash
    ) {
      console.log(
        "This exact upgrade is already recorded; no additional transaction submitted.",
      );
      return;
    }
    throw new Error(
      "An existing upgrade checkpoint requires review before another execution",
    );
  }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  stage = "upgrade";
  const upgraded = await upgrades.upgradeProxy(target.bundle, factory, {
    kind: "uups",
  });
  const tx = upgraded.deploymentTransaction();
  const implementation = await upgrades.erc1967.getImplementationAddress(
    target.bundle,
  );
  if (implementation.toLowerCase() === oldImplementation.toLowerCase())
    throw new Error("Implementation did not change");
  let upgradeTxHash = tx?.hash;
  if (!upgradeTxHash) {
    const upgradedTopic = ethers.id("Upgraded(address)");
    const implementationTopic = ethers.zeroPadValue(implementation, 32);
    const logs = await ethers.provider.getLogs({
      address: target.bundle,
      topics: [upgradedTopic, implementationTopic],
      fromBlock: block + 1,
      toBlock: "latest",
    });
    if (logs.length !== 1)
      throw new Error(
        "Upgrade transaction unavailable and matching Upgraded log is ambiguous",
      );
    upgradeTxHash = logs[0].transactionHash;
  }
  report.upgradeTxHash = upgradeTxHash;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  const receipt = tx
    ? await tx.wait()
    : await ethers.provider.getTransactionReceipt(upgradeTxHash);
  if (!receipt || receipt.status !== 1)
    throw new Error("Upgrade transaction failed");
  report.executed = true;
  report.implementation = implementation;
  report.upgradeBlock = receipt.blockNumber;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  for (const getter of getters) {
    if (String(await bundle[getter]()) !== wiring[getter])
      throw new Error(`Wiring changed: ${getter}`);
  }
  // Compare against the parent block and exclude series touched by legitimate concurrent promotion events.
  const rawLogs = await ethers.provider.getLogs({
    address: target.bundle,
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });
  const events = rawLogs
    .map((log) => {
      try {
        return bundle.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const touched = new Set(
    events.flatMap((event: any) =>
      [
        "OpeningDiscountConfigured",
        "OpeningDiscountCleared",
        "OpeningDiscountApplied",
      ].includes(event.name)
        ? [Number(event.args.seriesID)]
        : [],
    ),
  );
  for (const row of snapshot) {
    if (touched.has(row.seriesId)) continue;
    const previous = Array.from(
      await bundle.seriesOpeningDiscounts(row.seriesId, {
        blockTag: receipt.blockNumber - 1,
      }),
      String,
    );
    const current = Array.from(
      await bundle.seriesOpeningDiscounts(row.seriesId, {
        blockTag: receipt.blockNumber,
      }),
      String,
    );
    if (
      JSON.stringify(previous) !== JSON.stringify(current) ||
      String(
        await bundle.openingDiscountUsed(row.seriesId, {
          blockTag: receipt.blockNumber - 1,
        }),
      ) !==
        String(
          await bundle.openingDiscountUsed(row.seriesId, {
            blockTag: receipt.blockNumber,
          }),
        )
    )
      throw new Error(
        `Promotion state changed during upgrade for series ${row.seriesId}`,
      );
  }
  for (const row of snapshot) {
    if ((await bundle.openingDiscountRoundId(row.seriesId)) !== 0n)
      throw new Error(`Legacy round ID was not initialized to zero for series ${row.seriesId}`);
  }
  report.preservedSeriesCount = snapshot.length - touched.size;
  report.concurrentlyTouchedSeries = [...touched];
  report.legacyRoundIdsInitializedToZero = snapshot.length;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (target.chainId === 42161n) {
    const checkpointPath = path.join(
      process.cwd(),
      "deployments/arbitrum-one.json",
    );
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf8"));
    checkpoint.implementations.DOUDO_BUNDLE_MODULE = implementation;
    checkpoint.transactions[
      "upgrade:DOUDO_BUNDLE_MODULE:openingDiscountRoundIds"
    ] = upgradeTxHash;
    checkpoint.completed = [
      ...new Set([
        ...checkpoint.completed,
        "upgrade:bundle:openingDiscountRoundIds",
      ]),
    ];
    await fs.writeFile(
      checkpointPath,
      JSON.stringify(checkpoint, null, 2) + "\n",
    );
  }
  try {
    await run("verify:verify", {
      address: implementation,
      constructorArguments: [],
      contract: FQN,
    });
    report.sourceVerified = true;
  } catch {
    report.sourceVerified = false;
  }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      implementation,
      upgradeTxHash,
      upgradeBlock: receipt.blockNumber,
      sourceVerified: report.sourceVerified,
    }),
  );
}
main().catch((error) => {
  console.error(
    `Opening discount round ID upgrade stopped at ${stage}; error type=${error?.name ?? "unknown"}, code=${error?.code ?? "none"}. Inspect the deployment checkpoint before retrying.`,
  );
  process.exitCode = 1;
});
