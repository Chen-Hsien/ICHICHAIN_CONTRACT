# DOUDOCHAIN V2 — Reward NFT Classification (Subgraph + Frontend)

Last updated: 2026-06-06

## Purpose

Reward NFTs (CollectionBook NFT rewards and Redraw consolation prizes) are minted
into a sale `seriesID` via Core `_mintRevealedNoInventory`. They emit the **same**
`NewTicketStatus` / `UpdateTicketStatus` events as normal gacha tickets, so by default
they get mixed into a series' token list and inflate "series NFT content".

This document defines how to classify those tokens in the **subgraph + frontend**.
**No contract change is required** — the data needed to classify already exists on-chain.

## Key facts (on-chain) — what is and isn't affected

| Data | Source | Affected by rewards? |
| --- | --- | --- |
| Probability table / prize catalog | `IchibanKujiPrizes` (`groupTotalQuantity`, `size`), `NewSubPrize` / `UpdatePrize` | **No** — config/inventory based; reward mints bypass `_drawPrize` and never change `subPrizeRemainingQuantity`. |
| `remainingTicketNumbers` (sold / remaining) | Series; `UpdateSeriesRemainingTicketNumbers` | **No** — only decremented by real sales (`mint` / `adminMint` / bundle). Reward/last-prize mints do not touch it. |
| `newTicketStatuses` (series token list) | Core `NewTicketStatus` event | **Yes** — reward tokens carry the same `seriesID` and a non-null owner, so they appear in the list. **This is the only thing to fix.** |

So the fix is purely: **tag reward tokens so the series token list can exclude them.**

## On-chain signals used for classification

All emitted today; the subgraph already indexes these data sources.

| Token kind | How to detect | Event |
| --- | --- | --- |
| Normal draw ticket | default | Core `NewTicketStatus` |
| Collection-book NFT reward | `rewardKind == 0` (NftPrize) and `tokenID != 0` | `CollectionRewardMinted(collectionBookID, user, rewardKind, amount, tokenID)` |
| Consolation prize | `consolation == true` | `RedrawFulfilled(requestId, seriesID, user, tokenID, consolation)` |
| Last prize (末賞) | `tokenRevealedPrize == 999` (`LAST_PRIZE_ID`) | Core `NewTicketStatus` |

Note: Redraw **main** (`RedrawMinted`) mints normal unrevealed tickets that consume
inventory — those stay `DRAW`, they are **not** rewards.

## Subgraph schema change (`schema.graphql`)

Add two derived fields to the ticket entity:

```graphql
type NewTicketStatus @entity(immutable: false) {
  id: Bytes!                 # MUST be derived from tokenID (see note below)
  tokenID: BigInt!
  seriesID: BigInt!
  tokenRevealedPrize: BigInt!
  tokenExchange: Boolean!
  tokenRevealed: Boolean!
  tokenOwner: Bytes!
  luckyNumber: BigInt!
  tokenSource: String!       # "DRAW" | "COLLECTION_REWARD" | "CONSOLATION" | "LAST_PRIZE"
  isReward: Boolean!         # convenience: true for COLLECTION_REWARD / CONSOLATION
}
```

**ID requirement:** the reward/consolation handlers look the ticket up by `tokenID`.
Make `NewTicketStatus.id` a deterministic function of `tokenID` (e.g.
`Bytes.fromByteArray(ByteArray.fromBigInt(tokenID))`) and reuse the same helper
everywhere. If your current `id` is tx-hash/log-index based, switch it to tokenID-based
(or add a lookup) so the cross-event update can find the row.

## Subgraph mapping handlers

Event ordering guarantee: within a single transaction, Core's `NewTicketStatus`
is emitted **before** the module's `CollectionRewardMinted` / `RedrawFulfilled`
(the inner Core call returns first). So the ticket row always exists when the
reward handler runs, and the reward handler overrides the default classification.

