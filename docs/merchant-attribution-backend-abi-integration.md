# Merchant Attribution Backend ABI Integration

Last updated: 2026-08-25

本文給後端串接 DOUDOCHAIN V2 merchant attribution ABI 使用。merchant attribution 不在 Core 儲存；後端發布系列時應呼叫 `MerchantSeriesPublisher`，由 Publisher 在同一筆交易中呼叫 Core 建立系列，再寫入 `MerchantSeriesRegistry`。

## Deployed Addresses

| Contract | Address | Notes |
| --- | --- | --- |
| `DOUDOCHAINV2CoreUpgradeable` | `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` | Existing Core proxy |
| `MerchantSeriesRegistry` | `0x03dBEE1f231A29b06032aa24D2CFb96a1321C1A6` | UUPS proxy, index this address in The Graph |
| `MerchantSeriesRegistry` implementation | `0x59B2869C51cc555734845DF9eb3bDFb5Fc6f1E81` | Verification / upgrade record only |
| `MerchantSeriesPublisher` | `0xB0EC5ca70a9AeCaeb260FdCDF238a64Ad37F5515` | UUPS proxy publish entry point |

The Graph indexes `MerchantSeriesRegistry` from block `277513499`.

## ABI Sources

Backend can either import ABI JSON from contract artifacts or define a minimal viem ABI inline.

Artifact paths:

| Contract | Artifact |
| --- | --- |
| `MerchantSeriesPublisher` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/MerchantSeriesPublisher.sol/MerchantSeriesPublisher.json` |
| `MerchantSeriesRegistry` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/MerchantSeriesRegistry.sol/MerchantSeriesRegistry.json` |
| `DOUDOCHAINV2CoreUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/DOUDOCHAINV2CoreUpgradeable.sol/DOUDOCHAINV2CoreUpgradeable.json` |

Recommended backend config additions in `packages/config/src/index.ts`:

```ts
contracts: {
  DOUDO_CORE: '0xf75395A8cd753f47135cfcaE00D2706252c3E0F5',
  DOUDO_MERCHANT_REGISTRY: '0x03dBEE1f231A29b06032aa24D2CFb96a1321C1A6',
  DOUDO_MERCHANT_PUBLISHER: '0xB0EC5ca70a9AeCaeb260FdCDF238a64Ad37F5515',
}
```

## Publish Method

Use `MerchantSeriesPublisher.publishSeriesWithMerchant(...)` for new merchant-attributed series.

Solidity signature:

```solidity
publishSeriesWithMerchant(
  address core,
  (
    string seriesName,
    uint256 totalTicketNumbers,
    uint256 priceInPoints,
    uint256 priceInTWD,
    uint256 estimateDeliverTime,
    string exchangeTokenURI,
    string unrevealTokenURI,
    string revealTokenURI,
    string seriesMetaDataURI,
    bool isPreOrder,
    bool useLuckyNumber,
    uint256 maxPerWallet,
    uint8 packingType,
    uint8 sourceType
  ) input,
  (
    uint256 subPrizeID,
    string prizeGroup,
    string subPrizeName,
    uint256 subPrizeRemainingQuantity
  )[] subPrizes,
  bool revealEnabled,
  bytes32 merchantRef,
  uint256 exchangeExpireTime
) returns (uint256 seriesID)
```

`exchangeExpireTime` is the absolute Unix deadline snapshot calculated from the
merchant setting. If it is not later than `estimateDeliverTime`, Publisher uses
`estimateDeliverTime + 14 days`. Existing series deadlines can only be extended.

Canonical viem signature:

```ts
'publishSeriesWithMerchant(address,(string,uint256,uint256,uint256,uint256,string,string,string,string,bool,bool,uint256,uint8,uint8),(uint256,string,string,uint256)[],bool,bytes32,uint256)'
```

Function selector:

```text
0x6fe6e103
```

Backend `ContractCalldataBuilder` allowlist entry should use:

```ts
typedAction({
  domain: 'SERIES_OPS',
  action: 'publishSeriesWithMerchant',
  contractKey: 'DOUDO_MERCHANT_PUBLISHER',
  functionName: 'publishSeriesWithMerchant',
  signature:
    'publishSeriesWithMerchant(address,(string,uint256,uint256,uint256,uint256,string,string,string,string,bool,bool,uint256,uint8,uint8),(uint256,string,string,uint256)[],bool,bytes32,uint256)',
  inputs: [
    { name: 'core', type: 'address' },
    { name: 'input', type: 'tuple', components: seriesInputComponents },
    { name: 'subPrizes', type: 'tuple[]', components: subPrizeComponents },
    { name: 'revealEnabled', type: 'bool' },
    { name: 'merchantRef', type: 'bytes32' },
    { name: 'exchangeExpireTime', type: 'uint256' },
  ],
  mapArgs: (args) => [
    normalizeAddress(String(args.core)),
    mapSeriesInput(asRecord(args.seriesInput ?? args.input)),
    asArray(args.subPrizes).map(mapSubPrize),
    Boolean(args.revealEnabled),
    normalizeBytes32(args.merchantRef),
    toUint256(args.exchangeExpireTime),
  ],
})
```

