const fs = require('fs');
const path = require('path');
const { Interface, keccak256 } = require('ethers');

const REPORT_DIR = path.resolve(
  process.cwd(),
  'reports/polygon-migration-2026-07-08T15-26-03-453Z',
);
const REPORT_PATH = path.join(REPORT_DIR, 'migration-report.json');
const OUTPUT_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(REPORT_DIR, 'migration-entitlements-89879340.json');
const RPC_URL =
  process.env.POLYGON_RPC_URL || 'https://gateway.tenderly.co/public/polygon';
const SNAPSHOT_BLOCK = 89_879_340;
const SNAPSHOT_BLOCK_HEX = `0x${SNAPSHOT_BLOCK.toString(16)}`;
const DOUDOCHAIN_ADDRESS = '0x8386b1f2cd830907e5b4adc30ea45515b17b80b4';
const SERIES_INTERFACE = new Interface([
  'function ICHISeries(uint256 seriesID) view returns (string seriesName,uint256 totalTicketNumbers,uint256 remainingTicketNumbers,uint256 priceInUSDTWei,bool isGoodsArrived,uint256 estimateDeliverTime,uint256 exchangeExpireTime,string exchangeTokenURI,string unrevealTokenURI,string revealTokenURI,string seriesMetaDataURI,uint256 priceInTWD,bool isRefund,bool isPreOrder)',
]);
const SYSTEM_ADDRESSES = new Set([
  '0x000000000000000000000000000000000000dead',
  '0x8386b1f2cd830907e5b4adc30ea45515b17b80b4',
  '0xc156b5a299fbf556d5652f7fddebab27815f1342',
  '0x25b983dd08c9f534d3cda1289dd2b0047732c06b',
]);
const SIMPLE_ACCOUNT_CODE_HASH =
  '0x0acbd632c56f6f227951f6c832b36177319145deddb8df3a12c3bcc91fbf49b3';
const WEI = 10n ** 18n;
const EXPECTED_SUMMARY = {
  snapshotBlock: SNAPSHOT_BLOCK,
  entitlementCount: 55,
  particleAaAddressCount: 55,
  coinAmount: '20881.5',
  coinNftTwdValue: 0,
  unroundedPoints: '25057.8',
  targetPoints: 25064,
  roundedControllerCount: 11,
  coinNftItemCount: 40,
  unexchangedNftCount: 357,
};

const normalizeAddress = (value) => value.toLowerCase();
const compareTokenIds = (left, right) => {
  const leftId = BigInt(left.tokenId);
  const rightId = BigInt(right.tokenId);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
};
const gcd = (left, right) => {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
};
const fraction = (numerator, denominator) => {
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
};
const add = (left, right) =>
  fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
const multiply = (value, amount) =>
  fraction(value.numerator * amount, value.denominator);
const ceil = (value) =>
  value.numerator <= 0n
    ? value.numerator / value.denominator
    : (value.numerator + value.denominator - 1n) / value.denominator;
const formatFraction = (value, max = 18) => {
  const normalized = fraction(value.numerator, value.denominator);
  const whole = normalized.numerator / normalized.denominator;
  let remainder = normalized.numerator % normalized.denominator;
  if (remainder === 0n) return whole.toString();
  let decimals = '';
  for (let index = 0; index < max && remainder !== 0n; index += 1) {
    remainder *= 10n;
    decimals += (remainder / normalized.denominator).toString();
    remainder %= normalized.denominator;
  }
  return `${whole}.${decimals.replace(/0+$/, '')}`;
};
const conversion = (coinRaw, coinNftTwd) => {
  const coinTwd = fraction(coinRaw * 3n, WEI * 5n);
  const totalTwd = add(coinTwd, fraction(coinNftTwd, 1n));
  const points = multiply(totalTwd, 2n);
  return {
    coinAmountFormatted: formatFraction(fraction(coinRaw, WEI)),
    coinTwdValue: formatFraction(coinTwd),
    unroundedPoints: formatFraction(points),
    targetPoints: Number(ceil(points)),
  };
};

async function rpcBatch(requests) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requests),
  });
  if (!response.ok) throw new Error(`Polygon RPC failed: ${response.status}`);
  const payload = await response.json();
  const errors = payload.filter((item) => item.error);
  if (errors.length > 0) throw new Error(JSON.stringify(errors[0].error));
  return new Map(payload.map((item) => [item.id, item.result]));
}

async function controllerMap(addresses) {
  const codeResults = await rpcBatch(
    addresses.map((address, index) => ({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'eth_getCode',
      params: [address, SNAPSHOT_BLOCK_HEX],
    })),
  );
  const contracts = addresses.filter(
    (_address, index) => codeResults.get(index + 1) !== '0x',
  );
  for (const address of contracts) {
    const index = addresses.indexOf(address);
    const code = codeResults.get(index + 1);
    const codeHash = keccak256(code);
    if (codeHash !== SIMPLE_ACCOUNT_CODE_HASH) {
      throw new Error(`Unexpected contract holder ${address}: ${codeHash}`);
    }
  }
  const ownerResults = await rpcBatch(
    contracts.map((address, index) => ({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'eth_call',
      params: [{ to: address, data: '0x8da5cb5b' }, SNAPSHOT_BLOCK_HEX],
    })),
  );
  const result = new Map(addresses.map((address) => [address, address]));
  contracts.forEach((address, index) => {
    const raw = ownerResults.get(index + 1);
    if (!raw || raw.length < 66) throw new Error(`Missing owner for ${address}`);
    result.set(address, normalizeAddress(`0x${raw.slice(-40)}`));
  });
  return {
    controllers: result,
    particleAaAddressSet: new Set(contracts),
  };
}

