import { ethers, upgrades } from "hardhat";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const BUNDLE_FQN =
  "contracts/modules/DoudoBundleModuleUpgradeable.sol:DoudoBundleModuleUpgradeable";
const REFUND_FQN =
  "contracts/modules/DoudoRefundModuleUpgradeable.sol:DoudoRefundModuleUpgradeable";
const COLLECTION_REWARD_FQN =
  "contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol:DoudoCollectionRewardModuleUpgradeable";
const MEMBERSHIP_FQN =
  "contracts/DoudoMembershipV2Upgradeable.sol:DoudoMembershipV2Upgradeable";
const LEGACY_FQN = "contracts/DOUDOCOINNFT.sol:DOUDOCOINNFT";
const LEGACY_POINTS_FQN = "contracts/DDOUDOCOIN.sol:DOUDOCOIN";

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

const requiredAddressList = (name: string) => {
  const raw = requiredValue(name);
  if (raw.toUpperCase() === "NONE") return [];
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0 || values.some((value) => !ethers.isAddress(value))) {
    throw new Error(`${name} must contain a comma-separated address list`);
  }
  return [...new Set(values.map((value) => ethers.getAddress(value)))];
};

const optionalNonnegativeInteger = (name: string, fallback: bigint) => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return BigInt(raw);
};

type CutoverCheckpoint = {
  version: 1;
  chainId: string;
  inputFingerprint: string;
  membershipProxy?: string;
  completedSteps: string[];
  updatedAt: string;
};

type PointsMigrationGate = {
  version: 1;
  status: "VERIFIED";
  migrationId: string;
  chainId: string;
  snapshotBlock: string;
  snapshotRoot: string;
  manifestSha256: string;
  entryCount: number;
  membershipEntryCount: number;
  totalRaw: string;
  verifiedAt: string;
};

type MembershipMigrationEntry = {
  walletAddress: string;
  level: number;
  currentQualifyingSpendRaw: string;
  lifetimeSpendRaw: string;
  lastActivityAt: string;
  legacyMembershipTokenId: string | null;
  voucherCreditRaw: string;
};

