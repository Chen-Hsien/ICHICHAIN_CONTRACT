export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";

export type Erc20Transfer = {
  from: string;
  to: string;
  value: bigint;
};

export type Erc20Holder = {
  address: string;
  balance: bigint;
};

export type Erc721Transfer = {
  from: string;
  to: string;
  tokenId: bigint;
};

export type Erc721Holder = {
  address: string;
  count: number;
  tokenIds: bigint[];
};

export type Erc721Ownership = {
  ownersByToken: Map<bigint, string>;
  holders: Erc721Holder[];
};

export type TicketStatus = {
  seriesId: bigint;
  prizeId: bigint;
  exchanged: boolean;
  revealed: boolean;
};

export type RevealedUnexchangedHolder = {
  address: string;
  count: number;
  tokenIds: bigint[];
  prizeCounts: Array<{ prizeId: bigint; count: number }>;
};

export type VoucherDetail = {
  tokenId: bigint;
  isMembership: boolean;
  voucherTypeId?: bigint;
  amount?: bigint;
};

export type CoinNftMemberInfo = {
  levelIndex: bigint;
  levelName: string;
  rewardBasisPoints: bigint;
  membershipTokenId: bigint;
  totalRedeemed: bigint;
  currentRoundRedeemed: bigint;
};

export type CoinNftMigrationItemRow = {
  address: string;
  tokenId: bigint;
  nftKind: "voucher" | "membership";
  voucherTypeId?: bigint;
  voucherAmountDOUDO: string;
  estimatedBaseTWD: string;
  memberLevelIndex: bigint;
  memberLevelName: string;
  memberRewardBasisPoints: bigint;
  membershipTokenId: bigint;
};

export type CoinNftHolderTotalRow = {
  address: string;
  nftCount: number;
  voucherNftCount: number;
  membershipNftCount: number;
  tokenIds: bigint[];
  membershipTokenIds: bigint[];
  memberLevelIndex: bigint;
  memberLevelName: string;
  memberRewardBasisPoints: bigint;
  baseVoucherDOUDO: string;
  bonusDOUDO: string;
  totalRedeemableDOUDO: string;
  estimatedBaseTWD: string;
  estimatedTotalTWD: string;
};

export type CoinNftMigrationRows = {
  items: CoinNftMigrationItemRow[];
  holderTotals: CoinNftHolderTotalRow[];
};

export type SeriesDetail = {
  seriesName: string;
  priceInTWD?: bigint;
};

export type PrizeDetail = {
  prizeGroup: string;
  prizeName: string;
};

export type RevealedUnexchangedTicketRow = {
  address: string;
  tokenId: bigint;
  seriesId: bigint;
  seriesName: string;
  prizeId: bigint;
  prizeGroup: string;
  prizeName: string;
  priceInTWD?: bigint;
  isLastPrize: boolean;
};

export type PhysicalPrizeReservationRow = {
  seriesId: bigint;
  seriesName: string;
  prizeId: bigint;
  prizeGroup: string;
  prizeName: string;
  quantity: number;
  holderCount: number;
  tokenIds: bigint[];
  holders: string[];
};

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function calculateErc20Balances(transfers: Erc20Transfer[]): Erc20Holder[] {
  const balances = new Map<string, bigint>();

  for (const transfer of transfers) {
    const from = normalizeAddress(transfer.from);
    const to = normalizeAddress(transfer.to);

    if (from !== ZERO_ADDRESS) {
      balances.set(from, (balances.get(from) ?? 0n) - transfer.value);
    }

    if (to !== ZERO_ADDRESS) {
      balances.set(to, (balances.get(to) ?? 0n) + transfer.value);
    }
  }

  return Array.from(balances.entries())
    .filter(([, balance]) => balance > 0n)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([address, balance]) => ({ address, balance }));
}

export function calculateErc721Owners(transfers: Erc721Transfer[]): Erc721Ownership {
  const ownersByToken = new Map<bigint, string>();

  for (const transfer of transfers) {
    const to = normalizeAddress(transfer.to);
    if (to === ZERO_ADDRESS) {
      ownersByToken.delete(transfer.tokenId);
    } else {
      ownersByToken.set(transfer.tokenId, to);
    }
  }

  return {
    ownersByToken,
    holders: holdersFromOwnersByToken(ownersByToken),
  };
}

