# DOUDOCHAIN V2 Module Split Design

## Status

Design approved for documentation on 2026-06-03.

This document replaces the single-contract UUPS implementation target for the next full V2 deployment. The deployed Arbitrum Sepolia `DOUDOCHAINV2Upgradeable` remains useful for reveal-speed testing, but it does not contain the complete business surface. The next full deployment should use the split architecture below.

## Goals

- Preserve the complete DOUDOCHAIN V2 business spec.
- Keep `DOUDOCHAINV2CoreUpgradeable` and `CollectionBookUpgradeable` behind UUPS proxies.
- Split optional business flows into UUPS modules so each implementation stays comfortably below the EIP-170 bytecode limit.
- Restore Chainlink's official `VRFConsumerBaseV2Plus` guard by moving VRF into a dedicated router contract.
- Keep VRF settlement atomic: the Chainlink fulfillment transaction must also settle the prize or redraw result.
- Keep The Graph as the canonical read model and preserve the existing core event flow wherever practical.
- Keep DOUDOCOIN as points-only and non-transferable.
- Remove old on-chain aggregate pagination views and rely on events/subgraph queries for lists.

## Non-Goals

- Do not support old currency-token payment flows in V2.
- Do not reintroduce Chainlink price feeds for mint payment.
- Do not make the VRF callback store randomness for a later manual settlement step.
- Do not keep large on-chain list/pagination view functions such as series token lists, owner token lists, or paginated series aggregation.
- Do not require the old frontend queries to stay byte-for-byte unchanged when V2 adds new fields; the subgraph may normalize new event fields into the existing entities.

## Contract Set

### DOUDOCOIN

`DOUDOCOIN` remains the points token.

- ERC20-compatible balance and allowance behavior.
- Transfers are disabled except mint/burn flows needed for operation.
- Official operations wallet keeps mint authority for fiat/order-based point issuance.
- Core and modules receive only the mint/burn permissions they need.
- The token itself does not own lottery state.

### DOUDOCHAINV2CoreUpgradeable

Core owns the NFT and the canonical lottery state.

Responsibilities:

- ERC721A ticket minting and burning.
- Series creation and batch series creation.
- Series metadata, delivery, preorder, refund flag, and lucky-number settings.
- Sub-prize inventory for main reveal draws.
- Points-only paid mint.
- Admin mint / airdrop mint.
- Reveal request context and reveal settlement.
- Last-prize request context and settlement.
- Canonical ticket status, prize status, and series events.
- Module-only primitives for bundle, refund, redraw, and collection reward modules.

The Core should be intentionally narrow. It should expose enough module entrypoints for trusted modules to mutate NFT/ticket/prize state, but modules should not duplicate series or ticket storage.

Suggested roles:

- `DEFAULT_ADMIN_ROLE`: official operations/deployer wallet.
- `UPGRADER_ROLE`: official operations/deployer wallet.
- `OPERATION_ROLE`: series, metadata, VRF router address, and operational config.
- `ADMINMINT_ROLE`: airdrop/admin ticket minting.
- `MODULE_ROLE`: approved modules that can call module primitives.
- `VRF_ROUTER_ROLE`: the active VRF router callback address.

Core module primitives:

- `moduleMintUnrevealed(...)`
- `moduleMintRevealed(...)`
- `moduleBurnForRefund(...)`
- `moduleBurnForRedraw(...)`
- `moduleReturnMainPrize(...)`
- `moduleSetSeriesRefund(...)`
- `moduleUnlockSeriesFor(...)`

Every primitive that changes series, ticket, or prize state must emit the same canonical Core event that a direct Core action would emit.

### DoudoVRFRouter

`DoudoVRFRouter` is a dedicated Chainlink consumer. It should inherit:

```solidity
VRFConsumerBaseV2Plus
```

This contract should not be a UUPS proxy. Chainlink's V2 Plus base uses constructor initialization and `ConfirmedOwner`; using it directly in an upgradeable Core would create unnecessary proxy/storage risk. The router can be redeployed if the VRF integration shape changes.

Responsibilities:

- Store VRF request config:
  - `keyHash`
  - `subscriptionId`
  - `callbackGasLimit`
  - `requestConfirmations`
  - `nativePayment = false`
- Request random words from Chainlink V2 Plus.
- Use Chainlink's official `rawFulfillRandomWords` coordinator-only guard.
- Dispatch fulfillment to the original authorized callback target in the same transaction.
- Emit VRF config and request lifecycle events for The Graph.

Authorized requesters:

- `DOUDOCHAINV2CoreUpgradeable`
- `DoudoRedrawModuleUpgradeable`
- Any future module explicitly granted requester permission.

