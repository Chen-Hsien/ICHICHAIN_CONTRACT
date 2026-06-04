# DOUDOCHAIN V2 Upgradeable Subgraph And Query Mapping

Last updated: 2026-06-03

Index proxy addresses for UUPS contracts. Index the non-proxy Router directly.

## Data Sources

| Contract | Address | Notes |
| --- | --- | --- |
| `DOUDOCHAINV2CoreUpgradeable` | `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` | Core series, ticket, reveal, prize, last-prize events |
| `DoudoVRFRouter` | `0x5A59D45437559C7CE0A012630a456321180C21e1` | VRF request/fulfillment and config events |
| `DoudoBundleModuleUpgradeable` | `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` | Bundle config/mint events |
| `DoudoRefundModuleUpgradeable` | `0x8ee19238DAa466B7792BE33569c6E4f6993CCf20` | Refund config/claim events |
| `DoudoRedrawModuleUpgradeable` | `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` | Redraw and consolation events |
| `DoudoCollectionRewardModuleUpgradeable` | `0x680618a6933DD68fF84Ff9F64760120d27400B3C` | Book reward config/mint/unlock events |
| `CollectionBookUpgradeable` | `0x4284be399cA9591fBd98248969fCcb969E21B2C6` | Book, slot, deposit, withdrawal, claim events |

## Existing Query Compatibility

Most existing frontend queries can keep their entity names, but handlers should now rely on events rather than removed aggregate view functions.

| Current field/entity | V2 handling |
| --- | --- |
| `NewSeries.priceInUSDTWei` | Keep populated for compatibility. Value is `priceInPoints`. Add `priceInPoints` alias in schema when frontend is ready. |
| `NewTicketStatus` | Same entity name; event now includes seventh parameter `luckyNumber`. |
| `RevealDrawSent` | Same event shape: `requestId`, `tokenIDs`. |
| `RevealDrawFulfilled` | Same event shape: `requestId`, `seriesID`, `randomWords`. |
| `UpdatePrize` | Same event shape for main prize inventory. |
| `UpdateTicketStatus` | Same 5-parameter event shape; no lucky number here. |
| `UpdateSeriesInformation` | Same event shape; metadata remains editable after goods arrival. |
| `UpdateSeriesRemainingTicketNumbers` | Same event shape. |
| `LastPrizeDraw`, `LastPrizeWinner`, `UpdateSeriesLastPrizeOwner` | Same event names for existing last-prize views. |

Removed direct readers in split Core: `doudoSeries`, `seriesURIs`, `getSubPrizesDetail`, token-list pagination, and owner-list pagination. Build these entities from `NewSeries`, `NewSubPrize`, `UpdateSeriesInformation`, `UpdatePrize`, `NewTicketStatus`, `UpdateTicketStatus`, transfers, and module events.

## Core Schema Additions

