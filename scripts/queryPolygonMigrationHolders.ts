import "dotenv/config";
import fs from "fs";
import path from "path";
import { Contract, JsonRpcProvider, Log, ethers } from "ethers";
import {
  CoinNftMemberInfo,
  DEAD_ADDRESS,
  SeriesDetail,
  TicketStatus,
  VoucherDetail,
  buildCoinNftMigrationRows,
  buildRevealedUnexchangedTicketRows,
  calculateErc20Balances,
  calculateErc721Owners,
  summarizePhysicalPrizeReservations,
  summarizeRevealedUnexchanged,
} from "./migrationReportLogic";

const DEFAULT_RPC_URLS = [
  "https://gateway.tenderly.co/public/polygon",
  "https://rpc-mainnet.matic.quiknode.pro",
];

const DEFAULTS = {
  coin: {
    address: "0xc156b5a299FBf556d5652F7FddeBAb27815F1342",
    fromBlock: 64_961_151,
  },
  coinNft: {
    address: "0x25B983DD08C9F534D3cda1289DD2B0047732c06B",
    fromBlock: 64_961_334,
  },
  doudochain: {
    address: "0x8386b1f2cd830907e5b4adc30ea45515b17b80b4",
    fromBlock: 59_036_305,
  },
};

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

const ERC721_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

const DOUDOCOIN_NFT_ABI = [
  ...ERC721_ABI,
  "function voucherTypeIds(uint256 tokenId) view returns (uint256)",
  "function isMembershipNFT(uint256 tokenId) view returns (bool)",
  "function voucherTypes(uint256 voucherTypeId) view returns (uint256 amount,uint256 maxPerUser,string tokenURI)",
  "function userInfo(address user) view returns (uint256 totalRedeemed,uint256 currentRoundRedeemed,uint256 membershipLevel,uint256 membershipNFT,uint256 lastActiveTimestamp)",
  "function membershipLevels(uint256 levelIndex) view returns (string name,uint256 threshold,string membershipTokenURI,uint256 rewardBasisPoints)",
];

const DOUDOCHAIN_ABI = [
  ...ERC721_ABI,
  "function getSeriesTotalLength() view returns (uint256)",
  "function ICHISeries(uint256 seriesID) view returns (string seriesName,uint256 totalTicketNumbers,uint256 remainingTicketNumbers,uint256 priceInUSDTWei,bool isGoodsArrived,uint256 estimateDeliverTime,uint256 exchangeExpireTime,string exchangeTokenURI,string unrevealTokenURI,string revealTokenURI,string seriesMetaDataURI,uint256 priceInTWD,bool isRefund,bool isPreOrder)",
  "function getSubPrizesDetail(uint256 seriesID) view returns (tuple(uint256 subPrizeID,string prizeGroup,string subPrizeName,uint256 subPrizeRemainingQuantity)[])",
  "function ticketStatusDetail(uint256 tokenId) view returns (uint256 seriesID,uint256 tokenRevealedPrize,bool tokenExchange,bool tokenRevealed)",
];

