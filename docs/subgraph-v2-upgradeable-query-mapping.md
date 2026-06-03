# DOUDOCHAIN V2 Upgradeable Subgraph And Query Mapping

## Data Source Addresses

Index proxy addresses, not implementation addresses.

| Contract | Subgraph data source |
| --- | --- |
| `DOUDOCHAINV2Upgradeable` | UUPS proxy address |
| `CollectionBookUpgradeable` | UUPS proxy address |

## Existing Query Compatibility

Most existing frontend queries can keep their entity names.

| Current field/entity | V2 handling |
| --- | --- |
| `NewSeries.priceInUSDTWei` | Keep populated for compatibility. Value is `priceInPoints`. Add `priceInPoints` as an alias field in schema when frontend is ready. |
| `NewTicketStatus` | Same entity, event now includes `luckyNumber`. Add nullable or required `luckyNumber: BigInt` depending on migration strategy. |
| `RevealDrawSent` | Same event shape: `requestId`, `tokenIDs`. Handler can infer `seriesID` from tokens as it does now, or persist from ticket relation. |
| `RevealDrawFulfilled` | Same event shape: `requestId`, `seriesID`, `randomWords`. |
| `UpdatePrize` | Same event shape. |
| `UpdateTicketStatus` | Same 5-parameter event shape; no lucky number here. |
| `UpdateSeriesInformation` | Same event shape; metadata remains editable after goods arrival. |
| `UpdateSeriesRemainingTicketNumbers` | Same event shape. |
| `LastPrizeDraw`, `LastPrizeWinner`, `UpdateSeriesLastPrizeOwner` | Same event names for existing last-prize views. |

## New Core Events

Add entities only if the frontend or ops dashboard needs them.

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

## Collection Book Event Mapping

| Event | Handler behavior |
| --- | --- |
| `CollectionBookCreated(bookId, name, rewardKind, rewardData, active)` | Create/update `CollectionBook`. |
| `CollectionBookSlotDefined(bookId, slotIndex, sourceContract, seriesID, prizeId, quantity)` | Create `CollectionBookSlot`; increment `totalRequired`. |
| `CollectionBookStatusUpdated(bookId, active)` | Update `CollectionBook.active`. |
| `CollectionBookRewardTargetUpdated(target)` | Store as global config or immutable history entity. |
| `CollectionBookSlotFilled(user, bookId, slotIndex, sourceContract, tokenId, newFilledCount)` | Mark deposit active and increment/update `CollectionBookUserProgress`. |
| `CollectionBookSlotEmptied(user, bookId, slotIndex, sourceContract, tokenId, newFilledCount)` | Mark deposit inactive and decrement/update progress. |
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