```graphql
type AdminMinted @entity(immutable: true) {
  id: Bytes!
  operator: Bytes!
  to: Bytes!
  seriesID: BigInt!
  quantity: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

type VrfRouterUpdated @entity(immutable: true) {
  id: Bytes!
  vrfRouter: Bytes!
  operator: Bytes!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

type MintLockUpdated @entity(immutable: false) {
  id: Bytes!
  seriesID: BigInt!
  owner: Bytes!
  until: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

type SeriesUnlockedFor @entity(immutable: true) {
  id: Bytes!
  seriesID: BigInt!
  user: Bytes!
  expires: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

Ticket entity change:

```graphql
type NewTicketStatus @entity(immutable: false) {
  id: Bytes!
  tokenID: BigInt!
  seriesID: BigInt!
  tokenRevealedPrize: BigInt!
  tokenExchange: Boolean!
  tokenRevealed: Boolean!
  tokenOwner: Bytes!
  luckyNumber: BigInt!
}
```

## Router Schema Additions

```graphql
type VrfConfigUpdated @entity(immutable: true) {
  id: Bytes!
  vrfCoordinator: Bytes!
  subscriptionId: BigInt!
  keyHash: Bytes!
  callbackGasLimit: BigInt!
  requestConfirmations: Int!
  operator: Bytes!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

type VrfRequest @entity(immutable: false) {
  id: Bytes!
  requestId: BigInt!
  requester: Bytes!
  callbackTarget: Bytes!
  numWords: BigInt!
  fulfilled: Boolean!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

Handlers:

| Event | Handler behavior |
| --- | --- |
| `VrfRandomWordsRequested(requestId, requester, callbackTarget, numWords)` | Create `VrfRequest` with `fulfilled = false`. |
| `VrfRandomWordsFulfilled(requestId, callbackTarget)` | Set `VrfRequest.fulfilled = true`. |
| `VrfConfigUpdated(...)` | Create immutable config history. |
| `RequesterUpdated(requester, allowed)` | Optional ops/history entity. |

## Bundle Schema Additions

```graphql
type BundleConfig @entity(immutable: false) {
  id: Bytes!
  seriesID: BigInt!
  bundleID: BigInt!
  ticketQuantity: BigInt!
  priceInPoints: BigInt!
  rebatePoints: BigInt!
  consolationDrawCredits: BigInt!
  active: Boolean!
}

type BundleMint @entity(immutable: true) {
  id: Bytes!
  seriesID: BigInt!
  bundleID: BigInt!
  buyer: Bytes!
  quantity: BigInt!
  firstTokenID: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

## Refund Schema Additions

```graphql
type RefundConfig @entity(immutable: false) {
  id: Bytes!
  seriesID: BigInt!
  isRefund: Boolean!
  refundPointsPerTicket: BigInt!
}

type RefundClaim @entity(immutable: true) {
  id: Bytes!
  seriesID: BigInt!
  user: Bytes!
  tokenIDs: [BigInt!]!
  refundPoints: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

`RefundClaimed.refundPoints` is the actual paid amount from Core `pointsPaid`, not only the configured flat reference value.

## Redraw And Consolation Schema Additions

```graphql
type RedrawConfig @entity(immutable: false) {
  id: Bytes!
  seriesID: BigInt!
  mainBurnCount: Int!
  consolationBurnCount: Int!
  enabled: Boolean!
}

type RedrawMint @entity(immutable: true) {
  id: Bytes!
  seriesID: BigInt!
  user: Bytes!
  quantity: BigInt!
  firstTokenID: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

type ConsolationPrize @entity(immutable: false) {
  id: Bytes!
  seriesID: BigInt!
  subPrizeID: BigInt!
  prizeGroup: String!
  subPrizeName: String!
  remainingQuantity: BigInt!
}

type ConsolationDrawBalance @entity(immutable: false) {
  id: Bytes!
  seriesID: BigInt!
  user: Bytes!
  balance: BigInt!
}

type ConsolationDraw @entity(immutable: false) {
  id: Bytes!
  requestId: BigInt!
  seriesID: BigInt!
  user: Bytes!
  tokenID: BigInt
  fulfilled: Boolean!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

Handlers:

| Event | Handler behavior |
| --- | --- |
| `RedrawMinted(seriesID, user, quantity, firstTokenID)` | Create synchronous main redraw record. |
| `RouterUpdated(router)` | Optional ops/history entity for Redraw router changes. |
| `RedrawRequested(requestId, seriesID, user, consolation)` | Create `ConsolationDraw` when `consolation = true`. |
| `RedrawFulfilled(requestId, seriesID, user, tokenID, consolation)` | Mark draw fulfilled and store reward token. |
| `ConsolationDrawBalanceUpdated(seriesID, user, balance)` | Upsert balance. |
| `NewConsolationPrize(...)` | Upsert consolation prize. |
| `UpdateConsolationPrize(seriesID, subPrizeID, remainingQuantity)` | Update consolation inventory. |

## Collection Reward Schema Additions

```graphql
type CollectionRewardConfig @entity(immutable: false) {
  id: Bytes!
  collectionBookID: BigInt!
  rewardKind: Int!
  pointsAmount: BigInt!
  seriesID: BigInt!
  prizeID: BigInt!
  active: Boolean!
}

type CollectionRewardMint @entity(immutable: true) {
  id: Bytes!
  collectionBookID: BigInt!
  user: Bytes!
  rewardKind: Int!
  amount: BigInt!
  tokenID: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

## Collection Book Schema Additions

```graphql
type CollectionBook @entity(immutable: false) {
  id: Bytes!
  bookId: BigInt!
  name: String!
  rewardKind: Int!
  rewardData: BigInt!
  active: Boolean!
  totalRequired: BigInt!
  slots: [CollectionBookSlot!]! @derivedFrom(field: "book")
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

type CollectionBookSlot @entity(immutable: false) {
  id: Bytes!
  book: CollectionBook!
  bookId: BigInt!
  slotIndex: BigInt!
  sourceContract: Bytes!
  seriesID: BigInt!
  prizeId: BigInt!
  quantity: BigInt!
}

type CollectionBookUserProgress @entity(immutable: false) {
  id: Bytes!
  user: Bytes!
  book: CollectionBook!
  filledCount: BigInt!
  claimed: Boolean!
  updatedAt: BigInt!
}

type CollectionBookDeposit @entity(immutable: false) {
  id: Bytes!
  user: Bytes!
  book: CollectionBook!
  slotIndex: BigInt!
  sourceContract: Bytes!
  tokenId: BigInt!
  deposited: Boolean!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}

type CollectionBookClaim @entity(immutable: true) {
  id: Bytes!
  user: Bytes!
  book: CollectionBook!
  rewardKind: Int!
  rewardData: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

Handlers:

| Event | Handler behavior |
| --- | --- |
| `CollectionBookCreated(bookId, name, rewardKind, rewardData, active)` | Create/update `CollectionBook`. |
| `CollectionBookSlotDefined(bookId, slotIndex, sourceContract, seriesID, prizeId, quantity)` | Create `CollectionBookSlot`; increment `totalRequired`. |
| `CollectionBookStatusUpdated(bookId, active)` | Update `CollectionBook.active`. |
| `CollectionBookRewardTargetUpdated(target)` | Store as global config or immutable history entity. |
| `CollectionBookSlotFilled(user, bookId, slotIndex, sourceContract, tokenId, newFilledCount)` | Mark deposit active and update `CollectionBookUserProgress`. |
| `CollectionBookSlotEmptied(user, bookId, slotIndex, sourceContract, tokenId, newFilledCount)` | Mark deposit inactive and update progress. |
| `CollectionBookClaimed(user, bookId, rewardKind, rewardData)` | Mark progress `claimed = true`; create `CollectionBookClaim`. |

## Frontend Query Examples

```graphql
query getCollectionBooks($first: Int = 20) {
  collectionBooks(first: $first, orderBy: bookId, orderDirection: asc) {
    id
    bookId
    name
    rewardKind
    rewardData
    active
    totalRequired
    slots(orderBy: slotIndex, orderDirection: asc) {
      slotIndex
      sourceContract
      seriesID
      prizeId
      quantity
    }
  }
}
```

```graphql
query getCollectionBookProgress($user: Bytes!, $bookId: BigInt!) {
  collectionBookUserProgresses(where: { user: $user, book_: { bookId: $bookId } }) {
    filledCount
    claimed
    book {
      bookId
      totalRequired
    }
  }
  collectionBookDeposits(where: { user: $user, book_: { bookId: $bookId }, deposited: true }) {
    slotIndex
    sourceContract
    tokenId
  }
}
```

```graphql
query getTicketWithLuckyNumber($tokenId: BigInt!) {
  newTicketStatuses(where: { tokenID: $tokenId }) {
    tokenID
    seriesID
    tokenRevealedPrize
    tokenExchange
    tokenRevealed
    tokenOwner
    luckyNumber
  }
}
```