async function main() {
  const rpcUrls = rpcCandidates();
  const { provider, rpcUrl } = await createProvider(rpcUrls);
  const latestBlock = parseOptionalInt(process.env.TO_BLOCK) ?? (await provider.getBlockNumber());
  const chunkSize = parseOptionalInt(process.env.LOG_CHUNK_SIZE) ?? 1_000_000;
  const minChunkSize = parseOptionalInt(process.env.LOG_MIN_CHUNK_SIZE) ?? 5_000;
  const twdPerDoudocoin = process.env.VOUCHER_TWD_PER_DOUDO ?? "0.6";

  const coinAddress = envAddress("COIN_ADDRESS", DEFAULTS.coin.address);
  const coinNftAddress = envAddress("COIN_NFT_ADDRESS", DEFAULTS.coinNft.address);
  const doudochainAddress = envAddress("DOUDOCHAIN_ADDRESS", DEFAULTS.doudochain.address);

  const coinFromBlock = parseOptionalInt(process.env.COIN_FROM_BLOCK) ?? DEFAULTS.coin.fromBlock;
  const coinNftFromBlock =
    parseOptionalInt(process.env.COIN_NFT_FROM_BLOCK) ?? DEFAULTS.coinNft.fromBlock;
  const doudochainFromBlock =
    parseOptionalInt(process.env.DOUDOCHAIN_FROM_BLOCK) ?? DEFAULTS.doudochain.fromBlock;

  console.log(`Polygon RPC: ${rpcUrl}`);
  console.log(`Block range ends at: ${latestBlock}`);

  const coin = new Contract(coinAddress, ERC20_ABI, provider);
  const coinInfo = await readErc20Info(coin);
  console.log(`\n[coin] ${coinInfo.name} (${coinInfo.symbol}) ${coinAddress}`);
  const coinLogs = await fetchTransferLogs(
    provider,
    coinAddress,
    coinFromBlock,
    latestBlock,
    chunkSize,
    minChunkSize
  );
  const coinHolders = calculateErc20Balances(parseErc20Transfers(coinLogs));
  const coinSupplyFromLogs = coinHolders.reduce((total, holder) => total + holder.balance, 0n);
  const coinWarnings: string[] = [];
  if (coinSupplyFromLogs !== coinInfo.totalSupply) {
    coinWarnings.push(
      `ERC20 Transfer-derived supply ${coinSupplyFromLogs.toString()} != on-chain totalSupply ${coinInfo.totalSupply.toString()}`
    );
  }

  const coinNft = new Contract(coinNftAddress, DOUDOCOIN_NFT_ABI, provider);
  const coinNftInfo = await readErc721Info(coinNft);
  console.log(`\n[coinNFT] ${coinNftInfo.name} (${coinNftInfo.symbol}) ${coinNftAddress}`);
  const coinNftLogs = await fetchTransferLogs(
    provider,
    coinNftAddress,
    coinNftFromBlock,
    latestBlock,
    chunkSize,
    minChunkSize
  );
  const coinNftOwnership = calculateErc721Owners(parseErc721Transfers(coinNftLogs));
  const coinNftWarnings = compareNftSupply("coinNFT", coinNftOwnership.ownersByToken.size, coinNftInfo.totalSupply);
  const voucherDetails = await readVoucherDetails(coinNft, Array.from(coinNftOwnership.ownersByToken.keys()));
  const coinNftMemberInfos = await readCoinNftMemberInfos(
    coinNft,
    Array.from(new Set(coinNftOwnership.holders.map((holder) => holder.address)))
  );
  const coinNftMigrationRows = buildCoinNftMigrationRows(
    coinNftOwnership.ownersByToken,
    voucherDetails,
    coinNftMemberInfos,
    { twdPerDoudocoin }
  );

  const doudochain = new Contract(doudochainAddress, DOUDOCHAIN_ABI, provider);
  const doudochainInfo = await readDoudochainInfo(doudochain);
  console.log(`\n[DOUDOCHAIN] ${doudochainInfo.name} (${doudochainInfo.symbol}) ${doudochainAddress}`);
  const doudochainLogs = await fetchTransferLogs(
    provider,
    doudochainAddress,
    doudochainFromBlock,
    latestBlock,
    chunkSize,
    minChunkSize
  );
  const doudochainOwnership = calculateErc721Owners(parseErc721Transfers(doudochainLogs));
  const doudochainWarnings = compareNftSupply(
    "DOUDOCHAIN",
    doudochainOwnership.ownersByToken.size,
    doudochainInfo.totalSupply
  );
  const ticketStatuses = await readTicketStatuses(
    doudochain,
    Array.from(doudochainOwnership.ownersByToken.keys())
  );
  const revealedUnexchangedIncludingDead = summarizeRevealedUnexchanged(
    doudochainOwnership.ownersByToken,
    ticketStatuses
  );
  const revealedStatusEntries = Array.from(ticketStatuses.values()).filter(
    (status) => status.revealed && !status.exchanged
  );
  const seriesDetails = await readSeriesDetails(
    doudochain,
    uniqueBigints(revealedStatusEntries.map((status) => status.seriesId))
  );
  const prizeDetails = await readPrizeDetails(doudochain, uniqueBigints(revealedStatusEntries.map((status) => status.seriesId)));
  const revealedUnexchangedItems = buildRevealedUnexchangedTicketRows(
    doudochainOwnership.ownersByToken,
    ticketStatuses,
    seriesDetails,
    prizeDetails,
    { excludedOwners: [DEAD_ADDRESS] }
  );
  const physicalPrizeReservations = summarizePhysicalPrizeReservations(revealedUnexchangedItems);
  const revealedUnexchangedHolders = summarizeRevealedUnexchanged(
    new Map(revealedUnexchangedItems.map((row) => [row.tokenId, row.address])),
    new Map(
      revealedUnexchangedItems.map((row) => [
        row.tokenId,
        {
          seriesId: row.seriesId,
          prizeId: row.prizeId,
          exchanged: false,
          revealed: true,
        },
      ])
    )
  );

  const reportDir = makeReportDir();
  writeCsv(
    path.join(reportDir, "coin-holders.csv"),
    ["address", "balanceRaw", "balance"],
    coinHolders.map((holder) => [
      holder.address,
      holder.balance.toString(),
      ethers.formatUnits(holder.balance, coinInfo.decimals),
    ])
  );
  writeCsv(
    path.join(reportDir, "coinnft-holders.csv"),
    [
      "address",
      "nftCount",
      "voucherNftCount",
      "membershipNftCount",
      "tokenIds",
      "membershipTokenIds",
      "memberLevelIndex",
      "memberLevelName",
      "memberRewardBasisPoints",
      "baseVoucherDOUDO",
      "bonusDOUDO",
      "totalRedeemableDOUDO",
      "estimatedBaseTWD",
      "estimatedTotalTWD",
    ],
    coinNftMigrationRows.holderTotals.map((holder) => [
      holder.address,
      holder.nftCount.toString(),
      holder.voucherNftCount.toString(),
      holder.membershipNftCount.toString(),
      holder.tokenIds.map((id) => id.toString()).join("|"),
      holder.membershipTokenIds.map((id) => id.toString()).join("|"),
      holder.memberLevelIndex.toString(),
      holder.memberLevelName,
      holder.memberRewardBasisPoints.toString(),
      holder.baseVoucherDOUDO,
      holder.bonusDOUDO,
      holder.totalRedeemableDOUDO,
      holder.estimatedBaseTWD,
      holder.estimatedTotalTWD,
    ])
  );
  writeCsv(
    path.join(reportDir, "coinnft-nft-items.csv"),
    [
      "address",
      "tokenId",
      "nftKind",
      "voucherTypeId",
      "voucherAmountDOUDO",
      "estimatedBaseTWD",
      "memberLevelIndex",
      "memberLevelName",
      "memberRewardBasisPoints",
      "membershipTokenId",
    ],
    coinNftMigrationRows.items.map((item) => [
      item.address,
      item.tokenId.toString(),
      item.nftKind,
      item.voucherTypeId?.toString() ?? "",
      item.voucherAmountDOUDO,
      item.estimatedBaseTWD,
      item.memberLevelIndex.toString(),
      item.memberLevelName,
      item.memberRewardBasisPoints.toString(),
      item.membershipTokenId.toString(),
    ])
  );
  writeCsv(
    path.join(reportDir, "doudocoin-revealed-unexchanged.csv"),
    [
      "address",
      "tokenId",
      "seriesId",
      "seriesName",
      "prizeId",
      "prizeGroup",
      "prizeName",
      "priceInTWD",
      "isLastPrize",
    ],
    revealedUnexchangedItems.map((item) => [
      item.address,
      item.tokenId.toString(),
      item.seriesId.toString(),
      item.seriesName,
      item.prizeId.toString(),
      item.prizeGroup,
      item.prizeName,
      item.priceInTWD?.toString() ?? "",
      item.isLastPrize ? "true" : "false",
    ])
  );
  writeCsv(
    path.join(reportDir, "doudocoin-revealed-unexchanged-holders.csv"),
    ["address", "nftCount", "tokenIds", "prizeCounts"],
    revealedUnexchangedHolders.map((holder) => [
      holder.address,
      holder.count.toString(),
      holder.tokenIds.map((id) => id.toString()).join("|"),
      holder.prizeCounts.map((entry) => `${entry.prizeId.toString()}:${entry.count}`).join("|"),
    ])
  );
  writeCsv(
    path.join(reportDir, "doudocoin-physical-prize-reservations.csv"),
    ["seriesId", "seriesName", "prizeId", "prizeGroup", "prizeName", "quantity", "holderCount", "tokenIds", "holders"],
    physicalPrizeReservations.map((row) => [
      row.seriesId.toString(),
      row.seriesName,
      row.prizeId.toString(),
      row.prizeGroup,
      row.prizeName,
      row.quantity.toString(),
      row.holderCount.toString(),
      row.tokenIds.map((id) => id.toString()).join("|"),
      row.holders.join("|"),
    ])
  );

  const report = {
    generatedAt: new Date().toISOString(),
    rpcUrl,
    latestBlock,
    contracts: {
      coin: { address: coinAddress, fromBlock: coinFromBlock, ...coinInfo },
      coinNft: { address: coinNftAddress, fromBlock: coinNftFromBlock, ...coinNftInfo },
      doudochain: { address: doudochainAddress, fromBlock: doudochainFromBlock, ...doudochainInfo },
    },
    config: {
      twdPerDoudocoin,
      excludedDoudocoinOwners: [DEAD_ADDRESS],
    },
    warnings: [...coinWarnings, ...coinNftWarnings, ...doudochainWarnings],
    coinHolders,
    coinNftHolderTotals: coinNftMigrationRows.holderTotals,
    coinNftItems: coinNftMigrationRows.items,
    doudocoinRevealedUnexchangedIncludingDead: revealedUnexchangedIncludingDead,
    doudocoinRevealedUnexchangedHolders: revealedUnexchangedHolders,
    doudocoinRevealedUnexchangedItems: revealedUnexchangedItems,
    doudocoinPhysicalPrizeReservations: physicalPrizeReservations,
  };
  fs.writeFileSync(path.join(reportDir, "migration-report.json"), `${JSON.stringify(report, jsonReplacer, 2)}\n`);

  console.log("\nSummary");
  console.log(`- coin holders: ${coinHolders.length}`);
  console.log(`- coin totalSupply: ${ethers.formatUnits(coinInfo.totalSupply, coinInfo.decimals)} ${coinInfo.symbol}`);
  console.log(`- coinNFT holders: ${coinNftMigrationRows.holderTotals.length}, NFTs: ${coinNftOwnership.ownersByToken.size}`);
  console.log(
    `- DOUDOCHAIN revealed and unexchanged holders excluding dead: ${revealedUnexchangedHolders.length}, NFTs: ${revealedUnexchangedItems.length}`
  );
  console.log(
    `- DOUDOCHAIN revealed and unexchanged including dead: ${revealedUnexchangedIncludingDead.length}, NFTs: ${revealedUnexchangedIncludingDead.reduce(
      (total, holder) => total + holder.count,
      0
    )}`
  );
  for (const warning of report.warnings) {
    console.warn(`WARNING: ${warning}`);
  }
  console.log(`\nReport written to: ${reportDir}`);
}