Callback target interface:

```solidity
interface IDoudoVRFCallback {
    function fulfillRandomWordsFromRouter(
        uint256 requestId,
        uint256[] calldata randomWords
    ) external;
}
```

Router flow:

```text
Core or module
  -> DoudoVRFRouter.requestRandomWords(callbackTarget, numWords)
  -> Chainlink VRF Coordinator
  -> DoudoVRFRouter.rawFulfillRandomWords(...)
  -> DoudoVRFRouter.fulfillRandomWords(...)
  -> callbackTarget.fulfillRandomWordsFromRouter(...)
  -> Core/module settles prize in the same transaction
```

Coordinator updates:

- The router should expose an operations-only setter that updates inherited `s_vrfCoordinator` and emits both Chainlink-compatible and project-specific config events.
- Operators should use the project setter for normal coordinator/config changes. The inherited Chainlink `setCoordinator(...)` remains available to the router owner/coordinator for migration compatibility, so the subgraph should also listen to Chainlink's `CoordinatorSet` event.
- Pending requests must be allowed to settle before changing coordinator, because `VRFConsumerBaseV2Plus` validates fulfillment against the current coordinator.
- `keyHash`, `subscriptionId`, `callbackGasLimit`, and `requestConfirmations` may be updated independently by operations.

Chainlink dashboard consumer:

- The VRF subscription consumer address must be the `DoudoVRFRouter` address, not the Core proxy address.

### DoudoBundleModuleUpgradeable

Bundle module owns bundle purchase rules and bundle mint orchestration.

Responsibilities:

- `setSeriesBundles(...)`
- `mintBundle(...)`
- Validate bundle availability, price, per-wallet caps, sale state, and remaining inventory.
- Burn DOUDOCOIN points for bundle purchases.
- Mint unrevealed tickets through Core module primitives.
- Mint rebate points when configured.
- Credit consolation-draw balances through the redraw module when configured.
- Emit bundle-specific events.

Core remains the source of truth for ticket IDs, ticket owner, ticket status, and series remaining ticket count.

### DoudoRefundModuleUpgradeable

Refund module owns refund eligibility and claim execution.

Responsibilities:

- `setSeriesRefund(...)`
- `claimRefund(...)`
- Validate series refund state.
- Burn or mark refunded tickets through Core module primitives.
- Mint refund points through DOUDOCOIN.
- Emit refund-specific events.

Core emits canonical ticket burn/status and series refund events.

### DoudoRedrawModuleUpgradeable

Redraw module owns redraw economics and redraw request contexts.

Responsibilities:

- `setRedrawConfig(...)`
- `redrawMain(...)`
- `redrawConsolation(...)`
- `drawConsolation(...)`
- Track consolation draw credits.
- Track redraw request kind, series, user, and burned inputs.
- Request VRF through `DoudoVRFRouter`.
- Settle redraw results during router fulfillment.
- Call Core module primitives to burn inputs, return main-prize inventory, mint replacement tickets, and emit canonical ticket/prize events.
- Emit redraw-specific events.

Main redraw must return burned main-prize inventory before drawing again. Consolation redraw must draw only from the consolation inventory or configured consolation pool.

### DoudoCollectionRewardModuleUpgradeable

Collection reward module connects Collection Book claims to Core rewards.

Responsibilities:

- `setCollectionRewardConfig(...)`
- `mintCollectionReward(...)`
- `unlockSeriesFor(...)`
- Validate Collection Book claim authority.
- Mint point rewards through DOUDOCOIN.
- Mint NFT prize rewards through Core module primitives.
- Unlock series access through Core module primitives.
- Emit reward-specific events.

The Collection Book should point to this module as reward target instead of pointing directly to Core.

### CollectionBookUpgradeable

Collection Book remains UUPS-upgradeable and event-first.

Responsibilities:

- Create collection books.
- Define slots and accepted prize requirements.
- Deposit and withdraw eligible DOUDOCHAIN tickets.
- Mark collection completion and claim status.
- Call the configured reward target.
- Emit events for every state transition needed by The Graph.

Collection Book does not own lottery randomness, series setup, or paid minting.

## Business Function Coverage