const seriesPrizeKey = (seriesId, prizeId) => `${seriesId}:${prizeId}`;

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

async function fetchMetadata(uri) {
  const response = await fetch(uri, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`Series metadata failed (${response.status}): ${uri}`);
  }
  return response.json();
}

async function readPrizeLocalizations(items) {
  const seriesIds = [...new Set(items.map((item) => String(item.seriesId)))].sort(
    (left, right) => Number(left) - Number(right),
  );
  const seriesResults = await rpcBatch(
    seriesIds.map((seriesId, index) => ({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'eth_call',
      params: [
        {
          to: DOUDOCHAIN_ADDRESS,
          data: SERIES_INTERFACE.encodeFunctionData('ICHISeries', [seriesId]),
        },
        SNAPSHOT_BLOCK_HEX,
      ],
    })),
  );
  const metadataEntries = await mapWithConcurrency(
    seriesIds,
    6,
    async (seriesId) => {
      const result = seriesResults.get(seriesIds.indexOf(seriesId) + 1);
      const series = SERIES_INTERFACE.decodeFunctionResult(
        'ICHISeries',
        result,
      );
      return [seriesId, await fetchMetadata(series.seriesMetaDataURI)];
    },
  );
  const localizations = new Map();
  for (const [seriesId, metadata] of metadataEntries) {
    const seriesMetadata = metadata.IchibanSeries ?? metadata.IchibanKuji ?? {};
    const seriesNameTw = String(seriesMetadata.twTitle ?? '').trim();
    const seriesNameEn = String(seriesMetadata.enTitle ?? '').trim();
    const prizes = metadata.IchibanKuji?.prize ?? [];
    for (const prize of prizes) {
      for (const subPrize of prize.subPrize ?? []) {
        localizations.set(
          seriesPrizeKey(seriesId, String(subPrize.subPrizeId)),
          {
            seriesNameTw,
            seriesNameEn,
            prizeNameTw: String(subPrize.twName ?? '').trim(),
            prizeNameEn: String(subPrize.enName ?? '').trim(),
          },
        );
      }
    }
  }
  for (const item of items) {
    const localization = localizations.get(
      seriesPrizeKey(item.seriesId, item.prizeId),
    );
    if (
      !localization?.seriesNameTw ||
      !localization.seriesNameEn ||
      !localization.prizeNameTw ||
      !localization.prizeNameEn
    ) {
      throw new Error(
        `Missing prize localization for series ${item.seriesId}, prize ${item.prizeId}`,
      );
    }
  }
  return localizations;
}