async function createProvider(urls: string[]) {
  for (const url of urls) {
    const provider = new JsonRpcProvider(url, 137, { staticNetwork: true });
    try {
      await withTimeout(provider.getBlockNumber(), 15_000, `connect ${url}`);
      return { provider, rpcUrl: url };
    } catch (error) {
      console.warn(`Skipping RPC ${url}: ${errorMessage(error)}`);
      provider.destroy();
    }
  }
  throw new Error("No usable Polygon RPC. Set POLYGON_RPC_URL to an archive-capable RPC endpoint.");
}

async function fetchTransferLogs(
  provider: JsonRpcProvider,
  address: string,
  fromBlock: number,
  toBlock: number,
  initialChunkSize: number,
  minChunkSize: number
): Promise<Log[]> {
  const logs: Log[] = [];
  let current = fromBlock;
  let chunkSize = initialChunkSize;

  while (current <= toBlock) {
    const end = Math.min(current + chunkSize - 1, toBlock);
    try {
      const chunkLogs = await withTimeout(
        provider.getLogs({
          address,
          fromBlock: current,
          toBlock: end,
          topics: [TRANSFER_TOPIC],
        }),
        45_000,
        `getLogs ${address} ${current}-${end}`
      );
      logs.push(...chunkLogs);
      console.log(`  logs ${current}-${end}: ${chunkLogs.length}`);
      current = end + 1;
    } catch (error) {
      if (chunkSize <= minChunkSize) {
        throw new Error(
          `Failed fetching logs for ${address} at ${current}-${end}: ${errorMessage(error)}. Try a better POLYGON_RPC_URL or smaller LOG_MIN_CHUNK_SIZE.`
        );
      }
      chunkSize = Math.max(minChunkSize, Math.floor(chunkSize / 2));
      console.warn(`  reducing log chunk to ${chunkSize}: ${errorMessage(error)}`);
    }
  }

  return logs;
}

