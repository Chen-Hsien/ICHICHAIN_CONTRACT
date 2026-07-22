# DOUDOCHAIN V2 Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a fresh split-module DOUDOCHAIN V2 contract suite that preserves the full business spec and keeps The Graph indexable.

**Architecture:** Use a new deployment, not an upgrade of the currently deployed partial Core proxy. `DOUDOCHAINV2CoreUpgradeable` owns ERC721A tickets, series, sub-prizes, reveal, last prize, and canonical events. `DoudoVRFRouter` is a non-proxy Chainlink `VRFConsumerBaseV2Plus` consumer. Bundle, refund, redraw, and collection rewards live in separate UUPS modules that mutate Core through role-gated primitives.

**Tech Stack:** Solidity 0.8.20, Hardhat 2.28, ethers v6, OpenZeppelin UUPS 4.9, ERC721AUpgradeable 4.2, Chainlink VRF V2 Plus, Arbitrum Sepolia.

---

## Deployment Decision

Use **new deploy**.

Reasons:

- Split-module V2 introduces new contract addresses for router and modules.
- Chainlink VRF subscription consumer changes from Core proxy to `DoudoVRFRouter`.
- Existing deployed `DOUDOCHAINV2Upgradeable` is a partial reveal-speed test deployment and cannot become the full split suite through a single implementation upgrade.
- The Graph must index a different data-source set, so a new deployment/handoff is clearer for frontend and backend teams.

## Files

- Create: `contracts/interfaces/IDoudoVRFCallback.sol`
- Create: `contracts/interfaces/IDoudoVRFRouter.sol`
- Create: `contracts/interfaces/IDoudoCore.sol`
- Create: `contracts/DoudoVRFRouter.sol`
- Create: `contracts/DOUDOCHAINV2CoreUpgradeable.sol`
- Create: `contracts/modules/DoudoBundleModuleUpgradeable.sol`
- Create: `contracts/modules/DoudoRefundModuleUpgradeable.sol`
- Create: `contracts/modules/DoudoRedrawModuleUpgradeable.sol`
- Create: `contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol`
- Create: `test/doudochain-v2-module-split.test.js`
- Create: `scripts/deploySplitModuleArbSepolia.ts`
- Create: `scripts/verifySplitModuleArbSepolia.ts`
- Modify: `docs/doudochain-v2-upgradeable-handoff.md`

## Task 1: Failing Split-Suite Wiring Tests

- [ ] **Step 1: Write failing tests**

Create `test/doudochain-v2-module-split.test.js` with tests that deploy points, router, Core proxy, module proxies, and Collection Book proxy.

Required test names:

```javascript
it("wires the split suite with router consumer, core module roles, and collection reward target", async function () {});
it("reveals through the Chainlink router and settles in the same transaction", async function () {});
it("mints bundles through the bundle module while Core emits canonical ticket events", async function () {});
it("claims refunds through the refund module and burns tickets through Core", async function () {});
it("redraws a main prize through the redraw module and router", async function () {});
it("claims collection rewards through the collection reward module", async function () {});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npx hardhat test test/doudochain-v2-module-split.test.js
```

Expected: fails because split-suite contracts do not exist yet.

## Task 2: Router Interfaces And Chainlink Router

- [ ] **Step 1: Add router callback/request interfaces**

Create the two VRF interfaces with these method shapes:

```solidity
interface IDoudoVRFCallback {
    function fulfillRandomWordsFromRouter(uint256 requestId, uint256[] calldata randomWords) external;
}

interface IDoudoVRFRouter {
    function requestRandomWords(address callbackTarget, uint32 numWords) external returns (uint256 requestId);
}
```

- [ ] **Step 2: Implement `DoudoVRFRouter`**

Implement a non-upgradeable contract inheriting `VRFConsumerBaseV2Plus`.

Required behavior:

