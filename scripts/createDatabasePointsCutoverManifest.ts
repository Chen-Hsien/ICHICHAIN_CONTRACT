import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

const DEFAULTS = {
  arbitrumSepolia: {
    chainId: 421614n,
    points: "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E",
    pointsStartBlock: 273_164_880,
    legacyNft: "0x1F1150AC2d7a8208A2743a4E74e8401Ff9F1ED53",
    legacyNftStartBlock: 290_203_262,
  },
} as const;

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const logProvider = new ethers.JsonRpcProvider(
  process.env.CUTOVER_LOG_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
  421614,
  { staticNetwork: true }
);
const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();
const MAX_LOG_RANGE = 5_000_000;
const MIN_LOG_RANGE = 1_000;
const MEMBERSHIP_VALIDITY_SECONDS = 180n * 24n * 60n * 60n;

type PointsEntry = {
  walletAddress: string;
  sourceType: "LEGACY_POINTS" | "LEGACY_VOUCHER";
  sourceId: string;
  amountRaw: string;
};

type MembershipEntry = {
  walletAddress: string;
  level: number;
  currentQualifyingSpendRaw: string;
  lifetimeSpendRaw: string;
  lastActivityAt: string;
  legacyMembershipTokenId: string | null;
  voucherCreditRaw: string;
};

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const requiredValue = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const optionalAddress = (name: string, fallback: string) => {
  const value = process.env[name]?.trim() || fallback;
  if (!ethers.isAddress(value)) throw new Error(`${name} is not an address`);
  return ethers.getAddress(value);
};

const optionalBlock = (name: string, fallback: number) => {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const block = Number(BigInt(value));
  if (!Number.isSafeInteger(block) || block < 0) {
    throw new Error(`${name} must be a safe block number`);
  }
  return block;
};

const lowerAddress = (value: string) => ethers.getAddress(value).toLowerCase();

const addressFromTopic = (topic: string) =>
  lowerAddress(`0x${topic.slice(topic.length - 40)}`);

const levelForSpend = (amount: bigint) => {
  if (amount >= 180_000n * 10n ** 18n) return 5;
  if (amount >= 90_000n * 10n ** 18n) return 4;
  if (amount >= 48_000n * 10n ** 18n) return 3;
  if (amount >= 9_000n * 10n ** 18n) return 2;
  if (amount >= 1n) return 1;
  return 0;
};

const transferParticipants = async (
  address: string,
  fromBlock: number,
  toBlock: number
) => {
  const participants = new Set<string>();
  let cursor = fromBlock;
  let range = MAX_LOG_RANGE;
  let logCount = 0;
  while (cursor <= toBlock) {
    const end = Math.min(toBlock, cursor + range - 1);
    try {
      const logs = await logProvider.getLogs({
        address,
        topics: [TRANSFER_TOPIC],
        fromBlock: cursor,
        toBlock: end,
      });
      for (const log of logs) {
        if (log.topics.length < 3) {
          throw new Error(`Malformed Transfer log: ${log.transactionHash}`);
        }
        const from = addressFromTopic(log.topics[1]);
        const to = addressFromTopic(log.topics[2]);
        if (from !== ZERO_ADDRESS) participants.add(from);
        if (to !== ZERO_ADDRESS) participants.add(to);
      }
      logCount += logs.length;
      cursor = end + 1;
      range = Math.min(MAX_LOG_RANGE, range * 2);
    } catch (error) {
      if (range <= MIN_LOG_RANGE) throw error;
      range = Math.max(MIN_LOG_RANGE, Math.floor(range / 2));
    }
  }
  return { participants, logCount };
};