function parseErc20Transfers(logs: Log[]) {
  return logs
    .filter((log) => log.topics.length >= 3)
    .map((log) => ({
      from: addressFromTopic(log.topics[1]),
      to: addressFromTopic(log.topics[2]),
      value: BigInt(log.data),
    }));
}

function parseErc721Transfers(logs: Log[]) {
  return logs
    .filter((log) => log.topics.length >= 4)
    .map((log) => ({
      from: addressFromTopic(log.topics[1]),
      to: addressFromTopic(log.topics[2]),
      tokenId: BigInt(log.topics[3]),
    }));
}

async function readErc20Info(contract: Contract) {
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    callView(() => contract.name(), "erc20.name"),
    callView(() => contract.symbol(), "erc20.symbol"),
    callView(() => contract.decimals(), "erc20.decimals"),
    callView(() => contract.totalSupply(), "erc20.totalSupply"),
  ]);
  return {
    name,
    symbol,
    decimals: Number(decimals),
    totalSupply: BigInt(totalSupply),
  };
}

async function readErc721Info(contract: Contract) {
  const [name, symbol, totalSupply] = await Promise.all([
    callView(() => contract.name(), "erc721.name"),
    callView(() => contract.symbol(), "erc721.symbol"),
    callView(() => contract.totalSupply(), "erc721.totalSupply"),
  ]);
  return {
    name,
    symbol,
    totalSupply: BigInt(totalSupply),
  };
}