async function main() {
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  if (report.latestBlock !== SNAPSHOT_BLOCK || report.warnings.length !== 0) {
    throw new Error('Migration report snapshot or warnings do not match');
  }
  const addresses = [
    ...new Set(
      [
        ...report.coinHolders,
        ...report.coinNftHolderTotals,
        ...report.doudocoinRevealedUnexchangedHolders,
      ]
        .map((item) => normalizeAddress(item.address))
        .filter((address) => !SYSTEM_ADDRESSES.has(address)),
    ),
  ].sort();
  const { controllers, particleAaAddressSet } = await controllerMap(addresses);
  const prizeLocalizations = await readPrizeLocalizations(
    report.doudocoinRevealedUnexchangedItems,
  );
  const grouped = new Map();
  for (const address of addresses.filter((item) =>
    particleAaAddressSet.has(item),
  )) {
    const controllerAddress = controllers.get(address);
    if (!grouped.has(controllerAddress)) {
      grouped.set(controllerAddress, {
        id: `mig_ent_${controllerAddress.slice(2)}`,
        snapshotBlock: SNAPSHOT_BLOCK,
        controllerAddress,
        particleAaAddresses: [],
        coinAmountRaw: 0n,
        coinNftBaseDoudo: 0n,
        coinNftBonusDoudo: 0n,
        coinNftTotalDoudo: 0n,
        coinNftTwdValue: 0n,
        memberLevelIndex: 0,
        memberLevelName: 'NonMembership',
        memberRewardBasisPoints: 0,
        membershipTokenIds: [],
        coinNftItemsJson: [],
        unexchangedNftsJson: [],
      });
    }
    grouped.get(controllerAddress).particleAaAddresses.push(address);
  }

  for (const holder of report.coinHolders) {
    const address = normalizeAddress(holder.address);
    if (!particleAaAddressSet.has(address)) continue;
    grouped.get(controllers.get(address)).coinAmountRaw += BigInt(holder.balance);
  }
  for (const holder of report.coinNftHolderTotals) {
    const address = normalizeAddress(holder.address);
    if (!particleAaAddressSet.has(address)) continue;
    const row = grouped.get(controllers.get(address));
    row.coinNftBaseDoudo += BigInt(holder.baseVoucherDOUDO);
    row.coinNftBonusDoudo += BigInt(holder.bonusDOUDO);
    row.coinNftTotalDoudo += BigInt(holder.totalRedeemableDOUDO);
    row.coinNftTwdValue += BigInt(holder.estimatedTotalTWD);
    const levelIndex = Number(holder.memberLevelIndex);
    if (levelIndex > row.memberLevelIndex) {
      row.memberLevelIndex = levelIndex;
      row.memberLevelName = holder.memberLevelName;
      row.memberRewardBasisPoints = Number(holder.memberRewardBasisPoints);
    }
    row.membershipTokenIds.push(...holder.membershipTokenIds.map(String));
  }
  for (const item of report.coinNftItems) {
    const address = normalizeAddress(item.address);
    if (!particleAaAddressSet.has(address)) continue;
    grouped.get(controllers.get(address)).coinNftItemsJson.push({
      ...item,
      address,
      voucherTypeId: item.voucherTypeId || undefined,
      membershipTokenId: item.membershipTokenId || undefined,
    });
  }
  for (const item of report.doudocoinRevealedUnexchangedItems) {
    const address = normalizeAddress(item.address);
    if (!particleAaAddressSet.has(address)) continue;
    grouped.get(controllers.get(address)).unexchangedNftsJson.push({
      ...item,
      ...prizeLocalizations.get(seriesPrizeKey(item.seriesId, item.prizeId)),
      address,
    });
  }

  const entitlements = [...grouped.values()]
    .map((row) => {
      const values = conversion(row.coinAmountRaw, row.coinNftTwdValue);
      return {
        id: row.id,
        snapshotBlock: row.snapshotBlock,
        controllerAddress: row.controllerAddress,
        particleAaAddresses: [...new Set(row.particleAaAddresses)].sort(),
        coinAmountRaw: row.coinAmountRaw.toString(),
        coinAmountFormatted: values.coinAmountFormatted,
        coinTwdValue: values.coinTwdValue,
        coinNftBaseDoudo: row.coinNftBaseDoudo.toString(),
        coinNftBonusDoudo: row.coinNftBonusDoudo.toString(),
        coinNftTotalDoudo: row.coinNftTotalDoudo.toString(),
        coinNftTwdValue: row.coinNftTwdValue.toString(),
        unroundedPoints: values.unroundedPoints,
        targetPoints: values.targetPoints,
        memberLevelIndex: row.memberLevelIndex,
        memberLevelName: row.memberLevelName,
        memberRewardBasisPoints: row.memberRewardBasisPoints,
        membershipTokenIds: [...new Set(row.membershipTokenIds)].sort(
          (a, b) => Number(a) - Number(b),
        ),
        coinNftItemsJson: row.coinNftItemsJson.sort(compareTokenIds),
        unexchangedNftsJson: row.unexchangedNftsJson.sort(compareTokenIds),
      };
    })
    .sort((left, right) =>
      left.controllerAddress.localeCompare(right.controllerAddress),
    );

  const summary = {
    snapshotBlock: SNAPSHOT_BLOCK,
    entitlementCount: entitlements.length,
    particleAaAddressCount: entitlements.reduce(
      (total, item) => total + item.particleAaAddresses.length,
      0,
    ),
    coinAmount: formatFraction(
      fraction(
        entitlements.reduce(
          (total, item) => total + BigInt(item.coinAmountRaw),
          0n,
        ),
        WEI,
      ),
    ),
    coinNftTwdValue: entitlements.reduce(
      (total, item) => total + Number(item.coinNftTwdValue),
      0,
    ),
    unroundedPoints: entitlements.reduce(
      (total, item) => add(total, decimalStringFraction(item.unroundedPoints)),
      fraction(0n, 1n),
    ),
    targetPoints: entitlements.reduce(
      (total, item) => total + item.targetPoints,
      0,
    ),
    roundedControllerCount: entitlements.filter(
      (item) => item.unroundedPoints !== String(item.targetPoints),
    ).length,
    coinNftItemCount: entitlements.reduce(
      (total, item) => total + item.coinNftItemsJson.length,
      0,
    ),
    unexchangedNftCount: entitlements.reduce(
      (total, item) => total + item.unexchangedNftsJson.length,
      0,
    ),
  };
  summary.unroundedPoints = formatFraction(summary.unroundedPoints);

  if (JSON.stringify(summary) !== JSON.stringify(EXPECTED_SUMMARY)) {
    throw new Error(`Migration summary mismatch: ${JSON.stringify(summary)}`);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    `${JSON.stringify({ summary, entitlements }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ outputPath: OUTPUT_PATH, summary }, null, 2));
}

const decimalStringFraction = (value) => {
  const [whole, decimals = ''] = value.split('.');
  return fraction(BigInt(`${whole}${decimals}`), 10n ** BigInt(decimals.length));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