- Constructor accepts `vrfCoordinator`, `subscriptionId`, `keyHash`, `requestConfirmations`, and `callbackGasLimit`.
- Owner can grant/revoke requesters.
- Authorized requester calls `requestRandomWords(callbackTarget, numWords)`.
- Router stores `requestCallbackTarget[requestId]`.
- `fulfillRandomWords` dispatches to `IDoudoVRFCallback(callbackTarget).fulfillRandomWordsFromRouter(...)`.
- Emits `VrfConfigUpdated`, `VrfRandomWordsRequested`, and `VrfRandomWordsFulfilled`.

- [ ] **Step 3: Run router test**

Run:

```bash
npx hardhat test test/doudochain-v2-module-split.test.js --grep "router"
```

Expected: router wiring portions pass.

## Task 3: Split Core

- [ ] **Step 1: Implement `DOUDOCHAINV2CoreUpgradeable`**

Start from the current `DOUDOCHAINV2Upgradeable` behavior, then remove direct VRF coordinator storage and direct `rawFulfillRandomWords`. Add:

- `address public vrfRouter`
- `setVrfRouter(address router)`
- `fulfillRandomWordsFromRouter(uint256 requestId, uint256[] calldata randomWords)`
- `moduleMintUnrevealed(address to, uint256 seriesID, uint256 quantity)`
- `moduleMintRevealed(address to, uint256 seriesID, uint256 prizeID, uint16 luckyNumber)`
- `moduleBurnForRefund(uint256 tokenID, address owner)`
- `moduleBurnForRedraw(uint256 tokenID, address owner, bool returnMainPrize)`
- `moduleReturnMainPrize(uint256 seriesID, uint256 prizeID)`
- `moduleSetSeriesRefund(uint256 seriesID, bool isRefund)`
- `moduleUnlockSeriesFor(uint256 seriesID, address user, uint256 expires)`

Required events:

- Keep `NewSeries`, `NewSubPrize`, `NewTicketStatus` with `luckyNumber`, `RevealDrawSent`, `RevealDrawFulfilled`, `UpdatePrize`, `UpdateTicketStatus`, `UpdateSeriesInformation`, `UpdateSeriesRemainingTicketNumbers`, `LastPrizeDraw`, `LastPrizeWinner`, `UpdateSeriesLastPrizeOwner`, `AdminMinted`.
- Add `VrfRouterUpdated` and `SeriesUnlockedFor`.

- [ ] **Step 2: Run Core reveal tests**

Run:

```bash
npx hardhat test test/doudochain-v2-module-split.test.js --grep "reveals"
```

Expected: reveal through router passes and emits Core events.

## Task 4: Bundle Module

- [ ] **Step 1: Implement `DoudoBundleModuleUpgradeable`**

Required behavior:

- UUPS initializer stores Core, DOUDOCOIN, and optional RedrawModule addresses.
- `setSeriesBundles(uint256 seriesID, BundleInput[] calldata bundles)` stores bundle configs.
- `mintBundle(uint256 seriesID, uint256 bundleID, uint256 quantity)` burns points, calls Core `moduleMintUnrevealed`, optionally mints rebate points, and optionally credits consolation draws.
- Emits `BundleConfigured` and `BundleMinted`.

- [ ] **Step 2: Run bundle test**

Run:

```bash
npx hardhat test test/doudochain-v2-module-split.test.js --grep "bundles"
```

Expected: bundle mint passes and Core emits `NewTicketStatus`.

## Task 5: Refund Module

- [ ] **Step 1: Implement `DoudoRefundModuleUpgradeable`**

Required behavior:

- UUPS initializer stores Core and DOUDOCOIN.
- `setSeriesRefund(uint256 seriesID, bool isRefund, uint256 refundPointsPerTicket)` sets refund config and calls Core `moduleSetSeriesRefund`.
- `claimRefund(uint256[] calldata tokenIDs)` verifies all tickets share a refundable series, calls Core `moduleBurnForRefund`, and mints refund points.
- Emits `RefundSeries` and `RefundClaimed`.

- [ ] **Step 2: Run refund test**

Run:

```bash
npx hardhat test test/doudochain-v2-module-split.test.js --grep "refunds"
```