| Function area | Contract owner | Notes |
| --- | --- | --- |
| Points-only payment | Core, BundleModule, RefundModule | DOUDOCOIN is the only payment unit. |
| Non-transferable DOUDOCOIN | DOUDOCOIN | Transfers remain disabled for users. |
| Atomic series creation | Core | Series and sub-prizes are created together with quantity validation. |
| Batch series creation | Core | Batch function loops the same atomic validation per series. |
| Metadata editable after goods arrived | Core | Operations can update URIs and operational fields after arrival. |
| Paid mint | Core | Burns points and mints unrevealed tickets. |
| Admin mint / airdrop | Core | Mints tickets without payment under `ADMINMINT_ROLE`. |
| Reveal | Core + VRFRouter | Request and settlement remain atomic inside VRF fulfillment. |
| Last prize | Core + VRFRouter | Winner selection remains atomic inside VRF fulfillment. |
| Bundle mint | BundleModule + Core | Module handles economics; Core emits ticket events. |
| Refund | RefundModule + Core | Module handles refund points; Core emits ticket/series events. |
| Main redraw | RedrawModule + Core + VRFRouter | Burn inputs, return inventory, request VRF, settle replacement. |
| Consolation draw/redraw | RedrawModule + Core + VRFRouter | Uses consolation inventory/credits. |
| Collection Book point reward | CollectionBook + CollectionRewardModule + DOUDOCOIN | Reward module mints points. |
| Collection Book NFT reward | CollectionBook + CollectionRewardModule + Core | Core mints canonical ticket/prize state. |
| Collection Book unlock reward | CollectionBook + CollectionRewardModule + Core | Core stores unlock state and emits unlock event. |

## VRF Speed And Safety

The split does not intentionally add block waiting. The same `requestConfirmations = 0` setting can be used on Arbitrum Sepolia.

The added router call consumes some gas, but the callback is still one transaction:

```text
Chainlink fulfill transaction
  -> Router official coordinator check
  -> Router dispatch
  -> Core/module settlement
```

This preserves the security property that randomness is consumed before any operator can inspect it and choose whether to settle.

Operational requirements:

- Default `callbackGasLimit` should start at `2_500_000` or above if test results show the extra router/module calls need more.
- The test suite must include callback gas-sensitive flows for reveal, last prize, main redraw, and consolation draw.
- If a fulfillment fails from gas limit, increase `callbackGasLimit` and retry through Chainlink's normal retry behavior where available.
- If `requestRandomWords` reverts, the user transaction reverts and tickets remain unrevealed.
- Coordinator changes should be rare and should happen only after pending requests are settled.

## The Graph Compatibility

The Graph must index multiple data sources:

- `DOUDOCHAINV2CoreUpgradeable` proxy
- `DoudoVRFRouter`
- `DoudoBundleModuleUpgradeable` proxy
- `DoudoRefundModuleUpgradeable` proxy
- `DoudoRedrawModuleUpgradeable` proxy
- `DoudoCollectionRewardModuleUpgradeable` proxy
- `CollectionBookUpgradeable` proxy

Cross-contract logs in one transaction are indexable. When a module triggers Core state changes, Core still emits the canonical Core events from the Core proxy address. Module events should be used for module-specific economics and UI history, not as substitutes for Core ticket/prize state.

### Canonical Core Events

Core should keep these event names and roles in the read model:

```solidity
event NewSeries(
    uint256 indexed seriesID,
    string seriesName,
    uint256 totalTicketNumbers,
    uint256 priceInUSDTWei,
    bool isGoodsArrived,
    uint256 estimateDeliverTime,
    uint256 exchangeExpire,
    string exchangeTokenURI,
    string unrevealTokenURI,
    string revealTokenURI,
    string seriesMetaDataURI,
    uint256 priceInTWD,
    bool isRefund,
    bool isPreOrder
);

event NewSubPrize(
    uint256 indexed seriesID,
    uint256 subPrizeID,
    string prizeGroup,
    string subPrizeName,
    uint256 subPrizeRemainingQuantity
);

event NewTicketStatus(
    uint256 indexed seriesID,
    uint256 indexed tokenID,
    uint256 tokenRevealedPrize,
    bool tokenExchange,
    bool tokenRevealed,
    address tokenOwner,
    uint16 luckyNumber
);

event RevealDrawSent(uint256 requestId, uint256[] tokenIDs);
event RevealDrawFulfilled(uint256 requestId, uint256 seriesID, uint256[] randomWords);
event UpdatePrize(uint256 indexed seriesID, uint256 subPrizeID, uint256 remainingQuantity);
event UpdateTicketStatus(uint256 indexed seriesID, uint256 indexed tokenID, uint256 tokenRevealedPrize, bool tokenExchange, bool tokenRevealed);
event UpdateSeriesInformation(uint256 indexed seriesID, bool isGoodsArrived, uint256 estimateDeliverTime, uint256 exchangeExpire, string exchangeTokenURI, string unrevealTokenURI, string revealTokenURI, string seriesMetaDataURI);
event UpdateSeriesRemainingTicketNumbers(uint256 indexed seriesID, uint256 remainingTicketNumbers);
event LastPrizeDraw(uint256 requestId, uint256 indexed seriesID, uint256 quantity);
event LastPrizeWinner(uint256 indexed seriesID, uint256[] tokenIDs);
event UpdateSeriesLastPrizeOwner(uint256 indexed seriesID, address[] owners);
event AdminMinted(uint256 indexed seriesID, address indexed to, uint256 quantity, uint256 firstTokenId);
```