const canonicalSnapshot = (input: {
  chainId: string;
  snapshotBlock: string;
  snapshotBlockHash: string;
  legacyPointsAddress: string;
  legacyNftAddress: string;
  entries: PointsEntry[];
  membershipEntries: MembershipEntry[];
}) =>
  JSON.stringify({
    version: 1,
    chainId: input.chainId,
    snapshotBlock: input.snapshotBlock,
    snapshotBlockHash: input.snapshotBlockHash.toLowerCase(),
    contracts: {
      legacyPoints: input.legacyPointsAddress.toLowerCase(),
      legacyNft: input.legacyNftAddress.toLowerCase(),
    },
    entries: input.entries,
    membershipEntries: input.membershipEntries,
  });

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== DEFAULTS.arbitrumSepolia.chainId) {
    throw new Error(
      `This manifest generator currently supports Arbitrum Sepolia only; got ${network.chainId}`
    );
  }
  const pointsAddress = optionalAddress(
    "DOUDO_POINTS_ADDRESS",
    DEFAULTS.arbitrumSepolia.points
  );
  const legacyNftAddress = optionalAddress(
    "DOUDOCOIN_NFT_PROXY_ADDRESS",
    DEFAULTS.arbitrumSepolia.legacyNft
  );
  const finalized = await ethers.provider.getBlock("finalized");
  if (!finalized) throw new Error("RPC does not support finalized block reads");
  const requestedBlock = process.env.LEGACY_SNAPSHOT_BLOCK?.trim();
  const snapshotBlock = requestedBlock
    ? Number(BigInt(requestedBlock))
    : finalized.number;
  if (
    !Number.isSafeInteger(snapshotBlock) ||
    snapshotBlock <= 0 ||
    snapshotBlock > finalized.number
  ) {
    throw new Error("LEGACY_SNAPSHOT_BLOCK must be a finalized block");
  }
  const block = await ethers.provider.getBlock(snapshotBlock);
  if (!block) throw new Error(`Snapshot block not found: ${snapshotBlock}`);
  if (!block.hash)
    throw new Error(`Snapshot block has no hash: ${snapshotBlock}`);
  const snapshotBlockHash = block.hash;
  const readOptions = { blockTag: snapshotBlock } as const;

  const points: any = await ethers.getContractAt(
    "contracts/DDOUDOCOIN.sol:DOUDOCOIN",
    pointsAddress
  );
  const legacyNft: any = await ethers.getContractAt(
    "contracts/DOUDOCOINNFT.sol:DOUDOCOINNFT",
    legacyNftAddress
  );
  const pointsStartBlock = optionalBlock(
    "DOUDO_POINTS_START_BLOCK",
    DEFAULTS.arbitrumSepolia.pointsStartBlock
  );
  const legacyNftStartBlock = optionalBlock(
    "DOUDOCOIN_NFT_START_BLOCK",
    DEFAULTS.arbitrumSepolia.legacyNftStartBlock
  );
  if (
    pointsStartBlock > snapshotBlock ||
    legacyNftStartBlock > snapshotBlock ||
    (await ethers.provider.getCode(pointsAddress)) === "0x" ||
    (await ethers.provider.getCode(legacyNftAddress)) === "0x"
  ) {
    throw new Error("Contract start blocks or snapshot bytecode are invalid");
  }
  console.log(
    JSON.stringify({
      phase: "SCAN_TRANSFERS",
      snapshotBlock,
      pointsStartBlock,
      legacyNftStartBlock,
    })
  );
  const pointsTransfers = await transferParticipants(
    pointsAddress,
    pointsStartBlock,
    snapshotBlock
  );
  const nftTransfers = await transferParticipants(
    legacyNftAddress,
    legacyNftStartBlock,
    snapshotBlock
  );
  console.log(
    JSON.stringify({
      phase: "TRANSFERS_SCANNED",
      pointsTransferLogCount: pointsTransfers.logCount,
      legacyNftTransferLogCount: nftTransfers.logCount,
      pointsParticipantCount: pointsTransfers.participants.size,
      legacyNftParticipantCount: nftTransfers.participants.size,
    })
  );

  const [decimals, pointsTotalSupply, nftTotalSupply, expirationPeriod] =
    await Promise.all([
      points.decimals(readOptions),
      points.totalSupply(readOptions),
      legacyNft.totalSupply(readOptions),
      legacyNft.membershipExpirationPeriod(readOptions),
    ]);
  if (BigInt(decimals) !== 18n) {
    throw new Error(`Legacy points decimals must be 18; got ${decimals}`);
  }
  if (BigInt(expirationPeriod) !== MEMBERSHIP_VALIDITY_SECONDS) {
    throw new Error(
      `Legacy membership validity must be 180 days; got ${expirationPeriod}`
    );
  }
  console.log(JSON.stringify({ phase: "SNAPSHOT_CONTRACT_STATE_READ" }));

  const pointsEntries: PointsEntry[] = [];
  let discoveredPointsTotal = 0n;
  for (const walletAddress of [...pointsTransfers.participants].sort()) {
    const balance = BigInt(await points.balanceOf(walletAddress, readOptions));
    if (balance === 0n) continue;
    discoveredPointsTotal += balance;
    pointsEntries.push({
      walletAddress,
      sourceType: "LEGACY_POINTS",
      sourceId: `${pointsAddress.toLowerCase()}:${walletAddress}:${snapshotBlock}`,
      amountRaw: balance.toString(),
    });
  }
  if (discoveredPointsTotal !== BigInt(pointsTotalSupply)) {
    throw new Error(
      `Legacy points holder scan mismatch: balances=${discoveredPointsTotal}, totalSupply=${pointsTotalSupply}`
    );
  }
  console.log(
    JSON.stringify({
      phase: "POINTS_RECONCILED",
      pointsHolderCount: pointsEntries.length,
    })
  );

  type VoucherSnapshot = {
    tokenId: bigint;
    owner: string;
    voucherTypeId: bigint;
    baseAmountRaw: bigint;
  };
  const voucherSnapshots: VoucherSnapshot[] = [];
  const legacyMembershipTokenByWallet = new Map<string, string>();
  const membershipCandidates = new Set(nftTransfers.participants);
  for (let index = 0n; index < BigInt(nftTotalSupply); index += 1n) {
    const tokenId = BigInt(await legacyNft.tokenByIndex(index, readOptions));
    const owner = lowerAddress(await legacyNft.ownerOf(tokenId, readOptions));
    membershipCandidates.add(owner);
    if (await legacyNft.isMembershipNFT(tokenId, readOptions)) {
      const previous = legacyMembershipTokenByWallet.get(owner);
      if (previous) {
        throw new Error(
          `Wallet owns more than one legacy membership token: ${owner} (${previous}, ${tokenId})`
        );
      }
      legacyMembershipTokenByWallet.set(owner, tokenId.toString());
      continue;
    }
    const voucherTypeId = BigInt(
      await legacyNft.voucherTypeIds(tokenId, readOptions)
    );
    const voucherType = await legacyNft.voucherTypes(
      voucherTypeId,
      readOptions
    );
    const facePoints = BigInt(voucherType.amount ?? voucherType[0]);
    if (facePoints <= 0n) {
      throw new Error(`Voucher ${tokenId} has a non-positive face value`);
    }
    voucherSnapshots.push({
      tokenId,
      owner,
      voucherTypeId,
      baseAmountRaw: facePoints * 10n ** 18n,
    });
  }
  console.log(
    JSON.stringify({
      phase: "LEGACY_NFTS_RECONCILED",
      legacyNftTotalSupply: BigInt(nftTotalSupply).toString(),
      voucherCount: voucherSnapshots.length,
      membershipCount: legacyMembershipTokenByWallet.size,
    })
  );

  const vouchersByWallet = new Map<string, VoucherSnapshot[]>();
  for (const voucher of voucherSnapshots) {
    const values = vouchersByWallet.get(voucher.owner) ?? [];
    values.push(voucher);
    vouchersByWallet.set(voucher.owner, values);
    membershipCandidates.add(voucher.owner);
  }
  for (const values of vouchersByWallet.values()) {
    values.sort((left, right) =>
      left.tokenId < right.tokenId ? -1 : left.tokenId > right.tokenId ? 1 : 0
    );
  }

  const voucherEntries: PointsEntry[] = [];
  const membershipEntries: MembershipEntry[] = [];
  for (const walletAddress of [...membershipCandidates].sort()) {
    const userInfo = await legacyNft.userInfo(walletAddress, readOptions);
    const lifetimeBefore = BigInt(userInfo.totalRedeemed ?? userInfo[0]);
    const currentBefore = BigInt(userInfo.currentRoundRedeemed ?? userInfo[1]);
    const levelBefore = Number(BigInt(userInfo.membershipLevel ?? userInfo[2]));
    const membershipTokenId = BigInt(userInfo.membershipNFT ?? userInfo[3]);
    const lastActiveBefore = BigInt(
      userInfo.lastActiveTimestamp ?? userInfo[4]
    );
    if (levelBefore < 0 || levelBefore > 5) {
      throw new Error(
        `Unsupported legacy membership level for ${walletAddress}`
      );
    }
    const activeBefore =
      lastActiveBefore !== 0n &&
      BigInt(block.timestamp) <= lastActiveBefore + MEMBERSHIP_VALIDITY_SECONDS;
    let currentAfter = activeBefore ? currentBefore : 0n;
    let lifetimeAfter = lifetimeBefore;
    let lastActiveAfter = lastActiveBefore;
    let voucherCreditRaw = 0n;
    const ownedVouchers = vouchersByWallet.get(walletAddress) ?? [];
    let rewardBasisPoints = 0n;
    if (activeBefore && levelBefore !== 0) {
      const level = await legacyNft.membershipLevels(levelBefore, readOptions);
      rewardBasisPoints = BigInt(level.rewardBasisPoints ?? level[3]);
      if (rewardBasisPoints > 10_000n) {
        throw new Error(`Invalid membership reward bps for ${walletAddress}`);
      }
    }
    for (const voucher of ownedVouchers) {
      const rewardRaw = (voucher.baseAmountRaw * rewardBasisPoints) / 10_000n;
      const amountRaw = voucher.baseAmountRaw + rewardRaw;
      voucherCreditRaw += amountRaw;
      voucherEntries.push({
        walletAddress,
        sourceType: "LEGACY_VOUCHER",
        sourceId: `${legacyNftAddress.toLowerCase()}:${
          voucher.tokenId
        }:${walletAddress}:${snapshotBlock}`,
        amountRaw: amountRaw.toString(),
      });
    }
    if (voucherCreditRaw !== 0n) {
      currentAfter += voucherCreditRaw;
      lifetimeAfter += voucherCreditRaw;
      lastActiveAfter = BigInt(block.timestamp);
    }
    const levelAfter = levelForSpend(currentAfter);
    const hasLegacyState =
      lifetimeBefore !== 0n ||
      currentBefore !== 0n ||
      levelBefore !== 0 ||
      lastActiveBefore !== 0n ||
      membershipTokenId !== 0n ||
      voucherCreditRaw !== 0n;
    if (!hasLegacyState) continue;
    if (lifetimeAfter < currentAfter) {
      throw new Error(
        `Membership lifetime is below current spend: ${walletAddress}`
      );
    }
    if (lastActiveAfter === 0n && (levelAfter !== 0 || currentAfter !== 0n)) {
      throw new Error(
        `Membership state has no activity timestamp: ${walletAddress}`
      );
    }
    const enumerableMembershipToken =
      legacyMembershipTokenByWallet.get(walletAddress) ?? null;
    if (
      membershipTokenId !== 0n &&
      enumerableMembershipToken !== membershipTokenId.toString()
    ) {
      throw new Error(
        `Legacy membership token ownership mismatch for ${walletAddress}`
      );
    }
    membershipEntries.push({
      walletAddress,
      level: levelAfter,
      currentQualifyingSpendRaw: currentAfter.toString(),
      lifetimeSpendRaw: lifetimeAfter.toString(),
      lastActivityAt: lastActiveAfter.toString(),
      legacyMembershipTokenId: enumerableMembershipToken,
      voucherCreditRaw: voucherCreditRaw.toString(),
    });
  }

  const entries = [...pointsEntries, ...voucherEntries].sort((left, right) => {
    const source = left.sourceType.localeCompare(right.sourceType);
    return source !== 0 ? source : left.sourceId.localeCompare(right.sourceId);
  });
  membershipEntries.sort((left, right) =>
    left.walletAddress.localeCompare(right.walletAddress)
  );
  const rootInput = canonicalSnapshot({
    chainId: network.chainId.toString(),
    snapshotBlock: snapshotBlock.toString(),
    snapshotBlockHash,
    legacyPointsAddress: pointsAddress,
    legacyNftAddress,
    entries,
    membershipEntries,
  });
  const snapshotRoot = `0x${sha256(rootInput)}`;
  const migrationId = `database-points-${
    network.chainId
  }-${snapshotBlock}-${snapshotRoot.slice(2, 14)}`;
  const totalRaw = entries
    .reduce((total, entry) => total + BigInt(entry.amountRaw), 0n)
    .toString();
  const manifest = {
    version: 1,
    migrationId,
    chainId: network.chainId.toString(),
    snapshotBlock: snapshotBlock.toString(),
    snapshotBlockHash: snapshotBlockHash.toLowerCase(),
    snapshotTimestamp: new Date(block.timestamp * 1000).toISOString(),
    snapshotRoot,
    contracts: {
      legacyPoints: pointsAddress.toLowerCase(),
      legacyNft: legacyNftAddress.toLowerCase(),
    },
    entries,
    membershipEntries,
    entryCount: entries.length,
    membershipEntryCount: membershipEntries.length,
    totalRaw,
    audit: {
      pointsStartBlock: pointsStartBlock.toString(),
      legacyNftStartBlock: legacyNftStartBlock.toString(),
      pointsTransferLogCount: pointsTransfers.logCount,
      legacyNftTransferLogCount: nftTransfers.logCount,
      legacyPointsTotalSupplyRaw: BigInt(pointsTotalSupply).toString(),
      legacyNftTotalSupply: BigInt(nftTotalSupply).toString(),
      outstandingVoucherCount: voucherSnapshots.length,
    },
  };
  const outputPath = path.resolve(
    requiredValue("DATABASE_POINTS_MIGRATION_MANIFEST_PATH")
  );
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const contents = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(outputPath, contents, { encoding: "utf8", mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        status: "CREATED",
        outputPath,
        manifestSha256: sha256(contents),
        migrationId,
        snapshotBlock: snapshotBlock.toString(),
        snapshotRoot,
        entryCount: entries.length,
        membershipEntryCount: membershipEntries.length,
        totalRaw,
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
