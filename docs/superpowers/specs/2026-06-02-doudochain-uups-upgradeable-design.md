# DOUDOCHAIN V2 UUPS Upgradeable Design

## Status

Design approved for implementation planning. This document updates the previous V2 core and Collection Book design for a fresh UUPS proxy deployment on Arbitrum Sepolia.

## Goals

- Deploy `DOUDOCHAINV2Upgradeable` and `CollectionBookUpgradeable` behind UUPS proxies.
- Preserve existing lottery business behavior from V2: points-only minting, atomic series setup, lucky numbers, bundles, refunds, redraws, last prize, collection book rewards, and admin airdrop minting.
- Keep The Graph as the primary read model and preserve core query compatibility where practical.
- Reduce implementation bytecode enough to leave room for UUPS, `AdminMint`, and future upgrades.

## Non-Goals

- No migration of existing immutable deployed V1/V2 contract storage.
- No old currency/native payment path in V2.
- No large on-chain pagination/list readers such as `getSeriesTokenList`, `getSeriesTokenOwnerList`, or `getPaginatedSeriesInfo`.
- ERC2981 royalty is excluded from the first upgradeable implementation; add later only if bytecode budget permits.

## Locked Decisions

- Use UUPS proxy for both `DOUDOCHAINV2Upgradeable` and `CollectionBookUpgradeable`.
- Use deployer/official ops wallet as initial holder of `DEFAULT_ADMIN_ROLE` and `UPGRADER_ROLE`.
- Do not inherit `VRFConsumerBaseV2Plus`; implement the same coordinator-only fulfill guard directly for proxy-safe storage and bytecode savings.
- Allow `OPERATION_ROLE` to update VRF config.
- Preserve core subgraph-compatible events and add V2-specific events for new features.
- Add `luckyNumber` to `NewTicketStatus`.
- Collection Book must be indexed by the subgraph with its own events and schema.

## Contract Architecture

### DOUDOCHAINV2Upgradeable

- Inherits UUPS upgradeability and ERC721A upgradeable implementation.
- Uses storage-backed config instead of constructor immutables.
- Keeps points-only payment through `IDoudoPoints`.
- Owns lottery tickets, reveal state, prize pools, redraws, last prize, and Collection Book reward minting.
- Adds `adminMint(address to, uint256 seriesID, uint16[] calldata luckyNumbers)`.

`adminMint` behavior:

- Requires `ADMINMINT_ROLE`.
- Does not burn points.
- Bypasses mint lock and max-per-wallet checks.
- Consumes `remainingTicketNumbers`.
- Consumes lucky numbers when the series uses lucky numbers.
- Emits the same ticket events as normal mint, so the subgraph and frontend see a normal ticket owned by `to`.

### CollectionBookUpgradeable

- UUPS upgradeable.
- Uses storage-backed `doudoPoints`.
- Escrows revealed matching tickets.
- Emits subgraph-first book, slot, deposit, withdraw, and claim events.
- Routes NFT/unlock rewards through `DOUDOCHAINV2Upgradeable` using `COLLECTION_BOOK_ROLE`.

### DOUDOCOIN

The current soulbound points token can remain non-upgradeable for this phase. `DOUDOCHAINV2Upgradeable` and `CollectionBookUpgradeable` only depend on the `IDoudoPoints` interface.

## Upgradeability Model

- Constructors call `_disableInitializers()`.
- Initializers set token name/symbol, points address, VRF config, default roles, and default lock duration.
- `_authorizeUpgrade(address)` requires `UPGRADER_ROLE`.
- Future upgrades must only append storage and use reserved `__gap` slots.
- Deployment scripts must output proxy address, implementation address, admin/upgrader, and initialization args.

Initial role setup:

- `DEFAULT_ADMIN_ROLE`: deployer/official ops wallet.
- `UPGRADER_ROLE`: deployer/official ops wallet.
- `OPERATION_ROLE`: deployer/official ops wallet.
- `ADMINMINT_ROLE`: deployer/official ops wallet.
- `COLLECTION_BOOK_ROLE`: `CollectionBookUpgradeable` proxy after deployment.