`priceInUSDTWei` is retained in the event for frontend/subgraph compatibility, but V2 should document it as `priceInPoints`.

### Router Events

```solidity
event CoordinatorSet(address vrfCoordinator);

event VrfConfigUpdated(
    address indexed vrfCoordinator,
    uint256 subscriptionId,
    bytes32 keyHash,
    uint32 callbackGasLimit,
    uint16 requestConfirmations,
    address indexed operator
);

event VrfRandomWordsRequested(
    uint256 indexed requestId,
    address indexed requester,
    address indexed callbackTarget,
    uint32 numWords
);

event VrfRandomWordsFulfilled(
    uint256 indexed requestId,
    address indexed callbackTarget
);
```

Subgraph use:

- Track active VRF config.
- Track request target and request status.
- Join with Core or module fulfillment events by `requestId`.

### Bundle Events

```solidity
event BundleConfigured(uint256 indexed seriesID, uint256 indexed bundleID, uint256 ticketQuantity, uint256 priceInPoints, uint256 rebatePoints, uint256 consolationDrawCredits, bool active);
event BundleMinted(uint256 indexed seriesID, uint256 indexed bundleID, address indexed buyer, uint256 quantity, uint256 firstTokenID);
```

Core still emits `NewTicketStatus` and `UpdateSeriesRemainingTicketNumbers` for tickets minted by a bundle.

### Refund Events

```solidity
event RefundSeries(uint256 indexed seriesID, bool isRefund, uint256 refundPoints);
event RefundClaimed(uint256 indexed seriesID, address indexed user, uint256[] tokenIDs, uint256 refundPoints);
```

Core still emits ticket status/burn events required to remove or mark refunded tickets in The Graph.

### Redraw Events

```solidity
event RedrawConfigUpdated(uint256 indexed seriesID, uint16 mainBurnCount, uint16 consolationBurnCount);
event RedrawRequested(uint256 indexed requestId, uint256 indexed seriesID, address indexed user, bool consolation);
event RedrawFulfilled(uint256 indexed requestId, uint256 indexed seriesID, address indexed user, uint256 tokenID, bool consolation);
event ConsolationDrawBalanceUpdated(uint256 indexed seriesID, address indexed user, uint256 balance);
```

Core still emits `UpdatePrize`, `UpdateTicketStatus`, and `NewTicketStatus` when redraw burns, returns inventory, or mints replacement tickets.

### Collection Reward Events

```solidity
event CollectionRewardConfigSet(uint256 indexed collectionBookID, uint8 rewardKind, uint256 pointsAmount, uint256 seriesID, uint256 subPrizeID, bool active);
event CollectionRewardMinted(uint256 indexed collectionBookID, address indexed user, uint8 rewardKind, uint256 amount, uint256 tokenID);
event SeriesUnlockedFor(uint256 indexed seriesID, address indexed user, uint256 expires);
```

Collection Book remains the source for collection progress and claim events.

### Collection Book Events

Collection Book should preserve event-first indexing:

```solidity
event CollectionBookCreated(uint256 indexed collectionBookID, string name, bool active);
event CollectionBookSlotDefined(uint256 indexed collectionBookID, uint256 indexed slotID, uint256 requiredSeriesID, uint256 requiredPrizeID);
event CollectionBookStatusUpdated(uint256 indexed collectionBookID, bool active);
event CollectionBookRewardTargetUpdated(address indexed rewardTarget);
event CollectionBookSlotFilled(uint256 indexed collectionBookID, uint256 indexed slotID, address indexed user, uint256 tokenID);
event CollectionBookSlotEmptied(uint256 indexed collectionBookID, uint256 indexed slotID, address indexed user, uint256 tokenID);
event CollectionBookClaimed(uint256 indexed collectionBookID, address indexed user);
```

## Frontend Query Mapping

Existing core queries can continue to be backed by Core events:

| Existing query/read model | Source after split | Change |
| --- | --- | --- |
| Series list/detail | Core `NewSeries`, `UpdateSeriesInformation`, `UpdateSeriesRemainingTicketNumbers` | Treat `priceInUSDTWei` as points. |
| Sub-prize inventory | Core `NewSubPrize`, `UpdatePrize` | No module substitution. |
| Ticket status | Core `NewTicketStatus`, `UpdateTicketStatus` | Add `luckyNumber` from `NewTicketStatus`. |
| Reveal request | Core `RevealDrawSent` | Same read model. |
| Reveal fulfillment | Core `RevealDrawFulfilled` | Same read model. |
| Last-prize winners | Core `LastPrizeDraw`, `LastPrizeWinner`, `UpdateSeriesLastPrizeOwner` | Same read model. |
| Bundle history | BundleModule events + Core ticket events | New query/entity. |
| Refund history | RefundModule events + Core ticket events | New query/entity. |
| Redraw history | RedrawModule events + Core ticket events | New query/entity. |
| Collection progress | CollectionBook events | New query/entity if not already present. |
| Collection rewards | CollectionRewardModule events | New query/entity. |
| VRF health/config | VRFRouter events | New admin/ops query/entity. |

Frontend and backend integrations should prefer the subgraph for lists and history. Direct contract reads should be limited to focused checks such as current balance, role checks, approval state, or a specific known ID.

## Deployment And Wiring

Deployment order:

1. Deploy or reuse non-transferable `DOUDOCOIN`.
2. Deploy `DoudoVRFRouter` with Arbitrum Sepolia VRF coordinator.
3. Deploy UUPS `DOUDOCHAINV2CoreUpgradeable`.
4. Deploy UUPS modules:
   - `DoudoBundleModuleUpgradeable`
   - `DoudoRefundModuleUpgradeable`
   - `DoudoRedrawModuleUpgradeable`
   - `DoudoCollectionRewardModuleUpgradeable`
5. Deploy UUPS `CollectionBookUpgradeable`.
6. Wire contracts:
   - Set Core VRF router address.
   - Grant Core `MODULE_ROLE` to modules.
   - Grant Core `VRF_ROUTER_ROLE` to router.
   - Grant router requester permission to Core and RedrawModule.
   - Grant DOUDOCOIN burn/mint roles to Core/modules as needed.
   - Set Collection Book reward target to CollectionRewardModule.
   - Grant CollectionRewardModule permission to receive Collection Book reward calls.
7. Add `DoudoVRFRouter` as Chainlink VRF subscription consumer.
8. Verify contracts on Arbiscan.
9. Deploy subgraph with all proxy/router data sources.
10. Update the handoff document with deployed addresses and ABI paths.

Expected ABI locations after implementation:

```text
artifacts/contracts/DDOUDOCOIN.sol/DOUDOCOIN.json
artifacts/contracts/DOUDOCHAINV2CoreUpgradeable.sol/DOUDOCHAINV2CoreUpgradeable.json
artifacts/contracts/DoudoVRFRouter.sol/DoudoVRFRouter.json
artifacts/contracts/modules/DoudoBundleModuleUpgradeable.sol/DoudoBundleModuleUpgradeable.json
artifacts/contracts/modules/DoudoRefundModuleUpgradeable.sol/DoudoRefundModuleUpgradeable.json
artifacts/contracts/modules/DoudoRedrawModuleUpgradeable.sol/DoudoRedrawModuleUpgradeable.json
artifacts/contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol/DoudoCollectionRewardModuleUpgradeable.json
artifacts/contracts/CollectionBookUpgradeable.sol/CollectionBookUpgradeable.json
```

## Testing Requirements

Contract tests must cover:

- Upgrade initializer protections.
- UUPS authorization for Core, modules, and Collection Book.
- DOUDOCOIN non-transferability.
- Atomic series creation and batch validation.
- Metadata edits after goods-arrived state.
- Paid mint and admin mint.
- Reveal request and fulfillment through Chainlink-style router mock.
- Last prize through router fulfillment.
- Bundle configuration and mint.
- Refund claim.
- Main redraw and consolation redraw.
- Collection Book deposit, withdrawal, claim, and reward target calls.
- The Graph event expectations for Core and module events.
- Bytecode size for every implementation.

Verification commands must include:

```text
npm test
npx hardhat size-contracts
```

Deployment scripts must include a post-deploy role/config assertion step so incorrect wiring fails immediately.

## Implementation Plan Boundary

This design is ready for a separate implementation plan after review. The implementation should be split into contract modules, tests, deployment scripts, and subgraph documentation updates. The currently deployed partial Arbitrum Sepolia V2 contracts should not be treated as the full business-spec deployment.