async function readDoudochainInfo(contract: Contract) {
  const base = await readErc721Info(contract);
  const seriesTotal = await callView(() => contract.getSeriesTotalLength(), "getSeriesTotalLength");
  return {
    ...base,
    seriesTotal: BigInt(seriesTotal),
  };
}

async function readVoucherDetails(contract: Contract, tokenIds: bigint[]): Promise<Map<bigint, VoucherDetail>> {
  const voucherCache = new Map<string, { amount: bigint }>();
  const entries = await mapWithConcurrency<bigint, [bigint, VoucherDetail]>(tokenIds, 8, async (tokenId) => {
    const isMembership = Boolean(await callView(() => contract.isMembershipNFT(tokenId), `isMembershipNFT ${tokenId}`));
    if (isMembership) {
      return [tokenId, { tokenId, isMembership }];
    }

    const voucherTypeId = BigInt(await callView(() => contract.voucherTypeIds(tokenId), `voucherTypeIds ${tokenId}`));
    const cacheKey = voucherTypeId.toString();
    let voucher = voucherCache.get(cacheKey);
    if (!voucher) {
      const voucherType = await callView(() => contract.voucherTypes(voucherTypeId), `voucherTypes ${voucherTypeId}`);
      voucher = { amount: BigInt(voucherType.amount) };
      voucherCache.set(cacheKey, voucher);
    }

    return [tokenId, { tokenId, isMembership, voucherTypeId, amount: voucher.amount }];
  });

  return new Map(entries);
}

async function readCoinNftMemberInfos(
  contract: Contract,
  holders: string[]
): Promise<Map<string, CoinNftMemberInfo>> {
  const membershipLevelCache = new Map<string, { name: string; rewardBasisPoints: bigint }>();

  async function membershipLevel(levelIndex: bigint) {
    const key = levelIndex.toString();
    const cached = membershipLevelCache.get(key);
    if (cached) {
      return cached;
    }

    const level = await callView(() => contract.membershipLevels(levelIndex), `membershipLevels ${levelIndex}`);
    const value = {
      name: String(level.name ?? level[0]),
      rewardBasisPoints: BigInt(level.rewardBasisPoints ?? level[3]),
    };
    membershipLevelCache.set(key, value);
    return value;
  }

  const entries = await mapWithConcurrency(holders, 8, async (holder) => {
    const userInfo = await callView(() => contract.userInfo(holder), `userInfo ${holder}`);
    const levelIndex = BigInt(userInfo.membershipLevel ?? userInfo[2]);
    const level = await membershipLevel(levelIndex);

    return [
      holder.toLowerCase(),
      {
        levelIndex,
        levelName: level.name,
        rewardBasisPoints: level.rewardBasisPoints,
        membershipTokenId: BigInt(userInfo.membershipNFT ?? userInfo[3]),
        totalRedeemed: BigInt(userInfo.totalRedeemed ?? userInfo[0]),
        currentRoundRedeemed: BigInt(userInfo.currentRoundRedeemed ?? userInfo[1]),
      },
    ] as const;
  });

  return new Map(entries);
}