export function summarizeRevealedUnexchanged(
  ownersByToken: Map<bigint, string>,
  ticketStatuses: Map<bigint, TicketStatus>
): RevealedUnexchangedHolder[] {
  const tokenIdsByHolder = new Map<string, bigint[]>();
  const prizeCountsByHolder = new Map<string, Map<bigint, number>>();

  for (const [tokenId, owner] of ownersByToken.entries()) {
    const status = ticketStatuses.get(tokenId);
    if (!status?.revealed || status.exchanged) {
      continue;
    }

    const normalizedOwner = normalizeAddress(owner);
    const tokenIds = tokenIdsByHolder.get(normalizedOwner) ?? [];
    tokenIds.push(tokenId);
    tokenIdsByHolder.set(normalizedOwner, tokenIds);

    const prizeCounts = prizeCountsByHolder.get(normalizedOwner) ?? new Map<bigint, number>();
    prizeCounts.set(status.prizeId, (prizeCounts.get(status.prizeId) ?? 0) + 1);
    prizeCountsByHolder.set(normalizedOwner, prizeCounts);
  }

  return Array.from(tokenIdsByHolder.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([address, tokenIds]) => ({
      address,
      count: tokenIds.length,
      tokenIds: sortBigInts(tokenIds),
      prizeCounts: Array.from((prizeCountsByHolder.get(address) ?? new Map()).entries())
        .sort(([left], [right]) => compareBigInt(left, right))
        .map(([prizeId, count]) => ({ prizeId, count })),
    }));
}

export function buildCoinNftMigrationRows(
  ownersByToken: Map<bigint, string>,
  voucherDetails: Map<bigint, VoucherDetail>,
  memberInfoByOwner: Map<string, CoinNftMemberInfo>,
  options: { twdPerDoudocoin: string }
): CoinNftMigrationRows {
  const items = Array.from(ownersByToken.entries())
    .sort(([left], [right]) => compareBigInt(left, right))
    .map(([tokenId, owner]) => {
      const address = normalizeAddress(owner);
      const detail = voucherDetails.get(tokenId);
      const memberInfo = memberInfoByOwner.get(address) ?? defaultMemberInfo();
      const voucherAmount = detail?.isMembership ? 0n : detail?.amount ?? 0n;

      return {
        address,
        tokenId,
        nftKind: detail?.isMembership ? "membership" as const : "voucher" as const,
        voucherTypeId: detail?.isMembership ? undefined : detail?.voucherTypeId,
        voucherAmountDOUDO: voucherAmount.toString(),
        estimatedBaseTWD: multiplyDecimal(voucherAmount.toString(), options.twdPerDoudocoin),
        memberLevelIndex: memberInfo.levelIndex,
        memberLevelName: memberInfo.levelName,
        memberRewardBasisPoints: memberInfo.rewardBasisPoints,
        membershipTokenId: memberInfo.membershipTokenId,
      };
    });

  const rowsByHolder = new Map<string, CoinNftMigrationItemRow[]>();
  for (const item of items) {
    const holderRows = rowsByHolder.get(item.address) ?? [];
    holderRows.push(item);
    rowsByHolder.set(item.address, holderRows);
  }

  const holderTotals = Array.from(rowsByHolder.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([address, holderItems]) => {
      const memberInfo = memberInfoByOwner.get(address) ?? defaultMemberInfo();
      const baseVoucherDOUDO = holderItems.reduce((total, item) => total + BigInt(item.voucherAmountDOUDO), 0n);
      const bonusDOUDO = (baseVoucherDOUDO * memberInfo.rewardBasisPoints) / 10_000n;
      const totalRedeemableDOUDO = baseVoucherDOUDO + bonusDOUDO;
      const membershipTokenIds = holderItems
        .filter((item) => item.nftKind === "membership")
        .map((item) => item.tokenId);

      return {
        address,
        nftCount: holderItems.length,
        voucherNftCount: holderItems.filter((item) => item.nftKind === "voucher").length,
        membershipNftCount: membershipTokenIds.length,
        tokenIds: holderItems.map((item) => item.tokenId).sort(compareBigInt),
        membershipTokenIds: membershipTokenIds.sort(compareBigInt),
        memberLevelIndex: memberInfo.levelIndex,
        memberLevelName: memberInfo.levelName,
        memberRewardBasisPoints: memberInfo.rewardBasisPoints,
        baseVoucherDOUDO: baseVoucherDOUDO.toString(),
        bonusDOUDO: bonusDOUDO.toString(),
        totalRedeemableDOUDO: totalRedeemableDOUDO.toString(),
        estimatedBaseTWD: multiplyDecimal(baseVoucherDOUDO.toString(), options.twdPerDoudocoin),
        estimatedTotalTWD: multiplyDecimal(totalRedeemableDOUDO.toString(), options.twdPerDoudocoin),
      };
    });

  return { items, holderTotals };
}