## VRF Design

Store VRF config directly:

```solidity
address public vrfCoordinator;
uint256 public subscriptionId;
bytes32 public keyHash;
uint32 public callbackGasLimit;
uint16 public requestConfirmations;
mapping(uint256 => address) public requestCoordinator;
```

Request flow:

- Build Chainlink V2Plus `RandomWordsRequest`.
- Call `IVRFCoordinatorV2Plus(vrfCoordinator).requestRandomWords(...)`.
- Store `requestCoordinator[requestId] = vrfCoordinator`.
- Store request kind and request context.

Fulfill flow:

```solidity
function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
    if (msg.sender != requestCoordinator[requestId]) revert OnlyCoordinatorCanFulfill();
    _fulfillRandomWords(requestId, randomWords);
}
```

This preserves the Chainlink security property that only the coordinator for that request can fulfill. It also allows VRF config updates without breaking pending requests from the previous coordinator.

VRF config update:

```solidity
event VrfConfigUpdated(
  address indexed vrfCoordinator,
  uint256 subscriptionId,
  bytes32 keyHash,
  uint32 callbackGasLimit,
  uint16 requestConfirmations,
  address indexed operator
);
```

`setVrfConfig(...)` requires `OPERATION_ROLE`.

## Bytecode Reduction Strategy

- Replace Chainlink base inheritance with direct coordinator-only fulfill guard.
- Replace full OpenZeppelin `AccessControl` with a minimal role system that keeps `grantRole`, `revokeRole`, and `hasRole`.
- Use lightweight in-contract pause and reentrancy status instead of full OZ modules.
- Remove legacy on-chain aggregation readers.
- Keep business data accessible through focused getters and events.
- Push large list queries to The Graph.
- Keep Collection Book as a separate contract so book logic does not bloat DOUDOCHAIN.

Required focused getters:

- `doudoSeries(uint256 seriesID)`
- `seriesURIs(uint256 seriesID)`
- `ticketStatusDetail(uint256 tokenID)`
- `getSubPrizesDetail(uint256 seriesID)`
- `lastPrizeOwners(uint256 seriesID, uint256 index)`
- basic role/config getters needed by scripts and dashboards

## DOUDOCHAIN Events

### Compatibility Events

Keep these because current GraphQL queries and subgraph mappings depend on them:

```solidity
event NewSeries(
  uint256 indexed seriesID,
  string seriesName,
  uint256 totalTicketNumbers,
  uint256 remainingTicketNumbers,
  uint256 priceInUSDTWei,
  uint256 priceInTWD,
  bool isGoodsArrived,
  uint256 estimateDeliverTime,
  uint256 exchangeExpireTime,
  string exchangeTokenURI,
  string unrevealTokenURI,
  string revealTokenURI,
  string seriesMetaDataURI,
  address lastPrizeOwner,
  bool isRefund,
  bool isPreOrder
);
```

For V2, `priceInUSDTWei` in this event carries `priceInPoints`. The subgraph should add a new `priceInPoints` field and may keep `priceInUSDTWei` as a deprecated alias during frontend migration.

```solidity
event NewSubPrize(
  uint256 indexed seriesID,
  uint256 subPrizeID,
  string prizeGroup,
  string subPrizeName,
  uint256 subPrizeRemainingQuantity
);
```

```solidity
event NewTicketStatus(
  uint256 tokenID,
  uint256 seriesID,
  uint256 tokenRevealedPrize,
  bool tokenExchange,
  bool tokenRevealed,
  address tokenOwner,
  uint16 luckyNumber
);
```

Subgraph schema must add `luckyNumber: BigInt`.

