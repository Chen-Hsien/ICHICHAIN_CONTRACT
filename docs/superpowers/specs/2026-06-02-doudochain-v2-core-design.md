# DOUDOCHAIN V2 — Core Lottery Design

## Status

Draft for review. Part of the **DOUDOCHAIN V2 (Arbitrum) redesign**. Sibling specs: DOUDOCOIN Soulbound Points · Collection Book · DOUDO Points Economy.

This is the critical-path contract. It is a fresh **V2 deployment** (the current contract is immutable; no proxy).

## Context

`contracts/DOUDOCHAIN.sol` is an ERC721A ichiban-kuji lottery (fork of ICHICHAIN). The redesign moves payment to **soulbound DOUDO points (burn-to-spend)**, removes the broken/irrelevant native+oracle machinery on Arbitrum, and adds reservation locks, lucky numbers, bundles, refunds, burn-to-redraw with a consolation pool, an efficient series-membership model, and operational safety.

## Decisions Locked (from product owner)

- **Payment = burn DOUDO points only.** Each series stores `priceInPoints` (18-dp DOUDO units). Remove `mintByMatic`, Chainlink price feeds/oracle, `Currency`/`currencyList`, and all USDT/rate/decimals conversion. `priceInTWD` stays as display-only metadata. Crypto payment can be re-added later if needed.
- **Stay on ERC721A** (`erc721a@4.2.3`): batch mint is the high-frequency path. Prefer lock-over-burn only where items are *collected* (Collection Book); *consumed* items (redraw) are burned.
- **Bundle**: keep "charge 1600, rebate 100" semantics but as a single **atomic** contract operation (burn 1600 points, mint 100 points back), plus a consolation-pool draw entry.
- **Punch-card** is frontend-only: it visualizes accumulated rebate points as progress toward the next **consolation-pool draw** (not a free main-pool draw — avoids a long demotivating grind).
- **Reservation lock**: after a mint, the series is reserved to that wallet for a configurable window (default 15 min); only that wallet may mint that series until it expires.
- **Lucky number**: per-series opt-in; user picks number(s) in `[1, totalTicketNumbers]`; contract enforces uniqueness. No DB — The Graph indexes it.
- **Refund**: only when an operator has flagged the series refundable; user burns the unrevealed ticket and is made whole in points.
- **Burn-to-redraw**: two channels (main pool / cheaper consolation pool), per-series configurable burn counts; burned (not locked).
- **Series membership**: range-based; drop the unbounded `seriesTokens` array.
- **Pausable**; single global **EIP-2981** royalty (optional, low priority, droppable if bytecode-tight); rename `ICHISeries` → `doudoSeries`; `withdraw` (native) unchanged.

## Architecture Overview

- ERC721A + AccessControl + ReentrancyGuard + Pausable (+ optional ERC2981), VRFConsumerBaseV2Plus.
- Spends points by calling `IDoudoPoints(doudo).burnFrom(user, amount)` (requires `BURNER_ROLE` on DOUDOCOIN).
- Reward/rebate points by calling `IDoudoPoints(doudo).mint(user, amount)` (requires `MINTER_ROLE` on DOUDOCOIN).
- VRF unchanged in principle (reveal, last prize), plus redraw requests.

## Detailed Design

### 1. Payment: points-only, price-in-points

- `Series` adds `uint256 priceInPoints;` and drops reliance on `priceInUSDTWei` for charging (`priceInTWD` kept for display).
- Remove: `mintByMatic`, `getChainlinkDataFeedLatestAnswer`, `AggregatorV3Interface`/Chainlink imports, `Currency`, `currencyList`, `addCurrencyToken`. Keep a generic `rescueERC20(token, amount)` (`onlyOwner`) in case tokens are accidentally sent; `withdraw` (native) unchanged.
- Core internal `_drawMint(seriesID, to, luckyNumbers, pointsToBurn)` shared by all paid entry points: checks → `burnFrom(to, pointsToBurn)` → `_safeMint` → per-token bookkeeping → events.

### 2. Single mint entry + bundles