Expected: refund claim burns tickets and mints points.

## Task 6: Redraw Module

- [ ] **Step 1: Implement `DoudoRedrawModuleUpgradeable`**

Required behavior:

- UUPS initializer stores Core and Router.
- `setRedrawConfig(uint256 seriesID, uint16 mainBurnCount, uint16 consolationBurnCount)` stores burn counts.
- `creditConsolationDraws(uint256 seriesID, address user, uint256 amount)` is callable by BundleModule.
- `redrawMain(uint256 seriesID, uint256[] calldata tokenIDs)` burns inputs through Core, returns main prize inventory, requests one random word through Router, and stores request context.
- `redrawConsolation(uint256 seriesID, uint256[] calldata tokenIDs)` burns inputs through Core and requests one random word.
- `drawConsolation(uint256 seriesID)` spends one credited draw and requests one random word.
- `fulfillRandomWordsFromRouter(...)` mints a revealed replacement ticket through Core.
- Emits `RedrawConfigUpdated`, `RedrawRequested`, `RedrawFulfilled`, and `ConsolationDrawBalanceUpdated`.

- [ ] **Step 2: Run redraw test**

Run:

```bash
npx hardhat test test/doudochain-v2-module-split.test.js --grep "redraws"
```

Expected: redraw request fulfills through Router and Core emits replacement ticket events.

## Task 7: Collection Reward Module

- [ ] **Step 1: Implement `DoudoCollectionRewardModuleUpgradeable`**

Required behavior:

- UUPS initializer stores Core and DOUDOCOIN.
- `setCollectionRewardConfig(uint256 collectionBookID, RewardConfig calldata config)` stores reward config.
- `mintCollectionReward(address to, uint256 collectionBookID)` mints point rewards or revealed NFT prize rewards.
- `unlockSeriesFor(address user, uint256 seriesID)` unlocks a series through Core.
- Emits `CollectionRewardConfigSet`, `CollectionRewardMinted`, and `SeriesUnlockedFor`.

- [ ] **Step 2: Run collection reward test**

Run:

```bash
npx hardhat test test/doudochain-v2-module-split.test.js --grep "collection rewards"
```

Expected: Collection Book calls reward module and reward module mutates Core/DOUDOCOIN.

## Task 8: Deployment And Verification Scripts

- [ ] **Step 1: Implement deployment script**

Create `scripts/deploySplitModuleArbSepolia.ts`.

Required behavior:

- Use `ARB_TESTNET_PK`.
- Deploy/reuse DOUDOCOIN.
- Deploy `DoudoVRFRouter`.
- Deploy Core and module proxies.
- Wire roles and router permissions.
- Add Router as VRF consumer when possible.
- Print addresses and ABI paths.

- [ ] **Step 2: Implement verify script**

Create `scripts/verifySplitModuleArbSepolia.ts`.

Required behavior:

- Verify DOUDOCOIN if deployed fresh.
- Verify `DoudoVRFRouter` constructor args.
- Verify UUPS implementation contracts.
- Verify/link UUPS proxies.

## Task 9: Full Verification And Deploy

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: all active tests pass.

- [ ] **Step 2: Run bytecode size check**

Run:

```bash
npx hardhat size-contracts
```

Expected: every deployable implementation is below 24,576 bytes.

- [ ] **Step 3: Deploy new split suite to Arbitrum Sepolia**

Run:

```bash
npx hardhat run scripts/deploySplitModuleArbSepolia.ts --network arbitrumSepolia
```

Expected: script prints all contract/proxy addresses and role checks pass.

- [ ] **Step 4: Verify on Arbiscan**

Run:

```bash
npx hardhat run scripts/verifySplitModuleArbSepolia.ts --network arbitrumSepolia
```

Expected: router, implementations, and proxies are verified or already verified.

- [ ] **Step 5: Update handoff**

Update `docs/doudochain-v2-upgradeable-handoff.md` with the new split-suite addresses, ABI paths, and subgraph data-source list.