```ts
import { BigInt, ByteArray, Bytes } from "@graphprotocol/graph-ts";

const LAST_PRIZE_ID = BigInt.fromI32(999);

export function ticketId(tokenID: BigInt): Bytes {
  return Bytes.fromByteArray(ByteArray.fromBigInt(tokenID));
}

// Core: contracts/DOUDOCHAINV2CoreUpgradeable.sol -> NewTicketStatus
export function handleNewTicketStatus(e: NewTicketStatusEvent): void {
  const id = ticketId(e.params.tokenID);
  let t = NewTicketStatus.load(id);
  if (t == null) t = new NewTicketStatus(id);
  t.tokenID = e.params.tokenID;
  t.seriesID = e.params.seriesID;
  t.tokenRevealedPrize = e.params.tokenRevealedPrize;
  t.tokenExchange = e.params.tokenExchange;
  t.tokenRevealed = e.params.tokenRevealed;
  t.tokenOwner = e.params.tokenOwner;
  t.luckyNumber = BigInt.fromI32(e.params.luckyNumber);

  // Default classification. Do NOT override an already-set reward source
  // (handlers may run in either order across re-orgs / replays).
  if (t.tokenSource == null || t.tokenSource == "") {
    t.tokenSource = e.params.tokenRevealedPrize.equals(LAST_PRIZE_ID) ? "LAST_PRIZE" : "DRAW";
    t.isReward = false;
  }
  t.save();
}

// CollectionReward module -> CollectionRewardMinted
export function handleCollectionRewardMinted(e: CollectionRewardMintedEvent): void {
  if (e.params.tokenID.isZero()) return;            // Points reward => tokenID 0
  if (e.params.rewardKind != 0) return;             // 0 = NftPrize
  const t = NewTicketStatus.load(ticketId(e.params.tokenID));
  if (t == null) return;
  t.tokenSource = "COLLECTION_REWARD";
  t.isReward = true;
  t.save();
}

// Redraw module -> RedrawFulfilled
export function handleRedrawFulfilled(e: RedrawFulfilledEvent): void {
  if (!e.params.consolation) return;                // main redraw stays DRAW
  const t = NewTicketStatus.load(ticketId(e.params.tokenID));
  if (t == null) return;
  t.tokenSource = "CONSOLATION";
  t.isReward = true;
  t.save();
}
```

`UpdateTicketStatus` handlers (reveal / exchange) must keep updating
`tokenRevealedPrize` / `tokenRevealed` / `tokenExchange` but **must not** reset
`tokenSource` / `isReward`.

## Frontend query changes

Series content (the gacha body) — exclude rewards:

```graphql
newTicketStatuses(
  where: { seriesID: $seriesID, tokenOwner_not: null, isReward: false }
  orderBy: tokenID
  orderDirection: asc
  first: $first
  skip: $skip
) { tokenID luckyNumber tokenRevealedPrize tokenOwner belongIchibanSubPrize { ... } }
```

- If you also want to exclude last prize from "series content", use
  `where: { ..., tokenSource: "DRAW" }` instead of `isReward: false`. This is a
  product decision (is 末賞 part of the series view or not?).
- Any "已開出 N / 總量" or per-series token count must use `tokenSource: "DRAW"`
  so it lines up with `totalTicketNumbers`.

A user's reward collection (separate view):

```graphql
newTicketStatuses(where: { tokenOwner: $user, isReward: true }, orderBy: tokenID) {
  tokenID seriesID tokenRevealedPrize tokenOwner belongIchibanSubPrize { ... }
}
```

Reward art still resolves via `tokenRevealedPrize -> belongIchibanSubPrize` (CMS),
exactly like consolation prize `9001` does today — no dedicated series needed.

## Deploy / re-index notes

- This is a `schema.graphql` + mapping change → **redeploy the subgraph and full re-index**.
- Re-indexing reclassifies all historical tokens automatically from events; no manual backfill.
- **Independent of the Core contract upgrade** — ship on its own timeline.

## Verification checklist

- [ ] A claimed CollectionBook NFT reward token has `tokenSource = "COLLECTION_REWARD"`, `isReward = true`.
- [ ] A consolation prize token has `tokenSource = "CONSOLATION"`, `isReward = true`.
- [ ] A normal revealed ticket has `tokenSource = "DRAW"`, `isReward = false`.
- [ ] A last-prize token has `tokenSource = "LAST_PRIZE"`.
- [ ] Series query with `isReward: false` returns exactly the gacha tickets (count ≤ `totalTicketNumbers`).
- [ ] Probability table unchanged (still derived from prize catalog / remaining).