- `mint(uint256 seriesID, uint16[] calldata luckyNumbers)` — `quantity = luckyNumbers.length` when the series uses lucky numbers; otherwise pass an array sized to the desired quantity with sentinel `0`s, or a separate `mint(seriesID, quantity)` overload for non-lucky series. Burns `quantity * priceInPoints`.
- `mintBundle(uint256 seriesID, uint256 bundleIndex, uint16[] calldata luckyNumbers)` — per-series bundle table:
  - `struct Bundle { uint32 quantity; uint256 pricePoints; uint256 rebatePoints; uint16 consolationDraws; }`
  - `mapping(uint256 => Bundle[]) public seriesBundles;` set by `OPERATION_ROLE`.
  - Atomic: `burnFrom(user, pricePoints)`; mint `quantity` tickets; `mint(user, rebatePoints)`; credit `consolationDraws` to the user's consolation entries (see §8). Example: 5-draw bundle → burn 1600, mint 100 back, +1 consolation draw.

### 3. Reservation lock

- State: `mapping(uint256 => address) public mintLockOwner;` `mapping(uint256 => uint256) public mintLockUntil;` `uint256 public defaultLockDuration = 900;` optional `mapping(uint256 => uint256) public seriesLockDuration;` (0 ⇒ use default).
- On every paid mint: if `block.timestamp < mintLockUntil[s] && msg.sender != mintLockOwner[s]` → revert `SeriesReserved()`. Else set `mintLockOwner[s] = msg.sender; mintLockUntil[s] = block.timestamp + duration` (refresh).
- Only locks while `remainingTicketNumbers > 0`. `AdminMint` bypasses. Operator `clearMintLock(seriesID)` and `setLockDuration(...)`.
- Arbitrum sequencer `block.timestamp` is monotonic and ~real-time; 15-minute granularity is safe from minor manipulation.

### 4. Lucky numbers

- `Series` adds `bool useLuckyNumber;`. Per-token: `TicketStatus` adds `uint16 luckyNumber;`.
- Uniqueness: `mapping(uint256 => mapping(uint16 => bool)) public luckyNumberUsed;`.
- When `useLuckyNumber`: each value in `luckyNumbers` must be in `[1, totalTicketNumbers]` and unused; mark used; revert `LuckyNumberTaken()` / `LuckyNumberOutOfRange()`. Cost: one extra SSTORE + check per ticket (accepted).
- The Graph indexes `luckyNumber` from `NewTicketStatus`; no DB needed.

### 5. maxPerWallet

- `mapping(uint256 => uint256) public seriesMaxPerWallet;` (0 = unlimited); `mapping(uint256 => mapping(address => uint256)) public mintedPerWallet;`. Enforced on paid mints, incremented by quantity. `AdminMint` bypasses. Note: a soft control (defeatable by multiple wallets), acceptable for launch.

### 6. Reveal (VRF)

- Unchanged selection logic, plus: **hard cap** `require(tokenIDs.length <= 20)` (`MAX_REVEAL_BATCH = 20`); make `callbackGasLimit` settable and/or scale with `numWords`. Gated by `whenNotPaused`.

### 7. Refund (operator-gated, points restored)

- `seriesRefund(seriesID)` (`OPERATION_ROLE`) sets `isRefund = true` (only before goods arrived). **Only a refund-flagged series allows refund/burn.**
- Store per-token points paid: `mapping(uint256 => uint256) public pointsPaid;` (set at mint; bundle tickets store their effective per-ticket points).
- `claimRefund(uint256[] calldata tokenIDs)` (`nonReentrant`): for each token require `isRefund`, `ownerOf == msg.sender`, `!tokenRevealed`, not already refunded; `_burn(tokenId)`; accumulate points; then `IDoudoPoints(doudo).mint(msg.sender, totalPoints)`. Errors: `SeriesNotRefundable()`, `AlreadyRefunded()`. (Equivalent: mint the corresponding points fresh — product owner accepts either; we restore the exact `pointsPaid`.)

### 8. Consolation pool, bundles' bonus, and punch-card payout

- Separate inventory from the main A–H prize pool: `mapping(uint256 => subPrize[]) public consolationPrizes;` (or a global pool) funded by the operator; cost is fully decoupled from the fixed main pool.
- `mapping(address => uint256) public consolationDraws;` — entries credited by bundles (§2) and by punch-card redemption.
- Punch-card: rebate points accumulate as normal DOUDO balance; the frontend shows progress. Redemption `redeemPointsForConsolationDraw()` burns `consolationDrawCostPoints` (low, settable) → +1 `consolationDraws`. This keeps reward frequency high at controlled cost (vs. grinding to a full main draw).
- `drawConsolation(uint32 count)` spends `consolationDraws` and requests VRF against `consolationPrizes`.