type CutoverManifest = {
  version: 1;
  migrationId: string;
  chainId: string;
  snapshotBlock: string;
  snapshotBlockHash: string;
  snapshotRoot: string;
  contracts: {
    legacyPoints: string;
    legacyNft: string;
  };
  entries: Array<{
    walletAddress: string;
    sourceType: "LEGACY_POINTS" | "LEGACY_VOUCHER";
    sourceId: string;
    amountRaw: string;
  }>;
  membershipEntries: MembershipMigrationEntry[];
  entryCount: number;
  membershipEntryCount: number;
  totalRaw: string;
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const canonicalSnapshot = (manifest: CutoverManifest) =>
  JSON.stringify({
    version: 1,
    chainId: manifest.chainId,
    snapshotBlock: manifest.snapshotBlock,
    snapshotBlockHash: manifest.snapshotBlockHash.toLowerCase(),
    contracts: {
      legacyPoints: manifest.contracts.legacyPoints.toLowerCase(),
      legacyNft: manifest.contracts.legacyNft.toLowerCase(),
    },
    entries: manifest.entries,
    membershipEntries: manifest.membershipEntries,
  });

const parseCutoverManifest = (value: unknown): CutoverManifest => {
  if (!value || typeof value !== "object") {
    throw new Error("Database points migration manifest must be an object");
  }
  const manifest = value as Partial<CutoverManifest>;
  if (
    manifest.version !== 1 ||
    typeof manifest.migrationId !== "string" ||
    !/^\d+$/.test(manifest.chainId ?? "") ||
    !/^\d+$/.test(manifest.snapshotBlock ?? "") ||
    !ethers.isHexString(manifest.snapshotBlockHash ?? "", 32) ||
    !ethers.isHexString(manifest.snapshotRoot ?? "", 32) ||
    !manifest.contracts ||
    !ethers.isAddress(manifest.contracts.legacyPoints ?? "") ||
    !ethers.isAddress(manifest.contracts.legacyNft ?? "") ||
    !Array.isArray(manifest.entries) ||
    !Array.isArray(manifest.membershipEntries) ||
    !Number.isSafeInteger(manifest.entryCount) ||
    !Number.isSafeInteger(manifest.membershipEntryCount) ||
    !/^\d+$/.test(manifest.totalRaw ?? "")
  ) {
    throw new Error("Database points migration manifest shape is invalid");
  }
  const typed = manifest as CutoverManifest;
  const seenWallets = new Set<string>();
  for (const [index, entry] of typed.membershipEntries.entries()) {
    if (
      !ethers.isAddress(entry.walletAddress) ||
      !Number.isSafeInteger(entry.level) ||
      entry.level < 0 ||
      entry.level > 5 ||
      !/^\d{1,78}$/.test(entry.currentQualifyingSpendRaw) ||
      !/^\d{1,78}$/.test(entry.lifetimeSpendRaw) ||
      !/^\d{1,20}$/.test(entry.lastActivityAt) ||
      !/^\d{1,78}$/.test(entry.voucherCreditRaw) ||
      (entry.legacyMembershipTokenId !== null &&
        !/^\d+$/.test(entry.legacyMembershipTokenId))
    ) {
      throw new Error(`Invalid membership migration entry at index ${index}`);
    }
    const wallet = ethers.getAddress(entry.walletAddress).toLowerCase();
    if (entry.walletAddress !== wallet || seenWallets.has(wallet)) {
      throw new Error(
        `Membership migration wallets must be unique lowercase addresses: ${entry.walletAddress}`
      );
    }
    seenWallets.add(wallet);
    if (
      BigInt(entry.lastActivityAt) > (1n << 64n) - 1n ||
      BigInt(entry.lifetimeSpendRaw) <
        BigInt(entry.currentQualifyingSpendRaw) ||
      (entry.lastActivityAt === "0" &&
        (entry.level !== 0 || entry.currentQualifyingSpendRaw !== "0"))
    ) {
      throw new Error(`Invalid membership migration state for ${wallet}`);
    }
  }
  if (
    typed.entryCount !== typed.entries.length ||
    typed.membershipEntryCount !== typed.membershipEntries.length ||
    typed.entries.reduce(
      (total, entry) => total + BigInt(entry.amountRaw),
      0n
    ) !== BigInt(typed.totalRaw)
  ) {
    throw new Error("Migration manifest declared totals do not match entries");
  }
  const calculatedRoot = `0x${sha256(canonicalSnapshot(typed))}`;
  if (calculatedRoot !== typed.snapshotRoot.toLowerCase()) {
    throw new Error("Migration manifest snapshot root is invalid");
  }
  return typed;
};

const readJson = (filename: string) =>
  JSON.parse(readFileSync(filename, "utf8")) as unknown;

const loadCheckpoint = (
  filename: string,
  chainId: bigint,
  inputFingerprint: string
): CutoverCheckpoint => {
  if (!existsSync(filename)) {
    return {
      version: 1,
      chainId: chainId.toString(),
      inputFingerprint,
      completedSteps: [],
      updatedAt: new Date().toISOString(),
    };
  }
  const value = readJson(filename) as Partial<CutoverCheckpoint>;
  if (
    value.version !== 1 ||
    value.chainId !== chainId.toString() ||
    value.inputFingerprint !== inputFingerprint ||
    !Array.isArray(value.completedSteps)
  ) {
    throw new Error(
      `Cutover checkpoint does not match this chain or input set: ${filename}`
    );
  }
  return value as CutoverCheckpoint;
};

const saveCheckpoint = (filename: string, checkpoint: CutoverCheckpoint) => {
  const directory = path.dirname(filename);
  mkdirSync(directory, { recursive: true });
  const temporary = `${filename}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify(
      { ...checkpoint, updatedAt: new Date().toISOString() },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  renameSync(temporary, filename);
};

const markCheckpoint = (
  filename: string,
  checkpoint: CutoverCheckpoint,
  step: string
) => {
  if (!checkpoint.completedSteps.includes(step)) {
    checkpoint.completedSteps.push(step);
  }
  saveCheckpoint(filename, checkpoint);
};

const supportsRead = async (contract: any, method: string) => {
  try {
    await contract[method]();
    return true;
  } catch {
    return false;
  }
};

const requireRole = async (
  contract: any,
  role: string,
  wallet: string,
  label: string
) => {
  if (!(await contract.hasRole(role, wallet))) {
    throw new Error(`Cutover signer is missing ${label}`);
  }
};

async function main() {
  const execute = process.env.EXECUTE_DATABASE_POINTS_CUTOVER === "1";
  const bundleProxy = requiredAddress("DOUDO_BUNDLE_MODULE_PROXY_ADDRESS");
  const refundProxy = requiredAddress("DOUDO_REFUND_MODULE_PROXY_ADDRESS");
  const collectionRewardProxy = requiredAddress(
    "DOUDO_COLLECTION_REWARD_MODULE_PROXY_ADDRESS"
  );
  const legacyProxy = requiredAddress("DOUDOCOIN_NFT_PROXY_ADDRESS");
  const legacyPointsAddress = requiredAddress("DOUDO_POINTS_ADDRESS");
  const legacyPointsMinters = requiredAddressList(
    "LEGACY_POINTS_MINTER_ADDRESSES"
  );
  const legacyPointsBurners = requiredAddressList(
    "LEGACY_POINTS_BURNER_ADDRESSES"
  );
  const authorizationSigner = requiredAddress(
    "POINTS_AUTHORIZATION_SIGNER_ADDRESS"
  );
  const backendOperation = requiredAddress("BACKEND_OPERATION_ADDRESS");
  const snapshotBlock = BigInt(requiredValue("LEGACY_SNAPSHOT_BLOCK"));
  const snapshotRoot = requiredValue("LEGACY_SNAPSHOT_ROOT");
  const cancelledTokenUri = requiredValue("LEGACY_CANCELLED_TOKEN_URI");
  if (!ethers.isHexString(snapshotRoot, 32)) {
    throw new Error("LEGACY_SNAPSHOT_ROOT must be a bytes32 value");
  }

  const [cutoverSigner] = await ethers.getSigners();
  if (!cutoverSigner)
    throw new Error("A configured cutover signer is required");
  const cutoverSignerAddress = await cutoverSigner.getAddress();
  const membershipAdmin = process.env.MEMBERSHIP_DEFAULT_ADMIN_ADDRESS
    ? requiredAddress("MEMBERSHIP_DEFAULT_ADMIN_ADDRESS")
    : cutoverSignerAddress;
  const pointsConfigGovernance = process.env.POINTS_CONFIG_GOVERNANCE_ADDRESS
    ? requiredAddress("POINTS_CONFIG_GOVERNANCE_ADDRESS")
    : cutoverSignerAddress;
  for (const [label, address] of [
    ["BACKEND_OPERATION_ADDRESS", backendOperation],
    ["MEMBERSHIP_DEFAULT_ADMIN_ADDRESS", membershipAdmin],
    ["POINTS_CONFIG_GOVERNANCE_ADDRESS", pointsConfigGovernance],
    ["cutover signer", cutoverSignerAddress],
  ] as const) {
    if (address.toLowerCase() === authorizationSigner.toLowerCase()) {
      throw new Error(
        `POINTS_AUTHORIZATION_SIGNER_ADDRESS must be independent from ${label}`
      );
    }
  }
  if (backendOperation.toLowerCase() === pointsConfigGovernance.toLowerCase()) {
    throw new Error(
      "BACKEND_OPERATION_ADDRESS cannot be POINTS_CONFIG_GOVERNANCE_ADDRESS"
    );
  }
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 42161n && network.chainId !== 421614n) {
    throw new Error(
      `Database-points cutover only supports Arbitrum One or Arbitrum Sepolia; got ${network.chainId}`
    );
  }
  const migrationManifestPath = path.resolve(
    requiredValue("DATABASE_POINTS_MIGRATION_MANIFEST_PATH")
  );
  const migrationManifestContents = readFileSync(migrationManifestPath, "utf8");
  const migrationManifest = parseCutoverManifest(
    JSON.parse(migrationManifestContents)
  );
  const migrationManifestSha256 = sha256(migrationManifestContents);
  if (
    migrationManifest.chainId !== network.chainId.toString() ||
    migrationManifest.snapshotBlock !== snapshotBlock.toString() ||
    migrationManifest.snapshotRoot.toLowerCase() !==
      snapshotRoot.toLowerCase() ||
    ethers.getAddress(migrationManifest.contracts.legacyPoints) !==
      legacyPointsAddress ||
    ethers.getAddress(migrationManifest.contracts.legacyNft) !== legacyProxy
  ) {
    throw new Error(
      "Database points migration manifest does not match the cutover chain inputs"
    );
  }
  const latestBlock = await ethers.provider.getBlockNumber();
  const finalizedBlock = await ethers.provider.getBlock("finalized");
  if (!finalizedBlock) {
    throw new Error(
      "RPC must support the finalized block tag; refusing to infer finality from latest"
    );
  }
  const snapshotChainBlock = await ethers.provider.getBlock(
    Number(snapshotBlock)
  );
  if (
    !snapshotChainBlock?.hash ||
    snapshotChainBlock.hash.toLowerCase() !==
      migrationManifest.snapshotBlockHash.toLowerCase()
  ) {
    throw new Error(
      "Migration manifest snapshot block hash does not match the target chain"
    );
  }
  const minimumConfirmations = optionalNonnegativeInteger(
    "LEGACY_SNAPSHOT_MIN_CONFIRMATIONS",
    20n
  );
  const snapshotConfirmations =
    snapshotBlock <= BigInt(latestBlock)
      ? BigInt(latestBlock) - snapshotBlock + 1n
      : 0n;
  if (
    snapshotBlock === 0n ||
    snapshotBlock > BigInt(finalizedBlock.number) ||
    snapshotConfirmations < minimumConfirmations
  ) {
    throw new Error(
      `LEGACY_SNAPSHOT_BLOCK must be at or below finalized block ${finalizedBlock.number} and have at least ${minimumConfirmations} confirmations`
    );
  }
  if ((await ethers.provider.getCode(authorizationSigner)) !== "0x") {
    throw new Error("POINTS_AUTHORIZATION_SIGNER_ADDRESS must be an EOA");
  }

  const inputFingerprint = sha256(
    JSON.stringify({
      chainId: network.chainId.toString(),
      bundleProxy,
      refundProxy,
      collectionRewardProxy,
      legacyProxy,
      legacyPointsAddress,
      legacyPointsMinters,
      legacyPointsBurners,
      authorizationSigner,
      backendOperation,
      membershipAdmin,
      pointsConfigGovernance,
      snapshotBlock: snapshotBlock.toString(),
      snapshotRoot: snapshotRoot.toLowerCase(),
      migrationManifestSha256,
      membershipEntryCount: migrationManifest.membershipEntryCount,
      cancelledTokenUri,
    })
  );
  const checkpointPath = execute
    ? path.resolve(requiredValue("CUTOVER_CHECKPOINT_PATH"))
    : process.env.CUTOVER_CHECKPOINT_PATH
    ? path.resolve(requiredValue("CUTOVER_CHECKPOINT_PATH"))
    : undefined;
  const checkpoint = checkpointPath
    ? loadCheckpoint(checkpointPath, network.chainId, inputFingerprint)
    : undefined;

  let migrationGate: PointsMigrationGate | undefined;
  if (execute) {
    const gatePath = path.resolve(
      requiredValue("DATABASE_POINTS_MIGRATION_GATE_PATH")
    );
    const expectedMigrationId = requiredValue("DATABASE_POINTS_MIGRATION_ID");
    const expectedManifestSha256 = requiredValue(
      "DATABASE_POINTS_MIGRATION_MANIFEST_SHA256"
    ).toLowerCase();
    const expectedEntryCount = Number(
      requiredValue("DATABASE_POINTS_MIGRATION_ENTRY_COUNT")
    );
    const expectedMembershipEntryCount = Number(
      requiredValue("DATABASE_POINTS_MIGRATION_MEMBERSHIP_ENTRY_COUNT")
    );
    const expectedTotalRaw = requiredValue(
      "DATABASE_POINTS_MIGRATION_TOTAL_RAW"
    );
    if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256)) {
      throw new Error(
        "DATABASE_POINTS_MIGRATION_MANIFEST_SHA256 must be a SHA-256 hex digest"
      );
    }
    if (
      !Number.isSafeInteger(expectedEntryCount) ||
      expectedEntryCount < 0 ||
      !Number.isSafeInteger(expectedMembershipEntryCount) ||
      expectedMembershipEntryCount < 0 ||
      !/^\d+$/.test(expectedTotalRaw)
    ) {
      throw new Error(
        "Database points migration entry counts and total raw must be non-negative integers"
      );
    }
    if (
      expectedMigrationId !== migrationManifest.migrationId ||
      expectedManifestSha256 !== migrationManifestSha256 ||
      expectedEntryCount !== migrationManifest.entryCount ||
      expectedMembershipEntryCount !== migrationManifest.membershipEntryCount ||
      expectedTotalRaw !== migrationManifest.totalRaw
    ) {
      throw new Error(
        "Approved migration environment values do not match the manifest file"
      );
    }
    migrationGate = readJson(gatePath) as PointsMigrationGate;
    if (
      migrationGate.version !== 1 ||
      migrationGate.status !== "VERIFIED" ||
      migrationGate.migrationId !== expectedMigrationId ||
      migrationGate.chainId !== network.chainId.toString() ||
      migrationGate.snapshotBlock !== snapshotBlock.toString() ||
      typeof migrationGate.snapshotRoot !== "string" ||
      migrationGate.snapshotRoot.toLowerCase() !== snapshotRoot.toLowerCase() ||
      typeof migrationGate.manifestSha256 !== "string" ||
      migrationGate.manifestSha256 !== expectedManifestSha256 ||
      !Number.isSafeInteger(migrationGate.entryCount) ||
      migrationGate.entryCount !== expectedEntryCount ||
      !Number.isSafeInteger(migrationGate.membershipEntryCount) ||
      migrationGate.membershipEntryCount !== expectedMembershipEntryCount ||
      typeof migrationGate.totalRaw !== "string" ||
      migrationGate.totalRaw !== expectedTotalRaw ||
      typeof migrationGate.verifiedAt !== "string" ||
      Number.isNaN(Date.parse(migrationGate.verifiedAt))
    ) {
      throw new Error(
        `Database points migration gate is invalid or does not match the chain snapshot: ${gatePath}`
      );
    }
  }

  const Bundle = await ethers.getContractFactory(BUNDLE_FQN);
  const Refund = await ethers.getContractFactory(REFUND_FQN);
  const CollectionReward = await ethers.getContractFactory(
    COLLECTION_REWARD_FQN
  );
  const Membership = await ethers.getContractFactory(MEMBERSHIP_FQN);
  const Legacy = await ethers.getContractFactory(LEGACY_FQN);
  const bundle: any = await ethers.getContractAt(BUNDLE_FQN, bundleProxy);
  const refund: any = await ethers.getContractAt(REFUND_FQN, refundProxy);
  const collectionReward: any = await ethers.getContractAt(
    COLLECTION_REWARD_FQN,
    collectionRewardProxy
  );
  const legacy: any = await ethers.getContractAt(LEGACY_FQN, legacyProxy);
  const legacyPoints: any = await ethers.getContractAt(
    LEGACY_POINTS_FQN,
    legacyPointsAddress
  );
  const collectionBookAddress = ethers.getAddress(
    await collectionReward.collectionBook()
  );
  if (collectionBookAddress === ethers.ZeroAddress) {
    throw new Error(
      "Collection Reward Module has no CollectionBook configured"
    );
  }
  const collectionBook = await ethers.getContractAt(
    ["function doudochainV2RewardTarget() view returns (address)"],
    collectionBookAddress
  );
  if (
    (await collectionBook.doudochainV2RewardTarget()).toLowerCase() !==
    collectionRewardProxy.toLowerCase()
  ) {
    throw new Error(
      "CollectionBook points rewards are not routed through Collection Reward Module"
    );
  }

  await requireRole(
    bundle,
    await bundle.UPGRADER_ROLE(),
    cutoverSignerAddress,
    "Bundle UPGRADER_ROLE"
  );
  await requireRole(
    bundle,
    await bundle.DEFAULT_ADMIN_ROLE(),
    cutoverSignerAddress,
    "Bundle DEFAULT_ADMIN_ROLE"
  );
  for (const [role, label] of [
    [await bundle.DEFAULT_ADMIN_ROLE(), "DEFAULT_ADMIN_ROLE"],
    [await bundle.UPGRADER_ROLE(), "UPGRADER_ROLE"],
    [await bundle.OPERATION_ROLE(), "OPERATION_ROLE"],
  ] as const) {
    if (await bundle.hasRole(role, authorizationSigner)) {
      throw new Error(
        `Points authorization signer already has Bundle ${label}`
      );
    }
  }
  await requireRole(
    refund,
    await refund.UPGRADER_ROLE(),
    cutoverSignerAddress,
    "Refund UPGRADER_ROLE"
  );
  await requireRole(
    refund,
    await refund.OPERATION_ROLE(),
    cutoverSignerAddress,
    "Refund OPERATION_ROLE"
  );
  await requireRole(
    refund,
    await refund.DEFAULT_ADMIN_ROLE(),
    cutoverSignerAddress,
    "Refund DEFAULT_ADMIN_ROLE"
  );
  await requireRole(
    collectionReward,
    await collectionReward.UPGRADER_ROLE(),
    cutoverSignerAddress,
    "Collection Reward UPGRADER_ROLE"
  );
  await requireRole(
    collectionReward,
    await collectionReward.OPERATION_ROLE(),
    cutoverSignerAddress,
    "Collection Reward OPERATION_ROLE"
  );
  await requireRole(
    collectionReward,
    await collectionReward.DEFAULT_ADMIN_ROLE(),
    cutoverSignerAddress,
    "Collection Reward DEFAULT_ADMIN_ROLE"
  );
  for (const [contract, moduleLabel] of [
    [refund, "Refund"],
    [collectionReward, "Collection Reward"],
  ] as const) {
    for (const [role, roleLabel] of [
      [await contract.DEFAULT_ADMIN_ROLE(), "DEFAULT_ADMIN_ROLE"],
      [await contract.UPGRADER_ROLE(), "UPGRADER_ROLE"],
      [await contract.OPERATION_ROLE(), "OPERATION_ROLE"],
    ] as const) {
      if (await contract.hasRole(role, authorizationSigner)) {
        throw new Error(
          `Points authorization signer already has ${moduleLabel} ${roleLabel}`
        );
      }
    }
  }
  await requireRole(
    legacy,
    await legacy.UPGRADER_ROLE(),
    cutoverSignerAddress,
    "legacy NFT UPGRADER_ROLE"
  );
  await requireRole(
    legacy,
    await legacy.DEFAULT_ADMIN_ROLE(),
    cutoverSignerAddress,
    "legacy NFT DEFAULT_ADMIN_ROLE"
  );
  await requireRole(
    legacyPoints,
    await legacyPoints.DEFAULT_ADMIN_ROLE(),
    cutoverSignerAddress,
    "legacy points DEFAULT_ADMIN_ROLE"
  );

  await upgrades.validateUpgrade(bundleProxy, Bundle, { kind: "uups" });
  await upgrades.validateUpgrade(refundProxy, Refund, { kind: "uups" });
  await upgrades.validateUpgrade(collectionRewardProxy, CollectionReward, {
    kind: "uups",
  });
  await upgrades.validateUpgrade(legacyProxy, Legacy, { kind: "uups" });
  await upgrades.validateImplementation(Membership, { kind: "uups" });

  console.log("Cutover preflight passed", {
    execute,
    chainId: network.chainId.toString(),
    bundleProxy,
    refundProxy,
    collectionRewardProxy,
    collectionBookAddress,
    legacyProxy,
    legacyPointsAddress,
    legacyPointsMinters,
    legacyPointsBurners,
    authorizationSigner,
    backendOperation,
    pointsConfigGovernance,
    membershipAdmin,
    snapshotBlock: snapshotBlock.toString(),
    snapshotRoot,
    migrationManifestPath,
    migrationManifestSha256,
    migrationId: migrationManifest.migrationId,
    migrationEntryCount: migrationManifest.entryCount,
    membershipEntryCount: migrationManifest.membershipEntryCount,
    migrationTotalRaw: migrationManifest.totalRaw,
    finalizedBlock: finalizedBlock.number,
    snapshotConfirmations: snapshotConfirmations.toString(),
    minimumConfirmations: minimumConfirmations.toString(),
    checkpointPath,
    completedCheckpointSteps: checkpoint?.completedSteps ?? [],
    migrationGate,
    cutoverSigner: cutoverSignerAddress,
  });
  if (!execute) {
    console.log(
      "Preflight only. Execution additionally requires EXECUTE_DATABASE_POINTS_CUTOVER=1 and OPERATIONS_PAUSED=1."
    );
    return;
  }
  if (process.env.OPERATIONS_PAUSED !== "1") {
    throw new Error(
      "Set OPERATIONS_PAUSED=1 only after all cutover stop gates are active"
    );
  }
  if (!checkpointPath || !checkpoint) {
    throw new Error("CUTOVER_CHECKPOINT_PATH is required for execution");
  }

  let upgradedBundle: any = bundle;
  if (!(await supportsRead(bundle, "databasePointsRefundModule"))) {
    upgradedBundle = await upgrades.upgradeProxy(bundleProxy, Bundle, {
      kind: "uups",
    });
    await upgradedBundle.waitForDeployment();
  }
  markCheckpoint(checkpointPath, checkpoint, "BUNDLE_UPGRADED");

  let upgradedRefund: any = refund;
  if (!(await supportsRead(refund, "bundleRefundAccounting"))) {
    upgradedRefund = await upgrades.upgradeProxy(refundProxy, Refund, {
      kind: "uups",
    });
    await upgradedRefund.waitForDeployment();
  }
  markCheckpoint(checkpointPath, checkpoint, "REFUND_UPGRADED");

  let upgradedCollectionReward: any = collectionReward;
  if (!(await supportsRead(collectionReward, "POINTS_CONFIG_ROLE"))) {
    upgradedCollectionReward = await upgrades.upgradeProxy(
      collectionRewardProxy,
      CollectionReward,
      { kind: "uups" }
    );
    await upgradedCollectionReward.waitForDeployment();
  }
  markCheckpoint(checkpointPath, checkpoint, "COLLECTION_REWARD_UPGRADED");

  let upgradedLegacy: any = legacy;
  if (!(await supportsRead(legacy, "legacyCollectionCancelled"))) {
    upgradedLegacy = await upgrades.upgradeProxy(legacyProxy, Legacy, {
      kind: "uups",
    });
    await upgradedLegacy.waitForDeployment();
  }
  markCheckpoint(checkpointPath, checkpoint, "LEGACY_NFT_UPGRADED");

  const configuredMembershipProxy = process.env.MEMBERSHIP_V2_PROXY_ADDRESS
    ? requiredAddress("MEMBERSHIP_V2_PROXY_ADDRESS")
    : undefined;
  if (
    configuredMembershipProxy &&
    checkpoint.membershipProxy &&
    configuredMembershipProxy.toLowerCase() !==
      checkpoint.membershipProxy.toLowerCase()
  ) {
    throw new Error(
      "MEMBERSHIP_V2_PROXY_ADDRESS does not match the saved cutover checkpoint"
    );
  }
  let membershipProxy = configuredMembershipProxy ?? checkpoint.membershipProxy;
  let membershipDeploymentReceipt: any;
  if (!membershipProxy) {
    const membership: any = await upgrades.deployProxy(
      Membership,
      [membershipAdmin, bundleProxy, bundleProxy],
      { initializer: "initialize", kind: "uups" }
    );
    await membership.waitForDeployment();
    membershipProxy = await membership.getAddress();
    membershipDeploymentReceipt = await membership
      .deploymentTransaction()
      ?.wait();
    checkpoint.membershipProxy = membershipProxy;
    saveCheckpoint(checkpointPath, checkpoint);
  }
  if (!membershipProxy) {
    throw new Error("Membership V2 proxy deployment did not return an address");
  }
  membershipProxy = ethers.getAddress(membershipProxy);
  if ((await ethers.provider.getCode(membershipProxy)) === "0x") {
    throw new Error(`Membership V2 proxy has no code: ${membershipProxy}`);
  }
  const membership: any = await ethers.getContractAt(
    MEMBERSHIP_FQN,
    membershipProxy
  );
  for (const [role, account, label] of [
    [
      await membership.DEFAULT_ADMIN_ROLE(),
      membershipAdmin,
      "DEFAULT_ADMIN_ROLE",
    ],
    [
      await membership.CONSUMPTION_RECORDER_ROLE(),
      bundleProxy,
      "CONSUMPTION_RECORDER_ROLE",
    ],
    [
      await membership.MEMBERSHIP_OPERATOR_ROLE(),
      bundleProxy,
      "MEMBERSHIP_OPERATOR_ROLE",
    ],
  ] as const) {
    if (!(await membership.hasRole(role, account))) {
      throw new Error(`Membership V2 is missing ${label} for ${account}`);
    }
  }
  markCheckpoint(checkpointPath, checkpoint, "MEMBERSHIP_V2_READY");

  const pointsConfigRole = await upgradedBundle.POINTS_CONFIG_ROLE();
  const membershipOperatorRole =
    await upgradedBundle.MEMBERSHIP_OPERATOR_ROLE();
  const bundleOperationRole = await upgradedBundle.OPERATION_ROLE();
  const refundPointsConfigRole = await upgradedRefund.POINTS_CONFIG_ROLE();
  const collectionRewardPointsConfigRole =
    await upgradedCollectionReward.POINTS_CONFIG_ROLE();
  let grantCutoverPointsConfigTxHash: string | undefined;
  let grantGovernancePointsConfigTxHash: string | undefined;
  let grantMembershipOperatorTxHash: string | undefined;
  let grantBackendOperationTxHash: string | undefined;
  let revokeCutoverPointsConfigTxHash: string | undefined;
  let grantRefundConsumptionRecorderTxHash: string | undefined;
  let configureBundleRefundModuleTxHash: string | undefined;
  const additionalPointsConfigTxHashes: string[] = [];

  if (!(await upgradedBundle.hasRole(pointsConfigRole, cutoverSignerAddress))) {
    const tx = await upgradedBundle.grantRole(
      pointsConfigRole,
      cutoverSignerAddress
    );
    grantCutoverPointsConfigTxHash = tx.hash;
    await tx.wait();
  }
  if (
    !(await upgradedBundle.hasRole(pointsConfigRole, pointsConfigGovernance))
  ) {
    const tx = await upgradedBundle.grantRole(
      pointsConfigRole,
      pointsConfigGovernance
    );
    grantGovernancePointsConfigTxHash = tx.hash;
    await tx.wait();
  }
  if (
    !(await upgradedBundle.hasRole(membershipOperatorRole, backendOperation))
  ) {
    const tx = await upgradedBundle.grantRole(
      membershipOperatorRole,
      backendOperation
    );
    grantMembershipOperatorTxHash = tx.hash;
    await tx.wait();
  }
  for (const [contract, role, label] of [
    [upgradedRefund, refundPointsConfigRole, "refund"],
    [
      upgradedCollectionReward,
      collectionRewardPointsConfigRole,
      "collection-reward",
    ],
  ] as const) {
    for (const account of [cutoverSignerAddress, pointsConfigGovernance]) {
      if (!(await contract.hasRole(role, account))) {
        const tx = await contract.grantRole(role, account);
        additionalPointsConfigTxHashes.push(`${label}:grant:${tx.hash}`);
        await tx.wait();
      }
    }
  }
  const consumptionRecorderRole = await membership.CONSUMPTION_RECORDER_ROLE();
  if (!(await membership.hasRole(consumptionRecorderRole, refundProxy))) {
    const membershipDefaultAdminRole = await membership.DEFAULT_ADMIN_ROLE();
    if (
      !(await membership.hasRole(
        membershipDefaultAdminRole,
        cutoverSignerAddress
      ))
    ) {
      throw new Error(
        "Membership admin must pre-grant CONSUMPTION_RECORDER_ROLE to the Refund proxy when the cutover signer is not Membership DEFAULT_ADMIN_ROLE"
      );
    }
    const tx = await membership.grantRole(consumptionRecorderRole, refundProxy);
    grantRefundConsumptionRecorderTxHash = tx.hash;
    await tx.wait();
  }
  const configuredRefundModule = ethers.getAddress(
    await upgradedBundle.databasePointsRefundModule()
  );
  if (configuredRefundModule === ethers.ZeroAddress) {
    const tx = await upgradedBundle.setDatabasePointsRefundModule(refundProxy);
    configureBundleRefundModuleTxHash = tx.hash;
    await tx.wait();
  } else if (configuredRefundModule !== refundProxy) {
    throw new Error(
      `Bundle is already wired to a different database-points Refund module: ${configuredRefundModule}`
    );
  }
  markCheckpoint(checkpointPath, checkpoint, "CUTOVER_ROLES_GRANTED");

  let configureTxHash: string | undefined;
  const membershipMigrationTxHashes: string[] = [];
  let grantCutoverMembershipOperatorTxHash: string | undefined;
  let revokeCutoverMembershipOperatorTxHash: string | undefined;
  if (await upgradedBundle.databasePointsModeEnabled()) {
    const configuredSigner = ethers.getAddress(
      await upgradedBundle.pointsAuthorizationSigner()
    );
    const configuredMembership = ethers.getAddress(
      await upgradedBundle.membershipV2()
    );
    if (
      configuredSigner !== authorizationSigner ||
      configuredMembership !== membershipProxy
    ) {
      throw new Error(
        "Bundle database-points mode is already enabled with different signer or Membership V2 settings"
      );
    }
  } else {
    const configureTx =
      await upgradedBundle.configureDatabasePointsAuthorization(
        authorizationSigner,
        membershipProxy,
        true
      );
    configureTxHash = configureTx.hash;
    await configureTx.wait();
  }
  markCheckpoint(checkpointPath, checkpoint, "BUNDLE_DATABASE_POINTS_ENABLED");

  const directMembershipOperatorRole =
    await membership.MEMBERSHIP_OPERATOR_ROLE();
  const membershipDefaultAdminRole = await membership.DEFAULT_ADMIN_ROLE();
  const cutoverAlreadyMembershipOperator = await membership.hasRole(
    directMembershipOperatorRole,
    cutoverSignerAddress
  );
  if (
    !cutoverAlreadyMembershipOperator &&
    migrationManifest.membershipEntries.length > 0
  ) {
    if (
      !(await membership.hasRole(
        membershipDefaultAdminRole,
        cutoverSignerAddress
      ))
    ) {
      throw new Error(
        "Membership DEFAULT_ADMIN_ROLE must pre-grant the cutover signer MEMBERSHIP_OPERATOR_ROLE for snapshot migration"
      );
    }
    const tx = await membership.grantRole(
      directMembershipOperatorRole,
      cutoverSignerAddress
    );
    grantCutoverMembershipOperatorTxHash = tx.hash;
    await tx.wait();
  }

  const membershipValidityPeriod = BigInt(
    await membership.MEMBERSHIP_VALIDITY_PERIOD()
  );
  const memberStateMatches = async (entry: MembershipMigrationEntry) => {
    const state = await membership.getMember(entry.walletAddress);
    const expectedLastActivityAt = BigInt(entry.lastActivityAt);
    const expectedExpiresAt =
      expectedLastActivityAt === 0n
        ? 0n
        : expectedLastActivityAt + membershipValidityPeriod;
    const tokenId = BigInt(state.tokenId ?? state[0]);
    return (
      (entry.level === 0 ? tokenId === 0n : tokenId !== 0n) &&
      BigInt(state.currentQualifyingSpend ?? state[1]) ===
        BigInt(entry.currentQualifyingSpendRaw) &&
      BigInt(state.lifetimeSpend ?? state[2]) ===
        BigInt(entry.lifetimeSpendRaw) &&
      BigInt(state.lastActivityAt ?? state[3]) === expectedLastActivityAt &&
      BigInt(state.expiresAt ?? state[4]) === expectedExpiresAt &&
      Number(state.level ?? state[5]) === entry.level
    );
  };
  for (const entry of migrationManifest.membershipEntries) {
    const caseId = ethers.solidityPackedKeccak256(
      ["string", "uint256", "bytes32", "address"],
      [
        "DOUDO_MEMBERSHIP_V2_CUTOVER",
        network.chainId,
        snapshotRoot,
        entry.walletAddress,
      ]
    );
    if (await membership.adminCaseUsed(caseId)) {
      if (!(await memberStateMatches(entry))) {
        throw new Error(
          `Previously migrated Membership V2 state does not match manifest: ${entry.walletAddress}`
        );
      }
      continue;
    }
    const existing = await membership.getMember(entry.walletAddress);
    if (
      BigInt(existing.tokenId ?? existing[0]) !== 0n ||
      BigInt(existing.currentQualifyingSpend ?? existing[1]) !== 0n ||
      BigInt(existing.lifetimeSpend ?? existing[2]) !== 0n ||
      BigInt(existing.lastActivityAt ?? existing[3]) !== 0n
    ) {
      throw new Error(
        `Membership V2 already contains untracked state for ${entry.walletAddress}`
      );
    }
    const tx = await membership.adminSetMembership(
      entry.walletAddress,
      entry.level,
      entry.currentQualifyingSpendRaw,
      entry.lifetimeSpendRaw,
      entry.lastActivityAt,
      caseId
    );
    membershipMigrationTxHashes.push(tx.hash);
    await tx.wait();
    if (!(await memberStateMatches(entry))) {
      throw new Error(
        `Membership V2 post-migration verification failed: ${entry.walletAddress}`
      );
    }
  }
  if (
    await membership.hasRole(directMembershipOperatorRole, cutoverSignerAddress)
  ) {
    const tx = await membership.revokeRole(
      directMembershipOperatorRole,
      cutoverSignerAddress
    );
    revokeCutoverMembershipOperatorTxHash = tx.hash;
    await tx.wait();
  }
  markCheckpoint(checkpointPath, checkpoint, "MEMBERSHIP_V2_MIGRATED");

  if (!(await upgradedBundle.hasRole(bundleOperationRole, backendOperation))) {
    const tx = await upgradedBundle.grantRole(
      bundleOperationRole,
      backendOperation
    );
    grantBackendOperationTxHash = tx.hash;
    await tx.wait();
  }
  if (
    pointsConfigGovernance.toLowerCase() !==
      cutoverSignerAddress.toLowerCase() &&
    (await upgradedBundle.hasRole(pointsConfigRole, cutoverSignerAddress))
  ) {
    const tx = await upgradedBundle.revokeRole(
      pointsConfigRole,
      cutoverSignerAddress
    );
    revokeCutoverPointsConfigTxHash = tx.hash;
    await tx.wait();
  }
  let configureRefundTxHash: string | undefined;
  if (await upgradedRefund.databasePointsModeEnabled()) {
    const [configuredBundle, configuredMembership] = await Promise.all([
      upgradedRefund.bundleRefundAccounting(),
      upgradedRefund.membershipV2(),
    ]);
    if (
      ethers.getAddress(configuredBundle) !== bundleProxy ||
      ethers.getAddress(configuredMembership) !== membershipProxy
    ) {
      throw new Error(
        "Refund database-points mode is already enabled with different accounting wiring"
      );
    }
  } else {
    const tx = await upgradedRefund.configureDatabasePointsRefundAccounting(
      bundleProxy,
      membershipProxy,
      true
    );
    configureRefundTxHash = tx.hash;
    await tx.wait();
  }
  markCheckpoint(checkpointPath, checkpoint, "REFUND_DATABASE_POINTS_ENABLED");
  let configureCollectionRewardTxHash: string | undefined;
  if (!(await upgradedCollectionReward.databasePointsModeEnabled())) {
    const tx = await upgradedCollectionReward.setDatabasePointsMode(true);
    configureCollectionRewardTxHash = tx.hash;
    await tx.wait();
  }
  markCheckpoint(
    checkpointPath,
    checkpoint,
    "COLLECTION_REWARD_DATABASE_POINTS_ENABLED"
  );
  if (
    pointsConfigGovernance.toLowerCase() !== cutoverSignerAddress.toLowerCase()
  ) {
    for (const [contract, role, label] of [
      [upgradedRefund, refundPointsConfigRole, "refund"],
      [
        upgradedCollectionReward,
        collectionRewardPointsConfigRole,
        "collection-reward",
      ],
    ] as const) {
      if (await contract.hasRole(role, cutoverSignerAddress)) {
        const tx = await contract.revokeRole(role, cutoverSignerAddress);
        additionalPointsConfigTxHashes.push(`${label}:revoke:${tx.hash}`);
        await tx.wait();
      }
    }
  }
  let cancelLegacyTxHash: string | undefined;
  if (await upgradedLegacy.legacyCollectionCancelled()) {
    const [savedBlock, savedRoot, savedTokenUri] = await Promise.all([
      upgradedLegacy.legacyCancellationSnapshotBlock(),
      upgradedLegacy.legacyCancellationSnapshotRoot(),
      upgradedLegacy.legacyCancelledTokenURI(),
    ]);
    if (
      BigInt(savedBlock) !== snapshotBlock ||
      String(savedRoot).toLowerCase() !== snapshotRoot.toLowerCase() ||
      savedTokenUri !== cancelledTokenUri
    ) {
      throw new Error(
        "Legacy collection was already cancelled with a different snapshot"
      );
    }
  } else {
    const tx = await upgradedLegacy.cancelLegacyCollection(
      snapshotBlock,
      snapshotRoot,
      cancelledTokenUri
    );
    cancelLegacyTxHash = tx.hash;
    await tx.wait();
  }
  markCheckpoint(checkpointPath, checkpoint, "LEGACY_COLLECTION_CANCELLED");
  const minterRole = await legacyPoints.MINTER_ROLE();
  const burnerRole = await legacyPoints.BURNER_ROLE();
  for (const account of legacyPointsMinters) {
    if (await legacyPoints.hasRole(minterRole, account)) {
      await (await legacyPoints.revokeRole(minterRole, account)).wait();
    }
  }
  for (const account of legacyPointsBurners) {
    if (await legacyPoints.hasRole(burnerRole, account)) {
      await (await legacyPoints.revokeRole(burnerRole, account)).wait();
    }
  }
  markCheckpoint(checkpointPath, checkpoint, "LEGACY_POINTS_ROLES_REVOKED");

  if (!(await upgradedBundle.databasePointsModeEnabled())) {
    throw new Error("Bundle database-points mode was not enabled");
  }
  if (!(await upgradedRefund.databasePointsModeEnabled())) {
    throw new Error("Refund database-points mode was not enabled");
  }
  if (!(await upgradedCollectionReward.databasePointsModeEnabled())) {
    throw new Error("Collection reward database-points mode was not enabled");
  }
  if (
    ethers.getAddress(await upgradedBundle.databasePointsRefundModule()) !==
    refundProxy
  ) {
    throw new Error("Bundle database-points Refund module wiring is incorrect");
  }
  if (
    ethers.getAddress(await upgradedRefund.bundleRefundAccounting()) !==
      bundleProxy ||
    ethers.getAddress(await upgradedRefund.membershipV2()) !== membershipProxy
  ) {
    throw new Error("Refund database-points accounting wiring is incorrect");
  }
  if (!(await membership.hasRole(consumptionRecorderRole, refundProxy))) {
    throw new Error(
      "Refund proxy is missing Membership CONSUMPTION_RECORDER_ROLE"
    );
  }
  if (
    (await upgradedBundle.pointsAuthorizationSigner()).toLowerCase() !==
    authorizationSigner.toLowerCase()
  ) {
    throw new Error("Bundle authorization signer does not match cutover input");
  }
  if (
    (await upgradedBundle.membershipV2()).toLowerCase() !==
    membershipProxy.toLowerCase()
  ) {
    throw new Error("Bundle Membership V2 wiring does not match deployment");
  }
  if (!(await upgradedBundle.hasRole(bundleOperationRole, backendOperation))) {
    throw new Error("Backend signer is missing Bundle OPERATION_ROLE");
  }
  if (
    !(await upgradedBundle.hasRole(membershipOperatorRole, backendOperation))
  ) {
    throw new Error(
      "Backend signer is missing Bundle MEMBERSHIP_OPERATOR_ROLE"
    );
  }
  if (
    !(await upgradedBundle.hasRole(pointsConfigRole, pointsConfigGovernance))
  ) {
    throw new Error("Points configuration governance role was not assigned");
  }
  for (const [contract, role, moduleLabel] of [
    [upgradedRefund, refundPointsConfigRole, "Refund"],
    [
      upgradedCollectionReward,
      collectionRewardPointsConfigRole,
      "Collection Reward",
    ],
  ] as const) {
    if (!(await contract.hasRole(role, pointsConfigGovernance))) {
      throw new Error(
        `${moduleLabel} points configuration governance role was not assigned`
      );
    }
    if (await contract.hasRole(role, backendOperation)) {
      throw new Error(
        `Backend signer must not have ${moduleLabel} POINTS_CONFIG_ROLE`
      );
    }
    if (await contract.hasRole(role, authorizationSigner)) {
      throw new Error(
        `Points authorization signer must not have ${moduleLabel} POINTS_CONFIG_ROLE`
      );
    }
  }
  for (const [role, label] of [
    [await upgradedBundle.DEFAULT_ADMIN_ROLE(), "DEFAULT_ADMIN_ROLE"],
    [await upgradedBundle.UPGRADER_ROLE(), "UPGRADER_ROLE"],
    [bundleOperationRole, "OPERATION_ROLE"],
    [pointsConfigRole, "POINTS_CONFIG_ROLE"],
    [membershipOperatorRole, "MEMBERSHIP_OPERATOR_ROLE"],
  ] as const) {
    if (await upgradedBundle.hasRole(role, authorizationSigner)) {
      throw new Error(
        `Points authorization signer must not have Bundle ${label}`
      );
    }
  }
  for (const entry of migrationManifest.membershipEntries) {
    const caseId = ethers.solidityPackedKeccak256(
      ["string", "uint256", "bytes32", "address"],
      [
        "DOUDO_MEMBERSHIP_V2_CUTOVER",
        network.chainId,
        snapshotRoot,
        entry.walletAddress,
      ]
    );
    if (
      !(await membership.adminCaseUsed(caseId)) ||
      !(await memberStateMatches(entry))
    ) {
      throw new Error(
        `Membership V2 cutover state is incomplete: ${entry.walletAddress}`
      );
    }
  }
  if (
    await membership.hasRole(directMembershipOperatorRole, cutoverSignerAddress)
  ) {
    throw new Error(
      "Cutover signer still has Membership V2 MEMBERSHIP_OPERATOR_ROLE"
    );
  }
  if (!(await upgradedLegacy.legacyCollectionCancelled())) {
    throw new Error("Legacy Voucher/Membership collection was not cancelled");
  }
  for (const account of legacyPointsMinters) {
    if (await legacyPoints.hasRole(minterRole, account)) {
      throw new Error(
        `Legacy points minter role remains active for ${account}`
      );
    }
  }
  for (const account of legacyPointsBurners) {
    if (await legacyPoints.hasRole(burnerRole, account)) {
      throw new Error(
        `Legacy points burner role remains active for ${account}`
      );
    }
  }
  markCheckpoint(checkpointPath, checkpoint, "CUTOVER_VERIFIED");

  console.log("Database-points cutover chain phase completed", {
    bundleProxy,
    bundleImplementation: await upgrades.erc1967.getImplementationAddress(
      bundleProxy
    ),
    refundProxy,
    refundImplementation: await upgrades.erc1967.getImplementationAddress(
      refundProxy
    ),
    collectionRewardProxy,
    collectionRewardImplementation:
      await upgrades.erc1967.getImplementationAddress(collectionRewardProxy),
    legacyProxy,
    legacyPointsAddress,
    revokedLegacyPointsMinters: legacyPointsMinters,
    revokedLegacyPointsBurners: legacyPointsBurners,
    legacyImplementation: await upgrades.erc1967.getImplementationAddress(
      legacyProxy
    ),
    membershipProxy,
    membershipImplementation: await upgrades.erc1967.getImplementationAddress(
      membershipProxy
    ),
    membershipStartBlock: membershipDeploymentReceipt?.blockNumber,
    backendOperation,
    pointsConfigGovernance,
    grantCutoverPointsConfigTxHash,
    grantGovernancePointsConfigTxHash,
    grantMembershipOperatorTxHash,
    grantRefundConsumptionRecorderTxHash,
    configureBundleRefundModuleTxHash,
    grantBackendOperationTxHash,
    revokeCutoverPointsConfigTxHash,
    additionalPointsConfigTxHashes,
    configureTxHash,
    grantCutoverMembershipOperatorTxHash,
    membershipMigrationTxHashes,
    revokeCutoverMembershipOperatorTxHash,
    configureRefundTxHash,
    configureCollectionRewardTxHash,
    cancelLegacyTxHash,
    checkpointPath,
    completedCheckpointSteps: checkpoint.completedSteps,
    migrationGate,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