Add a helper equivalent to:

```ts
function normalizeBytes32(value: unknown): `0x${string}` {
  const text = String(value);
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) {
    throw new Error('Expected bytes32 hex string');
  }
  if (/^0x0{64}$/i.test(text)) {
    throw new Error('merchantRef cannot be zero');
  }
  return text as `0x${string}`;
}
```

## Example Intent Args

```json
{
  "core": "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
  "merchantRef": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "seriesInput": {
    "seriesName": "Merchant Series",
    "totalTicketNumbers": "100",
    "priceInPoints": "1000000000000000000",
    "priceInTWD": "100",
    "estimateDeliverTime": "1780000000",
    "exchangeTokenURI": "ipfs://exchange/",
    "unrevealTokenURI": "ipfs://unreveal",
    "revealTokenURI": "ipfs://reveal/",
    "seriesMetaDataURI": "ipfs://series",
    "isPreOrder": false,
    "useLuckyNumber": false,
    "maxPerWallet": "0",
    "packingType": 1,
    "sourceType": 1
  },
  "subPrizes": [
    {
      "subPrizeID": "1",
      "prizeGroup": "A",
      "subPrizeName": "A1",
      "subPrizeRemainingQuantity": "10"
    },
    {
      "subPrizeID": "2",
      "prizeGroup": "B",
      "subPrizeName": "B1",
      "subPrizeRemainingQuantity": "90"
    }
  ],
  "revealEnabled": true,
  "exchangeExpireTime": "1781209600"
}
```

## Events To Reconcile

Successful publish emits at least:

```solidity
NewSeries(uint256 indexed seriesID, ...)
NewSubPrize(uint256 indexed seriesID, ...)
UpdateSeriesInformation(uint256 indexed seriesID, ...)
SeriesMerchantLinked(address indexed seriesContract, uint256 indexed seriesID, bytes32 indexed merchantRef, address operator)
SeriesPublished(address indexed core, uint256 indexed seriesID, bytes32 indexed merchantRef, address operator)
```

Receipt reconciliation should treat `NewSeries` + `SeriesMerchantLinked` as the merchant publish proof. `SeriesPublished` is useful as Publisher-level telemetry, but Registry is the canonical merchant ledger.

Expected Graph reconciliation:

```graphql
query getSeriesMerchant($seriesID: BigInt!) {
  newSeries_collection(where: { seriesID: $seriesID }) {
    seriesID
    seriesContract
    merchantRef
    merchantLinkedAt
    merchantLinkOperator
    merchantLinkTransactionHash
    merchantRelinkCount
  }
}
```

`merchantRef = null` means the series was created outside Publisher, Graph has not indexed Registry yet, or the Registry data source is not deployed correctly.

## Registry Reads And Corrections

Read merchant attribution directly:

```solidity
merchantOf(address seriesContract, uint256 seriesID) returns (bytes32)
```

Use `relinkSeries(seriesContract, seriesID, newMerchantRef)` only for admin correction flows. It is admin-only and emits:

```solidity
SeriesMerchantRelinked(address indexed seriesContract, uint256 indexed seriesID, bytes32 previousMerchantRef, bytes32 newMerchantRef, address operator)
```

Backend should require a correction reason and store it off-chain before submitting a relink transaction.

## Roles

Current deployed wiring:

| Permission | Holder |
| --- | --- |
| Core `OPERATION_ROLE` | `MerchantSeriesPublisher` `0xB0EC5ca70a9AeCaeb260FdCDF238a64Ad37F5515` |
| Registry `LINKER_ROLE` | `MerchantSeriesPublisher` `0xB0EC5ca70a9AeCaeb260FdCDF238a64Ad37F5515` |
| Publisher `PUBLISHER_OPERATION_ROLE` | Ops wallet `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |

The backend signer that publishes merchant series must hold `PUBLISHER_OPERATION_ROLE`, or route through the current ops wallet flow.

## Migration Guidance For Backend

1. Keep existing `createSeriesWithSubPrizes` allowlist temporarily for rollback/manual internal ops.
2. Add `DOUDO_MERCHANT_PUBLISHER` and `DOUDO_MERCHANT_REGISTRY` to chain registry.
3. Add `publishSeriesWithMerchant` to `packages/contracts/src/index.ts`.
4. Update series draft publish workflow to pass `core = DOUDO_CORE` and require a non-zero `merchantRef`.
5. Change expected Graph events from `NewSeries/NewSubPrize` to `NewSeries/NewSubPrize/SeriesMerchantLinked`.
6. After publish receipt, persist `seriesID`, `merchantRef`, `core`, and `publishTxHash` in backend DB.
7. Reconcile against The Graph `NewSeries.merchantRef`.

Do not add merchant storage assumptions to Core. User mint/reveal/exchange flows continue to call Core directly and do not need Registry or Publisher.