### 9. Burn-to-redraw (two channels, burned)

- Per series: `uint16 redrawMainBurnCount;` (e.g., 8–10) and `uint16 redrawConsolationBurnCount;` (e.g., 3–4); 0 = disabled.
- Eligible inputs: tokens that are **revealed, unexchanged, owned by caller, in this series**.
- `redrawMain(seriesID, tokenIDs)`: require `tokenIDs.length == redrawMainBurnCount`; `_burn` them; **return their prize slots to the main pool** (`subPrizeRemainingQuantity += 1` each) so there is inventory to draw; request 1 VRF draw from the main pool. Net main pool change: `+(N-1)` slots removed from circulation, user gets 1 fresh prize.
- `redrawConsolation(seriesID, tokenIDs)`: require length == `redrawConsolationBurnCount`; `_burn` them (pure sink); request 1 VRF draw from the **consolation pool** (separately funded).
- Invariant: every path that consumes or returns a prize updates the relevant pool total; redraw respects `whenNotPaused` and the reveal hard cap.

### 10. Series membership: ID ranges

- Keep `ticketStatusDetail[tokenId].seriesID` (needed by reveal/tokenURI; one cheap SSTORE at mint).
- Drop `seriesTokens` array and its per-token `push`. Add `mapping(uint256 => TokenRange[]) public seriesRanges;` (`struct TokenRange { uint256 start; uint256 end; }`), extending the last range on contiguous mints.
- Last prize: compute total from range sizes, pick a random index, map back to a concrete tokenId via ranges — no whole-array memory copy.
- **Burn interaction guard**: refunds/redraws/book `_burn` create gaps. Last-prize selection must verify the chosen tokenId still exists (`_exists`) and **re-roll** if burned (or sequence: only allow last-prize before burns). This invariant is documented and tested.

### 11. Pausable, royalty, rename, roles

- `Pausable`: `pause()/unpause()` (`OPERATION_ROLE`); gate `mint`, `mintBundle`, `reveal`, `exchangePrize`, `redrawMain`, `redrawConsolation`, `drawConsolation`. Admin/operator config and `AdminMint` not gated.
- `ERC2981`: one global `setDefaultRoyalty` (`OPERATION_ROLE`); update `supportsInterface`. Lowest priority; drop if the contract approaches the 24KB limit (removing the oracle/currency machinery frees ample room, so it should fit).
- Rename public `ICHISeries` → `doudoSeries` (update scripts; breaking for external readers — fresh deploy + our frontend/subgraph update).
- `withdraw` (native) unchanged per decision.

## Error Handling & Edge Cases

- New errors: `SeriesReserved`, `LuckyNumberTaken`, `LuckyNumberOutOfRange`, `WalletCapExceeded`, `SeriesNotRefundable`, `AlreadyRefunded`, `RedrawCountMismatch`, `NotEligibleForRedraw`.
- Burn-heavy paths are opt-in/low-frequency (ERC721A burn cost acceptable); the hot path (batch mint) stays cheap.
- Reentrancy: refunds/redraws update state and burn before external point mints; `nonReentrant` retained.
- Points spend failures (insufficient balance) bubble up from `burnFrom`.

## Testing Strategy

Mirror current behavior first, then new behavior. Key cases: points burn on mint; bundle atomic burn+rebate+consolation; reservation lock (lock, refresh, expiry, admin clear, AdminMint bypass); lucky-number uniqueness/range and multi-mint arrays; maxPerWallet; reveal hard cap 20; refund only when flagged + points restored + double-claim rejected; both redraw channels with pool accounting invariants; range-based last prize with burned-token reroll; pause gating; royalty interface.

## Deployment & Migration Notes

- Fresh V2 deploy. Grant V2 `MINTER_ROLE` + `BURNER_ROLE` on DOUDOCOIN. Update VRF consumer. Update scripts to set `priceInPoints`, bundles, lock duration, lucky-number flag, caps, consolation inventory, redraw counts.

## Open Questions

1. Consolation pool: per-series or one global pool? (Default: per-series for clean accounting; revisit if ops prefer one shared pool.)
2. `consolationDrawCostPoints` and bundle `rebatePoints`/`consolationDraws` defaults (economy spec will tune).
3. Non-lucky-number series mint signature: overload `mint(seriesID, quantity)` vs always-array. (Default: provide both.)