export function buildRevealedUnexchangedTicketRows(
  ownersByToken: Map<bigint, string>,
  ticketStatuses: Map<bigint, TicketStatus>,
  seriesDetails: Map<bigint, SeriesDetail>,
  prizeDetails: Map<string, PrizeDetail>,
  options: { excludedOwners?: string[] } = {}
): RevealedUnexchangedTicketRow[] {
  const excludedOwners = new Set((options.excludedOwners ?? []).map(normalizeAddress));

  return Array.from(ownersByToken.entries())
    .sort(([left], [right]) => compareBigInt(left, right))
    .flatMap(([tokenId, owner]) => {
      const address = normalizeAddress(owner);
      const status = ticketStatuses.get(tokenId);
      if (!status?.revealed || status.exchanged || excludedOwners.has(address)) {
        return [];
      }

      const series = seriesDetails.get(status.seriesId);
      const prize = status.prizeId === 999n
        ? { prizeGroup: "LAST", prizeName: "Last Prize" }
        : prizeDetails.get(seriesPrizeKey(status.seriesId, status.prizeId)) ?? {
            prizeGroup: "",
            prizeName: "",
          };

      return [{
        address,
        tokenId,
        seriesId: status.seriesId,
        seriesName: series?.seriesName ?? "",
        prizeId: status.prizeId,
        prizeGroup: prize.prizeGroup,
        prizeName: prize.prizeName,
        priceInTWD: series?.priceInTWD,
        isLastPrize: status.prizeId === 999n,
      }];
    });
}

export function summarizePhysicalPrizeReservations(
  rows: RevealedUnexchangedTicketRow[]
): PhysicalPrizeReservationRow[] {
  const grouped = new Map<string, RevealedUnexchangedTicketRow[]>();

  for (const row of rows) {
    const key = seriesPrizeKey(row.seriesId, row.prizeId);
    const groupRows = grouped.get(key) ?? [];
    groupRows.push(row);
    grouped.set(key, groupRows);
  }

  return Array.from(grouped.values())
    .sort((left, right) => compareBigInt(left[0].seriesId, right[0].seriesId) || compareBigInt(left[0].prizeId, right[0].prizeId))
    .map((groupRows) => {
      const first = groupRows[0];
      const holders = Array.from(new Set(groupRows.map((row) => row.address))).sort();
      return {
        seriesId: first.seriesId,
        seriesName: first.seriesName,
        prizeId: first.prizeId,
        prizeGroup: first.prizeGroup,
        prizeName: first.prizeName,
        quantity: groupRows.length,
        holderCount: holders.length,
        tokenIds: groupRows.map((row) => row.tokenId).sort(compareBigInt),
        holders,
      };
    });
}

function holdersFromOwnersByToken(ownersByToken: Map<bigint, string>): Erc721Holder[] {
  const tokensByHolder = new Map<string, bigint[]>();

  for (const [tokenId, owner] of ownersByToken.entries()) {
    const normalizedOwner = normalizeAddress(owner);
    const tokenIds = tokensByHolder.get(normalizedOwner) ?? [];
    tokenIds.push(tokenId);
    tokensByHolder.set(normalizedOwner, tokenIds);
  }

  return Array.from(tokensByHolder.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([address, tokenIds]) => ({
      address,
      count: tokenIds.length,
      tokenIds: sortBigInts(tokenIds),
    }));
}

function sortBigInts(values: bigint[]): bigint[] {
  return [...values].sort(compareBigInt);
}

function compareBigInt(left: bigint, right: bigint): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function defaultMemberInfo(): CoinNftMemberInfo {
  return {
    levelIndex: 0n,
    levelName: "NonMembership",
    rewardBasisPoints: 0n,
    membershipTokenId: 0n,
    totalRedeemed: 0n,
    currentRoundRedeemed: 0n,
  };
}

function seriesPrizeKey(seriesId: bigint, prizeId: bigint): string {
  return `${seriesId.toString()}:${prizeId.toString()}`;
}

function multiplyDecimal(integerValue: string, decimalMultiplier: string): string {
  const [whole = "0", fraction = ""] = decimalMultiplier.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const multiplier = BigInt(`${whole}${fraction}` || "0");
  const scaled = BigInt(integerValue) * multiplier;
  const integerPart = scaled / scale;
  const fractionalPart = scaled % scale;

  if (fraction.length === 0 || fractionalPart === 0n) {
    return integerPart.toString();
  }

  return `${integerPart.toString()}.${fractionalPart.toString().padStart(fraction.length, "0").replace(/0+$/, "")}`;
}