```solidity
event RevealDrawSent(uint256 requestId, uint256[] tokenIDs);
event RevealDrawFulfilled(uint256 requestId, uint256 seriesID, uint256[] randomWords);
event UpdatePrize(uint256 indexed seriesID, uint256 subPrizeID, uint256 subPrizeRemainingQuantity);
event UpdateTicketStatus(uint256 tokenID, uint256 seriesID, uint256 tokenRevealedPrize, bool tokenExchange, bool tokenRevealed);
event UpdateSeriesInformation(uint256 indexed seriesID, bool isGoodsArrived, uint256 estimateDeliverTime, uint256 exchangeExpireTime, string exchangeTokenURI, string unrevealTokenURI, string revealTokenURI, string seriesMetaDataURI);
event UpdateSeriesRemainingTicketNumbers(uint256 indexed seriesID, uint256 remainingTicketNumbers);
event RefundSeries(uint256 indexed seriesID, bool isRefund);
event LastPrizeDraw(uint256 requestId, uint256 seriesID, uint256 quantity);
event LastPrizeWinner(uint256 requestId, uint256[] randomWord);
event UpdateSeriesLastPrizeOwner(uint256 indexed seriesID, address[] lastPrizeOwner);
```

### V2 Events

```solidity
event AdminMinted(address indexed operator, address indexed to, uint256 indexed seriesID, uint256 quantity);
event BundleMinted(address indexed user, uint256 indexed seriesID, uint256 indexed bundleIndex, uint16 quantity, uint256 pricePoints, uint256 rebatePoints, uint16 consolationDraws);
event RedrawRequested(uint256 indexed requestId, uint256 indexed seriesID, address indexed user, bool consolation);
event RedrawSettled(uint256 indexed requestId, uint256 indexed seriesID, address indexed user, uint256 tokenID, uint256 subPrizeID, bool consolation);
event CollectionRewardConfigSet(uint256 indexed rewardData, uint256 indexed seriesID, uint256 subPrizeID, bool revealed, bool active);
event CollectionRewardMinted(address indexed to, uint256 indexed rewardData, uint256 indexed seriesID, uint256 tokenID, uint256 subPrizeID, bool revealed);
event SeriesUnlockedFor(address indexed user, uint256 indexed seriesID, address indexed operator);
event VrfConfigUpdated(address indexed vrfCoordinator, uint256 subscriptionId, bytes32 keyHash, uint32 callbackGasLimit, uint16 requestConfirmations, address indexed operator);
```

## Collection Book Events

Collection Book uses events as its subgraph read model:

```solidity
event CollectionBookCreated(
  uint256 indexed bookID,
  string name,
  uint8 rewardKind,
  uint256 rewardData,
  bool active
);

event CollectionBookSlotDefined(
  uint256 indexed bookID,
  uint256 indexed slotIndex,
  address indexed sourceContract,
  uint256 seriesID,
  uint256 prizeID,
  uint32 quantity
);

event CollectionBookStatusUpdated(uint256 indexed bookID, bool active);
event CollectionBookRewardTargetUpdated(address indexed doudochainV2RewardTarget);

event CollectionBookSlotFilled(
  address indexed user,
  uint256 indexed bookID,
  uint256 indexed slotIndex,
  address sourceContract,
  uint256 tokenID,
  uint32 slotFilledCount,
  uint32 totalFilledCount
);

event CollectionBookSlotEmptied(
  address indexed user,
  uint256 indexed bookID,
  uint256 indexed slotIndex,
  address sourceContract,
  uint256 tokenID,
  uint32 slotFilledCount,
  uint32 totalFilledCount
);

event CollectionBookClaimed(
  address indexed user,
  uint256 indexed bookID,
  uint8 rewardKind,
  uint256 rewardData
);
```

## Subgraph Schema Additions

Add `luckyNumber` to the existing ticket entity:

```graphql
type NewTicketStatus @entity(immutable: false) {
  luckyNumber: BigInt
}
```

Add V2 price field while preserving the old field:

```graphql
type NewSeries @entity(immutable: false) {
  priceInUSDTWei: BigInt!
  priceInPoints: BigInt
}
```

Add Collection Book entities:

```graphql
type CollectionBook @entity {
  id: Bytes!
  bookID: BigInt!
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

type CollectionBookSlot @entity {
  id: Bytes!
  book: CollectionBook!
  bookID: BigInt!
  slotIndex: BigInt!
  sourceContract: Bytes!
  seriesID: BigInt!
  prizeID: BigInt!
  quantity: BigInt!
}

type CollectionBookUserProgress @entity {
  id: Bytes!
  user: Bytes!
  book: CollectionBook!
  bookID: BigInt!
  filledCount: BigInt!
  claimed: Boolean!
  updatedAt: BigInt!
}

type CollectionBookSlotProgress @entity {
  id: Bytes!
  user: Bytes!
  bookID: BigInt!
  slotIndex: BigInt!
  filledCount: BigInt!
}

type CollectionBookDeposit @entity {
  id: Bytes!
  user: Bytes!
  bookID: BigInt!
  slotIndex: BigInt!
  sourceContract: Bytes!
  tokenID: BigInt!
  deposited: Boolean!
  updatedAt: BigInt!
}

type CollectionBookClaim @entity(immutable: true) {
  id: Bytes!
  user: Bytes!
  bookID: BigInt!
  rewardKind: Int!
  rewardData: BigInt!
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
}
```

## GraphQL Query Documentation Updates

Update `/Users/angustsai/ichichain/docs/graphql-queries.md` with:

- `priceInPoints` on series detail queries.
- `luckyNumber` on ticket queries where useful.
- Collection Book query group:
  - active books
  - book detail with slots
  - user progress by wallet
  - deposited token lookup
  - user claim history

Existing frontend queries can keep using `newSeries_collection`, `newTicketStatuses`, `revealDrawSents`, and `revealDrawFulfilleds`. New frontend code should prefer `priceInPoints` over `priceInUSDTWei`.

## Subgraph Mapping Updates

- Replace data source address with the UUPS proxy address.
- Regenerate ABI from `DOUDOCHAINV2Upgradeable`.
- Update `handleNewTicketStatus` to read `luckyNumber`.
- Update `handleNewSeries` to set both `priceInUSDTWei` and `priceInPoints` from the event value.
- Keep `handleRevealDrawSent` and `handleRevealDrawFulfilled` flow.
- Keep `getSubPrizesDetail(seriesID)` call in fulfilled handler.
- Add `CollectionBookUpgradeable` data source with handlers for all Collection Book events.

## Tests

Contract tests:

- Proxy initializes once and rejects re-initialization.
- Only `UPGRADER_ROLE` can upgrade.
- Upgrade preserves series, tickets, request, and collection book state.
- VRF config update emits `VrfConfigUpdated`.
- Pending request from old coordinator can still fulfill after config update.
- `AdminMint` bypasses points burn, wallet cap, and mint lock while consuming inventory.
- Compatibility events emit with expected payloads.
- `NewTicketStatus` stores lucky number in subgraph-facing event.
- Collection Book events contain enough data to rebuild book state.

Subgraph tests:

- Existing series and token queries continue to resolve.
- `priceInPoints` is available.
- `luckyNumber` is indexed.
- Collection Book active books, slots, user progress, deposits, and claims can be queried.

## Deployment Sequence

1. Deploy `DOUDOCHAINV2Upgradeable` proxy.
2. Deploy `CollectionBookUpgradeable` proxy.
3. Grant `COLLECTION_BOOK_ROLE` on DOUDOCHAIN to CollectionBook proxy.
4. Grant DOUDOCHAIN `BURNER_ROLE` and `MINTER_ROLE` on DOUDOCOIN.
5. Add DOUDOCHAIN proxy address as Chainlink VRF subscription consumer.
6. Deploy/update subgraph data sources to use proxy addresses.
7. Update frontend GraphQL docs and queries for `priceInPoints`, lucky numbers, and Collection Book.

## Implementation Plan Boundary

This design is ready for an implementation plan. The implementation should be split into contract, deployment script, subgraph, and frontend documentation tasks so bytecode size and indexing compatibility can be verified independently.
