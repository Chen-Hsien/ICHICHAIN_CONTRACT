import { ethers } from "hardhat";

const DEFAULTS = {
  points: "0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E",
  legacyNft: "0x1F1150AC2d7a8208A2743a4E74e8401Ff9F1ED53",
} as const;

const requiredAddress = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${name} must be a valid address`);
  }
  return ethers.getAddress(value);
};

const optionalAddress = (name: string, fallback: string) => {
  const value = process.env[name]?.trim() || fallback;
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} must be a valid address`);
  }
  return ethers.getAddress(value);
};

const decimal = (value: bigint) => value.toString();

async function main() {
  const wallet = requiredAddress("CUTOVER_CHECK_WALLET");
  const pointsAddress = optionalAddress(
    "DOUDO_POINTS_ADDRESS",
    DEFAULTS.points
  );
  const legacyNftAddress = optionalAddress(
    "DOUDOCOIN_NFT_PROXY_ADDRESS",
    DEFAULTS.legacyNft
  );
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 421614n && network.chainId !== 42161n) {
    throw new Error(`Unsupported cutover chain: ${network.chainId}`);
  }

  const requestedBlock = process.env.LEGACY_SNAPSHOT_BLOCK?.trim();
  const finalized = await ethers.provider.getBlock("finalized");
  if (!finalized) throw new Error("RPC does not support finalized block reads");
  const blockNumber = requestedBlock
    ? Number(BigInt(requestedBlock))
    : finalized.number;
  if (!Number.isSafeInteger(blockNumber) || blockNumber > finalized.number) {
    throw new Error("Snapshot block must be a safe finalized block number");
  }
  const block = await ethers.provider.getBlock(blockNumber);
  if (!block) throw new Error(`Snapshot block not found: ${blockNumber}`);
  const readOptions = { blockTag: blockNumber } as const;

  const points: any = await ethers.getContractAt(
    "contracts/DDOUDOCOIN.sol:DOUDOCOIN",
    pointsAddress
  );
  const legacyNft: any = await ethers.getContractAt(
    "contracts/DOUDOCOINNFT.sol:DOUDOCOINNFT",
    legacyNftAddress
  );
  const [decimals, pointsBalance, ownedCount, userInfo, expirationPeriod] =
    await Promise.all([
      points.decimals(readOptions),
      points.balanceOf(wallet, readOptions),
      legacyNft.balanceOf(wallet, readOptions),
      legacyNft.userInfo(wallet, readOptions),
      legacyNft.membershipExpirationPeriod(readOptions),
    ]);

  const unit = 10n ** BigInt(decimals);
  const membershipLevel = BigInt(userInfo.membershipLevel ?? userInfo[2]);
  const lastActiveTimestamp = BigInt(
    userInfo.lastActiveTimestamp ?? userInfo[4]
  );
  const membershipActive =
    lastActiveTimestamp !== 0n &&
    BigInt(block.timestamp) <= lastActiveTimestamp + BigInt(expirationPeriod);
  let rewardBasisPoints = 0n;
  if (membershipActive && membershipLevel !== 0n) {
    const level = await legacyNft.membershipLevels(
      membershipLevel,
      readOptions
    );
    rewardBasisPoints = BigInt(level.rewardBasisPoints ?? level[3]);
  }

  const assets: Array<Record<string, unknown>> = [];
  let voucherTotalRaw = 0n;
  for (let index = 0n; index < ownedCount; index += 1n) {
    const tokenId: bigint = await legacyNft.tokenOfOwnerByIndex(
      wallet,
      index,
      readOptions
    );
    const membership: boolean = await legacyNft.isMembershipNFT(
      tokenId,
      readOptions
    );
    if (membership) {
      assets.push({ tokenId: decimal(tokenId), assetType: "MEMBERSHIP" });
      continue;
    }
    const voucherTypeId: bigint = await legacyNft.voucherTypeIds(
      tokenId,
      readOptions
    );
    const voucherType = await legacyNft.voucherTypes(
      voucherTypeId,
      readOptions
    );
    const facePoints = BigInt(voucherType.amount ?? voucherType[0]);
    const baseAmountRaw = facePoints * unit;
    const membershipRewardRaw = (baseAmountRaw * rewardBasisPoints) / 10_000n;
    const amountRaw = baseAmountRaw + membershipRewardRaw;
    voucherTotalRaw += amountRaw;
    assets.push({
      tokenId: decimal(tokenId),
      assetType: "VOUCHER",
      voucherTypeId: decimal(voucherTypeId),
      facePoints: decimal(facePoints),
      baseAmountRaw: decimal(baseAmountRaw),
      membershipRewardRaw: decimal(membershipRewardRaw),
      amountRaw: decimal(amountRaw),
      tokenUri: String(voucherType.tokenURI ?? voucherType[2]),
    });
  }

  const inspectedTokenIds = (process.env.CUTOVER_CHECK_TOKEN_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const inspectedTokens: Array<Record<string, unknown>> = [];
  for (const rawTokenId of inspectedTokenIds) {
    if (!/^\d+$/.test(rawTokenId)) {
      throw new Error("CUTOVER_CHECK_TOKEN_IDS must contain uint256 values");
    }
    const tokenId = BigInt(rawTokenId);
    try {
      const [owner, membership, voucherTypeId] = await Promise.all([
        legacyNft.ownerOf(tokenId, readOptions),
        legacyNft.isMembershipNFT(tokenId, readOptions),
        legacyNft.voucherTypeIds(tokenId, readOptions),
      ]);
      inspectedTokens.push({
        tokenId: rawTokenId,
        exists: true,
        owner,
        assetType: membership ? "MEMBERSHIP" : "VOUCHER",
        voucherTypeId: decimal(voucherTypeId),
      });
    } catch {
      inspectedTokens.push({ tokenId: rawTokenId, exists: false });
    }
  }

  const snapshot = {
    version: 1,
    chainId: network.chainId.toString(),
    blockNumber: String(blockNumber),
    blockHash: block.hash,
    blockTimestamp: new Date(block.timestamp * 1000).toISOString(),
    finalizedBlock: String(finalized.number),
    wallet,
    contracts: {
      legacyPoints: pointsAddress,
      legacyNft: legacyNftAddress,
    },
    legacyPoints: {
      decimals: Number(decimals),
      balanceRaw: decimal(pointsBalance),
      balanceFormatted: ethers.formatUnits(pointsBalance, decimals),
    },
    legacyNft: {
      ownedCount: decimal(ownedCount),
      voucherTotalRaw: decimal(voucherTotalRaw),
      voucherRewardBasisPoints: decimal(rewardBasisPoints),
      membershipActiveAtSnapshot: membershipActive,
      userInfo: {
        totalRedeemedRaw: decimal(
          BigInt(userInfo.totalRedeemed ?? userInfo[0])
        ),
        currentRoundRedeemedRaw: decimal(
          BigInt(userInfo.currentRoundRedeemed ?? userInfo[1])
        ),
        membershipLevel: decimal(membershipLevel),
        membershipTokenId: decimal(
          BigInt(userInfo.membershipNFT ?? userInfo[3])
        ),
        lastActiveTimestamp: decimal(lastActiveTimestamp),
      },
      assets,
      inspectedTokens,
    },
  };

  console.log(JSON.stringify(snapshot, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