async function readSeriesDetails(contract: Contract, seriesIds: bigint[]): Promise<Map<bigint, SeriesDetail>> {
  const entries = await mapWithConcurrency(seriesIds, 8, async (seriesId) => {
    const series = await callView(() => contract.ICHISeries(seriesId), `ICHISeries ${seriesId}`);
    return [
      seriesId,
      {
        seriesName: String(series.seriesName ?? series[0]),
        priceInTWD: BigInt(series.priceInTWD ?? series[11]),
      },
    ] as const;
  });

  return new Map(entries);
}

async function readPrizeDetails(contract: Contract, seriesIds: bigint[]): Promise<Map<string, { prizeGroup: string; prizeName: string }>> {
  const entries = await mapWithConcurrency(seriesIds, 6, async (seriesId) => {
    const prizes = await callView(() => contract.getSubPrizesDetail(seriesId), `getSubPrizesDetail ${seriesId}`);
    return prizes.map((prize: any) => [
      seriesPrizeKey(seriesId, BigInt(prize.subPrizeID ?? prize[0])),
      {
        prizeGroup: String(prize.prizeGroup ?? prize[1]),
        prizeName: String(prize.subPrizeName ?? prize[2]),
      },
    ] as const);
  });

  return new Map(entries.flat());
}

async function readTicketStatuses(contract: Contract, tokenIds: bigint[]): Promise<Map<bigint, TicketStatus>> {
  const entries = await mapWithConcurrency(tokenIds, 6, async (tokenId) => {
    const status = await callView(() => contract.ticketStatusDetail(tokenId), `ticketStatusDetail ${tokenId}`);
    return [
      tokenId,
      {
        seriesId: BigInt(status.seriesID ?? status[0]),
        prizeId: BigInt(status.tokenRevealedPrize ?? status[1]),
        exchanged: Boolean(status.tokenExchange ?? status[2]),
        revealed: Boolean(status.tokenRevealed ?? status[3]),
      },
    ] as const;
  });
  return new Map(entries);
}

function uniqueBigints(values: bigint[]): bigint[] {
  return Array.from(new Set(values.map((value) => value.toString())))
    .map((value) => BigInt(value))
    .sort(compareBigInt);
}

function seriesPrizeKey(seriesId: bigint, prizeId: bigint): string {
  return `${seriesId.toString()}:${prizeId.toString()}`;
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

function compareNftSupply(name: string, ownerCount: number, totalSupply: bigint): string[] {
  if (BigInt(ownerCount) === totalSupply) {
    return [];
  }
  return [`${name} Transfer-derived current NFT count ${ownerCount} != on-chain totalSupply ${totalSupply.toString()}`];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function makeReportDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.resolve(process.cwd(), "reports", `polygon-migration-${stamp}`);
  fs.mkdirSync(reportDir, { recursive: true });
  return reportDir;
}

function writeCsv(filePath: string, headers: string[], rows: string[][]) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function rpcCandidates(): string[] {
  return [
    process.env.POLYGON_RPC_URL,
    process.env.POLYGON_MAINNET_RPC_URL,
    ...DEFAULT_RPC_URLS,
  ].filter((url): url is string => Boolean(url && url.trim()));
}

function envAddress(envName: string, fallback: string): string {
  return ethers.getAddress(process.env[envName] ?? fallback);
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}

function addressFromTopic(topic: string): string {
  return ethers.getAddress(`0x${topic.slice(-40)}`).toLowerCase();
}

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function callView<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(fn(), 45_000, label);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`  retrying ${label} (${attempt}/${attempts}): ${errorMessage(error)}`);
        await sleep(750 * attempt);
      }
    }
  }

  throw new Error(`${label} failed after ${attempts} attempts: ${errorMessage(lastError)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
