import { artifacts } from "hardhat";
import { createHash } from "node:crypto";

/** Read-only artifact handoff. This script never deploys or upgrades a contract. */
async function main() {
  const fqn =
    "contracts/FixedProbabilityLotteryV3Upgradeable.sol:FixedProbabilityLotteryV3Upgradeable";
  const artifact = await artifacts.readArtifact(fqn);
  const info = await artifacts.getBuildInfo(fqn);
  if (!info)
    throw new Error("Compile the UUPS contract before preparing its handoff");
  const contract =
    info.output.contracts[artifact.sourceName][artifact.contractName];
  const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;
  if (runtimeBytes > 24576)
    throw new Error("EIP-170 implementation size exceeded");
  const initialize = artifact.abi.find(
    (entry) => entry.type === "function" && entry.name === "initialize",
  );
  const linkedLibraries = Object.entries(
    artifact.deployedLinkReferences,
  ).flatMap(([source, refs]) =>
    Object.keys(refs).map((name) => ({ source, name })),
  );
  const sha = (input: string) =>
    createHash("sha256").update(input).digest("hex");
  const storageLayout = (
    contract as typeof contract & { storageLayout: unknown }
  ).storageLayout;
  if (!storageLayout || !initialize || linkedLibraries.length !== 3)
    throw new Error("Incomplete UUPS artifact");
  console.log(
    JSON.stringify(
      {
        schemaVersion: "fixed-probability-uups-artifact-v1",
        contract: fqn,
        proxyKind: "uups",
        implementationSlot:
          "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
        implementationRuntimeBytes: runtimeBytes,
        abiSha256: sha(JSON.stringify(artifact.abi, null, 2) + "\n"),
        storageLayoutSha256: sha(JSON.stringify(storageLayout)),
        initializer: initialize,
        linkedLibraries,
        requiresDeploymentEvidence: [
          "proxy address/runtimeHash/receipt/startBlock",
          "implementation address/runtimeHash/receipt/startBlock",
          "all linked library addresses/runtimeHashes",
        ],
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
