# DOUDOCHAIN V2 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the asset-loss bugs and missing core flows found in the review of the deployed UUPS module-split DOUDOCHAIN V2, shipping as in-place proxy upgrades.

**Architecture:** Keep the current split: non-proxy `DoudoVRFRouter` + UUPS `DOUDOCHAINV2CoreUpgradeable` (Core) + UUPS modules (Bundle, Refund, Redraw, CollectionReward) + UUPS `CollectionBookUpgradeable`. Most fixes are Core primitives plus their module callers. Router is non-proxy and is redeployed. All Core/module storage changes are **append-only** (new state vars declared immediately before `uint256[N] private __gap;`, with `N` reduced by the number of new slots) to preserve UUPS storage layout.

**Tech Stack:** Solidity ^0.8.20, OpenZeppelin v4.9.5 + contracts-upgradeable, ERC721A-upgradeable, Chainlink VRF V2Plus, Hardhat + `@openzeppelin/hardhat-upgrades`, mocha/chai.

**Locked product decisions (from review + redraw redesign):**
1. Ship as UUPS upgrades (no fresh redeploy of Core/modules; Router redeployed).
2. Restore pre-order / 集單 (sell before goods arrive).
3. Keep a **separate** consolation prize inventory, drawn via VRF for bundle-granted consolation credits.
4. Restore on-chain `tokenURI` and `exchangePrize`.
5. **Redraw redesign (no VRF):** burn N revealed+unexchanged tickets → their prizes are **not** returned to the pool → directly mint **N new unrevealed** tickets from `remaining`; require `remaining >= N`; **free** (forfeiting the prizes is the cost). The user re-reveals the new tickets through the normal `reveal` flow. This removes the VRF redraw path and the sold-out replacement bug entirely.

**Test command:** `npx hardhat test` (and `npx hardhat size-contracts` to confirm each implementation stays < 24,576 bytes).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `contracts/DOUDOCHAINV2CoreUpgradeable.sol` | Core lottery state, primitives | Most fixes |
| `contracts/interfaces/IDoudoCore.sol` | Module-facing Core API | Update/add primitive signatures |
| `contracts/modules/DoudoRedrawModuleUpgradeable.sol` | Redraw + consolation | Synchronous redraw (no VRF); consolation-only VRF |
| `contracts/modules/DoudoBundleModuleUpgradeable.sol` | Bundles | Pass per-ticket points; rely on gated primitive |
| `contracts/modules/DoudoRefundModuleUpgradeable.sol` | Refunds | Refund actual `pointsPaid` |
| `contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol` | Book rewards | NFT reward uses no-inventory mint |
| `contracts/DoudoVRFRouter.sol` | VRF consumer | Coordinator-change safety |
| `scripts/upgradeDoudochainV2ArbSepolia.ts` | Upgrade ops | Upgrade all proxies + redeploy Router + re-wire |
| `test/doudochainV2Fixes.test.ts` | New regression tests | All fixed paths |

**Self-contained reference — current Core helpers (do not rename):** `_mintTickets`, `_mintOneTicketWithoutPoints`, `_checkAndRefreshMintLock`, `_checkWalletCap`, `_consumeLuckyNumber`, `_drawPrize`, `_returnPrizeSlot`, `_recordSeriesRange`, `_selectExistingTokenFromSeries`, `_mintLastPrizeToken`, `_tokenIdFromSeriesIndex`, `_emitSeriesInformation`. Current Core gap: `uint256[40] private __gap;`. Current Redraw module gap: `uint256[45] private __gap;`.

---

## PHASE P0 — Stop asset loss

### Task 1: Gated, points-aware `moduleMintUnrevealed` (shared by bundles + redraw)

**Problem:** `moduleMintUnrevealed` skips goods-arrived/refund checks, ignores `maxPerWallet` and the reservation lock, records `pointsPaid = 0`, and reverts on `useLuckyNumber` series. Both the bundle flow and the new redraw flow (Task 2) mint unrevealed tickets through this primitive, so it must be correct first.

**Files:**
- Modify: `contracts/DOUDOCHAINV2CoreUpgradeable.sol`, `contracts/interfaces/IDoudoCore.sol`, `contracts/modules/DoudoBundleModuleUpgradeable.sol`
- Test: `test/doudochainV2Fixes.test.ts`

- [ ] **Step 1: Write failing tests** — (a) bundle mint on a refunded series reverts; (b) bundle mint counts toward `maxPerWallet`; (c) bundle mint on a `useLuckyNumber` series auto-assigns distinct numbers; (d) `pointsPaid` for a bundle ticket equals `pricePoints / ticketQuantity`.

```ts
it("bundle mint respects refund, wallet cap, and records pointsPaid", async () => {
  await refund.connect(op).setSeriesRefund(seriesID, true, 0);
  await expect(bundle.connect(user).mintBundle(seriesID, 1, 1))
    .to.be.revertedWithCustomError(core, "SeriesIsRefund");
});
```

Run: `npx hardhat test --grep "bundle mint respects"` → Expected: FAIL.

- [ ] **Step 2: Core — gated, points-aware primitive + lucky auto-assign**

```solidity
function moduleMintUnrevealed(
    address to,
    uint256 seriesID,
    uint256 quantity,
    uint256 pointsPerTicket,   // bundle: pricePoints/ticketQuantity; redraw: 0
    bool enforceWalletAndLock  // true for buyer-facing bundle mints; false for redraw
) external onlyRole(MODULE_ROLE) nonReentrant whenNotPaused returns (uint256 firstTokenId) {
    Series storage series = seriesData[seriesID];
    if (series.isRefund) revert SeriesIsRefund();
    if (quantity == 0 || quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
    if (enforceWalletAndLock) {
        if (!series.isGoodsArrived) revert GoodsNotArrived(); // pre-order handled in Task 8
        _checkAndRefreshMintLock(seriesID, to);
        _checkWalletCap(seriesID, to, quantity);
    }
    uint16[] memory luckyNumbers = new uint16[](quantity);
    if (series.useLuckyNumber) {
        for (uint256 i = 0; i < quantity; i++) luckyNumbers[i] = _assignNextLuckyNumber(seriesID);
    }
    firstTokenId = _nextTokenId();
    _mintTicketsPreassigned(seriesID, to, luckyNumbers, pointsPerTicket, enforceWalletAndLock);
}

// Lowest unused number in [1, total]; numbers already marked used here.
function _assignNextLuckyNumber(uint256 seriesID) internal returns (uint16) {
    uint256 total = seriesData[seriesID].totalTicketNumbers;
    for (uint16 n = 1; n <= total; n++) {
        if (!luckyNumberUsed[seriesID][n]) { luckyNumberUsed[seriesID][n] = true; return n; }
    }
    revert LuckyNumberTaken();
}

// Copy of _mintTickets but WITHOUT calling _consumeLuckyNumber (numbers pre-assigned/zero).
function _mintTicketsPreassigned(
    uint256 seriesID, address to, uint16[] memory luckyNumbers,
    uint256 paidPointsPerTicket, bool countWalletMint
) internal {
    Series storage series = seriesData[seriesID];
    uint256 quantity = luckyNumbers.length;
    uint256 startTokenId = _nextTokenId();
    _safeMint(to, quantity);
    for (uint256 i = 0; i < quantity; i++) {
        uint256 tokenId = startTokenId + i;
        ticketStatusDetail[tokenId] = TicketStatus({
            seriesID: seriesID, tokenRevealedPrize: 0, tokenExchange: false,
            tokenRevealed: false, luckyNumber: luckyNumbers[i]
        });
        pointsPaid[tokenId] = paidPointsPerTicket;
        emit NewTicketStatus(tokenId, seriesID, 0, false, false, to, luckyNumbers[i]);
    }
    series.remainingTicketNumbers -= quantity;
    if (countWalletMint) mintedPerWallet[seriesID][to] += quantity;
    totalMintedInSeries[seriesID] += quantity;
    _recordSeriesRange(seriesID, startTokenId, quantity);
    emit UpdateSeriesRemainingTicketNumbers(seriesID, series.remainingTicketNumbers);
}
```

Update the `moduleMintUnrevealed` signature in `IDoudoCore.sol` to the 5-arg form.

- [ ] **Step 3: Bundle module — pass per-ticket points + enforce flag**

```solidity
uint256 pointsPerTicket = config.ticketQuantity == 0 ? 0 : config.priceInPoints / config.ticketQuantity;
firstTokenID = core.moduleMintUnrevealed(msg.sender, seriesID, ticketQuantity, pointsPerTicket, true);
```

- [ ] **Step 4: Verify** — `npx hardhat test --grep "bundle mint respects"` → Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix(core): gated points-aware moduleMintUnrevealed (cap/lock/refund/lucky/pointsPaid)"`

---

### Task 2: Simplified main burn-to-redraw (no VRF, no prize return, `remaining >= N`)

**Problem & design:** The old VRF redraw drew a replacement prize and reverted on sold-out series, losing burned tickets. New model: burn N revealed+unexchanged tickets (prizes **not** returned), then mint **N new unrevealed** tickets from `remaining`; require `remaining >= N`; free; **no VRF**. The pool invariant `pool == unrevealedTickets + remaining` is preserved, so the new tickets are always coverable when revealed. Burned prizes become operator surplus.

**Files:**
- Modify: `contracts/modules/DoudoRedrawModuleUpgradeable.sol` (uses existing `core.moduleBurnForRedraw` + the Task 1 `moduleMintUnrevealed`)
- Test: `test/doudochainV2Fixes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("redrawMain burns N revealed and mints N new unrevealed from remaining", async () => {
  await redraw.connect(op).setRedrawEnabled(seriesID, true);
  const beforeRemaining = (await core.doudoSeries(seriesID)).remainingTicketNumbers;
  await redraw.connect(user).redrawMain(seriesID, [t1, t2]); // t1,t2 revealed, unexchanged
  const afterRemaining = (await core.doudoSeries(seriesID)).remainingTicketNumbers;
  expect(afterRemaining).to.equal(beforeRemaining - 2n);      // consumed 2 from remaining
  expect(await core.balanceOf(user.address)).to.equal(prevBalance); // -2 burned +2 new
});

it("redrawMain reverts when remaining < N", async () => {
  // sell out so remaining == 0
  await expect(redraw.connect(user).redrawMain(seriesID, [t1]))
    .to.be.revertedWithCustomError(core, "NotEnoughNFTsRemaining");
});
```

Run: `npx hardhat test --grep "redrawMain"` → Expected: FAIL.

- [ ] **Step 2: Redraw module — synchronous redraw, per-series enable, drop VRF main path + `redrawConsolation`**

```solidity
// Append before __gap (reduce module __gap 45 -> 44). Keep existing redrawConfigs slot for layout.
mapping(uint256 => bool) public redrawEnabled;

error RedrawDisabled();
event RedrawConfigUpdated(uint256 indexed seriesID, bool enabled);
event RedrawMinted(uint256 indexed seriesID, address indexed user, uint256 quantity, uint256 firstTokenID);

function setRedrawEnabled(uint256 seriesID, bool enabled) external onlyRole(OPERATION_ROLE) {
    redrawEnabled[seriesID] = enabled;
    emit RedrawConfigUpdated(seriesID, enabled);
}

function redrawMain(uint256 seriesID, uint256[] calldata tokenIDs) external nonReentrant {
    if (!redrawEnabled[seriesID]) revert RedrawDisabled();
    uint256 n = tokenIDs.length;
    if (n == 0) revert InvalidConfig();
    for (uint256 i = 0; i < n; i++) {
        (uint256 s,) = core.moduleBurnForRedraw(tokenIDs[i], msg.sender, false); // no prize return
        if (s != seriesID) revert MixedSeries();
    }
    // mints n unrevealed; reverts NotEnoughNFTsRemaining if remaining < n
    uint256 firstTokenID = core.moduleMintUnrevealed(msg.sender, seriesID, n, 0, false);
    emit RedrawMinted(seriesID, msg.sender, n, firstTokenID);
}
```

Delete `redrawConsolation(...)` and the non-consolation branch of `_request`/`requestContexts`/`fulfillRandomWordsFromRouter`. Keep `drawConsolation`, `creditConsolationDraws`, and consolation fulfillment (Task 3). Leave the old `redrawConfigs`/`setRedrawConfig` storage in place (unused) to preserve layout, or repurpose `setRedrawConfig` to also toggle `redrawEnabled`.

- [ ] **Step 3: Verify** — `npx hardhat test --grep "redrawMain"` → Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -am "feat(redraw): burn-N-mint-N redraw without VRF; require remaining>=N"`

---

### Task 3: Separate consolation pool + no-inventory revealed mint (drawConsolation + book NFT rewards)

**Problem:** Consolation draws (bundle credits) and Collection-Book NFT rewards mint an **extra revealed prize ticket** — not a sale — and must work on sold-out series. The old path used `_mintOneTicketWithoutPoints` (requires `remaining != 0`) and consolation drew from the **main** pool.

**Files:**
- Modify: `contracts/DOUDOCHAINV2CoreUpgradeable.sol`, `contracts/interfaces/IDoudoCore.sol`, `contracts/modules/DoudoRedrawModuleUpgradeable.sol`
- Test: `test/doudochainV2Fixes.test.ts`

- [ ] **Step 1: Write failing tests** — (a) `moduleMintRevealed` mints a revealed token on a sold-out series without changing `remaining`; (b) `drawConsolation` pulls from the consolation pool and leaves the main pool untouched.

```ts
it("consolation draw pulls from the consolation pool, never the main pool", async () => {
  await core.connect(op).setConsolationPrizes(seriesID,
    [{ subPrizeID: 9001, prizeGroup: "Z", subPrizeName: "consolation", subPrizeRemainingQuantity: 5 }]);
  const mainBefore = (await core.getSubPrizesDetail(seriesID)).map(p => p.subPrizeRemainingQuantity);
  await redraw.connect(user).drawConsolation(seriesID);        // user has 1 credit
  await fulfill(router, lastRequestId, [randomWord]);          // mock VRF fulfill
  const mainAfter = (await core.getSubPrizesDetail(seriesID)).map(p => p.subPrizeRemainingQuantity);
  expect(mainAfter).to.deep.equal(mainBefore);
});
```

Run: `npx hardhat test --grep "consolation draw pulls"` → Expected: FAIL.

- [ ] **Step 2: Core — no-inventory revealed mint + consolation pool**

```solidity
// Append before __gap (reduce Core __gap 40 -> 39):
mapping(uint256 => SubPrize[]) private consolationPrizes;

event NewConsolationPrize(uint256 indexed seriesID, uint256 subPrizeID, string prizeGroup, string subPrizeName, uint256 remainingQuantity);
event UpdateConsolationPrize(uint256 indexed seriesID, uint256 subPrizeID, uint256 remainingQuantity);

// Mints an EXTRA revealed ticket beyond sale inventory (no remaining change, no remaining>0 requirement).
function _mintRevealedNoInventory(uint256 seriesID, address to, uint256 prizeID, uint16 luckyNumber)
    internal returns (uint256 tokenId)
{
    if (!seriesData[seriesID].isGoodsArrived) revert GoodsNotArrived();
    tokenId = _nextTokenId();
    _safeMint(to, 1);
    ticketStatusDetail[tokenId] = TicketStatus({
        seriesID: seriesID, tokenRevealedPrize: prizeID, tokenExchange: false,
        tokenRevealed: true, luckyNumber: luckyNumber
    });
    _recordSeriesRange(seriesID, tokenId, 1);
    totalMintedInSeries[seriesID] += 1;
    emit NewTicketStatus(tokenId, seriesID, prizeID, false, true, to, luckyNumber);
    emit UpdateTicketStatus(tokenId, seriesID, prizeID, false, true);
}

function moduleMintRevealed(address to, uint256 seriesID, uint256 prizeID, uint16 luckyNumber)
    external onlyRole(MODULE_ROLE) nonReentrant whenNotPaused returns (uint256 tokenId)
{
    tokenId = _mintRevealedNoInventory(seriesID, to, prizeID, luckyNumber);
}

function setConsolationPrizes(uint256 seriesID, SubPrize[] calldata prizes) external onlyRole(OPERATION_ROLE) {
    if (seriesData[seriesID].totalTicketNumbers == 0) revert InvalidSeriesInput();
    delete consolationPrizes[seriesID];
    for (uint256 i = 0; i < prizes.length; i++) {
        consolationPrizes[seriesID].push(prizes[i]);
        emit NewConsolationPrize(seriesID, prizes[i].subPrizeID, prizes[i].prizeGroup, prizes[i].subPrizeName, prizes[i].subPrizeRemainingQuantity);
    }
}

function getConsolationPrizes(uint256 seriesID) external view returns (SubPrize[] memory) {
    return consolationPrizes[seriesID];
}

function moduleDrawConsolationPrize(uint256 seriesID, uint256 randomWord)
    external onlyRole(MODULE_ROLE) returns (uint256 subPrizeID)
{
    SubPrize[] storage prizes = consolationPrizes[seriesID];
    uint256 totalRemaining;
    for (uint256 i = 0; i < prizes.length; i++) totalRemaining += prizes[i].subPrizeRemainingQuantity;
    if (totalRemaining == 0) revert NotEnoughNFTsRemaining();
    uint256 cursor; uint256 winningIndex = randomWord % totalRemaining;
    for (uint256 i = 0; i < prizes.length; i++) {
        cursor += prizes[i].subPrizeRemainingQuantity;
        if (winningIndex < cursor) {
            prizes[i].subPrizeRemainingQuantity -= 1;
            emit UpdateConsolationPrize(seriesID, prizes[i].subPrizeID, prizes[i].subPrizeRemainingQuantity);
            return prizes[i].subPrizeID;
        }
    }
    revert InvalidSeriesInput();
}
```

Add to `IDoudoCore.sol`: `function moduleDrawConsolationPrize(uint256 seriesID, uint256 randomWord) external returns (uint256);` (the `moduleMintRevealed` signature already exists). After this change `_mintOneTicketWithoutPoints` is unused — delete it.

- [ ] **Step 3: Redraw module — settle consolation from the consolation pool**

```solidity
function fulfillRandomWordsFromRouter(uint256 requestId, uint256[] calldata randomWords) external override nonReentrant {
    if (msg.sender != address(router)) revert OnlyRouter(msg.sender);
    if (randomWords.length == 0) revert InvalidConfig();
    RequestContext memory context = requestContexts[requestId];
    if (context.user == address(0)) revert InvalidConfig();
    delete requestContexts[requestId];
    uint256 prizeID = core.moduleDrawConsolationPrize(context.seriesID, randomWords[0]); // consolation pool only
    uint256 tokenID = core.moduleMintRevealed(context.user, context.seriesID, prizeID, 0);
    emit RedrawFulfilled(requestId, context.seriesID, context.user, tokenID, true);
}
```

- [ ] **Step 4: Verify** — `npx hardhat test --grep "consolation draw pulls"` → Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "fix: separate consolation inventory + no-inventory revealed mint for rewards"`

---

## PHASE P1 — Required features & core gaps

### Task 4: Adjustable reservation lock

**Files:** Modify `contracts/DOUDOCHAINV2CoreUpgradeable.sol`; Test `test/doudochainV2Fixes.test.ts`

- [ ] **Step 1: Failing test** — set series lock to 60s, mint, confirm a different wallet can mint after 60s; `clearMintLock` frees immediately; non-OPERATION caller reverts.
- [ ] **Step 2: Implement**

```solidity
// Append before __gap (reduce Core __gap 39 -> 38):
mapping(uint256 => uint256) public seriesLockDuration; // 0 => use default

event LockDurationUpdated(uint256 defaultLockDuration);
event SeriesLockDurationUpdated(uint256 indexed seriesID, uint256 duration);

function setDefaultLockDuration(uint256 duration) external onlyRole(OPERATION_ROLE) {
    defaultLockDuration = duration; emit LockDurationUpdated(duration);
}
function setSeriesLockDuration(uint256 seriesID, uint256 duration) external onlyRole(OPERATION_ROLE) {
    seriesLockDuration[seriesID] = duration; emit SeriesLockDurationUpdated(seriesID, duration);
}
function clearMintLock(uint256 seriesID) external onlyRole(OPERATION_ROLE) {
    mintLockUntil[seriesID] = 0; mintLockOwner[seriesID] = address(0);
    emit MintLockUpdated(seriesID, address(0), 0);
}
```

In `_checkAndRefreshMintLock`, compute: `uint256 d = seriesLockDuration[seriesID]; if (d == 0) d = defaultLockDuration;` and use `d`.

- [ ] **Step 3: Verify & Step 4: Commit** — `git commit -am "feat(core): adjustable + per-series mint lock and clearMintLock"`

---

### Task 5: On-chain `tokenURI`

**Files:** Modify `contracts/DOUDOCHAINV2CoreUpgradeable.sol`.

- [ ] **Step 1: Failing test** — unrevealed token returns `unrevealTokenURI`; revealed returns `revealTokenURI + prizeId`; exchanged returns `exchangeTokenURI + prizeId`.
- [ ] **Step 2: Implement** (ERC721A provides `_toString` and `_exists`; `URIQueryForNonexistentToken` is the ERC721A error)

```solidity
function tokenURI(uint256 tokenId) public view override returns (string memory) {
    if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
    TicketStatus storage s = ticketStatusDetail[tokenId];
    Series storage series = seriesData[s.seriesID];
    if (s.tokenExchange) return string(abi.encodePacked(series.exchangeTokenURI, _toString(s.tokenRevealedPrize)));
    if (s.tokenRevealed)  return string(abi.encodePacked(series.revealTokenURI,   _toString(s.tokenRevealedPrize)));
    return series.unrevealTokenURI;
}
```

- [ ] **Step 3: Verify & Step 4: Commit** — `git commit -am "feat(core): restore reveal/exchange-aware tokenURI"`

---

### Task 6: `exchangePrize`

**Files:** Modify `contracts/DOUDOCHAINV2CoreUpgradeable.sol`.

- [ ] **Step 1: Failing test** — owner of a revealed, unexchanged token marks it exchanged; second call reverts `TokenAlreadyExchanged`; non-owner reverts; unrevealed reverts.
- [ ] **Step 2: Implement**

```solidity
error TokenNotRevealed();
function exchangePrize(uint256[] calldata tokenIDs) external whenNotPaused {
    for (uint256 i = 0; i < tokenIDs.length; i++) {
        uint256 id = tokenIDs[i];
        if (ownerOf(id) != msg.sender) revert NotTheTokenOwner();
        TicketStatus storage s = ticketStatusDetail[id];
        if (!s.tokenRevealed) revert TokenNotRevealed();
        if (s.tokenExchange) revert TokenAlreadyExchanged();
        s.tokenExchange = true;
        emit UpdateTicketStatus(id, s.seriesID, s.tokenRevealedPrize, true, true);
    }
}
```

- [ ] **Step 3: Verify & Step 4: Commit** — `git commit -am "feat(core): restore exchangePrize"`

---

### Task 7: Refund the actual `pointsPaid`

**Files:** Modify `contracts/interfaces/IDoudoCore.sol`, `contracts/modules/DoudoRefundModuleUpgradeable.sol`.

- [ ] **Step 1: Failing test** — a ticket that paid 700 points refunds 700 (not the flat config); a bundle ticket refunds its per-ticket points (set in Task 1); an admin-minted ticket (`pointsPaid` 0) refunds 0.
- [ ] **Step 2: Implement** — add `function pointsPaid(uint256 tokenID) external view returns (uint256);` to `IDoudoCore` (public mapping getter already exists on Core). In `claimRefund`, accumulate the real value:

```solidity
for (uint256 i = 0; i < tokenIDs.length; i++) {
    uint256 paid = core.pointsPaid(tokenIDs[i]);          // read BEFORE burn
    (uint256 seriesID,,) = core.moduleBurnForRefund(tokenIDs[i], msg.sender);
    if (i == 0) {
        expectedSeriesID = seriesID;
        if (!refundConfigs[seriesID].isRefund) revert RefundInactive();
    } else if (seriesID != expectedSeriesID) revert MixedSeries();
    totalRefund += paid;
}
if (totalRefund == 0) revert RefundInactive();
doudoPoints.mintWithReason(msg.sender, totalRefund, REFUND_POINTS);
```

Keep `refundPointsPerTicket` in the struct/event for compatibility but stop using it for the amount. Decision: bundle rebate already issued is **not** clawed back.

- [ ] **Step 3: Verify & Step 4: Commit** — `git commit -am "fix(refund): refund actual points paid per ticket"`

---

### Task 8: Restore pre-order / 集單

**Problem:** `mint` requires `isGoodsArrived`, there is no `setGoodsArrived`, `reveal` does not gate on arrival, and last prize always uses VRF.

**Files:** Modify `contracts/DOUDOCHAINV2CoreUpgradeable.sol`.

- [ ] **Step 1: Failing tests** — (a) a not-arrived series allows `mint` but blocks `reveal` until `setGoodsArrived`; (b) `setGoodsArrived` flips the flag, sets times, emits `UpdateSeriesInformation`; (c) non-preorder series `chooseLastPrizeWinner` awards the last-minted token's owner without VRF; (d) preorder series still uses VRF.
- [ ] **Step 2: Implement**
  - Remove `if (!series.isGoodsArrived) revert GoodsNotArrived();` from `mint`. (The bundle path in `moduleMintUnrevealed` already gates this only under `enforceWalletAndLock`; for pre-order bundles, set the series arrived before opening bundles, or drop that check too per ops preference.)
  - Add arrival gate to reveal: at the top of `reveal`, `if (!seriesData[seriesID].isGoodsArrived) revert GoodsNotArrived();`
  - Add operator function:

```solidity
function setGoodsArrived(uint256 seriesID) external onlyRole(OPERATION_ROLE) {
    Series storage series = seriesData[seriesID];
    if (series.totalTicketNumbers == 0) revert InvalidSeriesInput();
    series.isGoodsArrived = true;
    series.estimateDeliverTime = block.timestamp;
    series.exchangeExpireTime = block.timestamp + 60 days;
    _emitSeriesInformation(seriesID);
}
```

  - Non-preorder last prize in `chooseLastPrizeWinner` (before requesting VRF):

```solidity
if (!series.isPreOrder) {
    uint256 lastTokenId = _tokenIdFromSeriesIndex(seriesID, totalMintedInSeries[seriesID] - 1);
    address winner = ownerOf(lastTokenId);
    _mintLastPrizeToken(seriesID, winner);
    lastPrizeOwners[seriesID].push(winner);
    emit UpdateSeriesLastPrizeOwner(seriesID, lastPrizeOwners[seriesID]);
    uint256[] memory one = new uint256[](1); one[0] = lastTokenId;
    emit LastPrizeWinner(seriesID, one);
    return;
}
_requestLastPrizeRandomWords(seriesID, quantity);
```

- [ ] **Step 3: Verify & Step 4: Commit** — `git commit -am "feat(core): restore pre-order minting, setGoodsArrived, reveal arrival gate, non-preorder last prize"`

---

## PHASE P2 — Hardening

### Task 9: Reentrancy guards on VRF settlement
**Files:** `contracts/DOUDOCHAINV2CoreUpgradeable.sol`, `contracts/modules/DoudoRedrawModuleUpgradeable.sol`.
- [ ] Add `nonReentrant` to both `fulfillRandomWordsFromRouter` functions (the Redraw one already gains it in Task 3). Test: a malicious winner contract whose `onERC721Received` re-enters `mint`/`reveal` causes the reentrant call to revert `ReentrantCall`. Commit: `git commit -am "fix: nonReentrant on VRF settlement callbacks"`

### Task 10: Router coordinator-change safety
**Files:** `contracts/DoudoVRFRouter.sol` (non-proxy redeploy).
- [ ] Track pending requests (`uint256 public pendingRequests;` inc on request, dec in `fulfillRandomWords`). In `setVrfConfig`, if the **coordinator address changes**, `require(pendingRequests == 0)` (keyHash/sub/gas/confirmations stay freely updatable). Test: changing coordinator with a pending request reverts; after fulfillment it succeeds. Commit: `git commit -am "fix(router): block coordinator change while requests are pending"`

### Task 11: `maxPerWallet` setter
**Files:** `contracts/DOUDOCHAINV2CoreUpgradeable.sol`.
- [ ] Add `setSeriesMaxPerWallet(uint256 seriesID, uint256 cap) external onlyRole(OPERATION_ROLE)` writing `seriesData[seriesID].maxPerWallet`. Test: setter updates the cap; cap enforced on next mint. Commit: `git commit -am "feat(core): setSeriesMaxPerWallet"`

---

## PHASE P3 — Docs, cleanup, tests, deploy

### Task 12: Regression test suite
**Files:** `test/doudochainV2Fixes.test.ts` (+ replace the existing pending tests).
- [ ] Cover: redraw (burn N → mint N unrevealed; `remaining < N` reverts; burned prizes not returned), consolation pool isolation + sold-out `moduleMintRevealed`, bundle gating/cap/lock/lucky/pointsPaid, adjustable lock, tokenURI states, exchangePrize, refund-by-pointsPaid, pre-order mint→arrive→reveal, non-preorder last prize, VRF reentrancy, router coordinator guard, and a **UUPS upgrade-storage test** (deploy old impl with state, upgrade to new impl, assert series/tickets/locks preserved and new vars default correctly). Run `npx hardhat test` → all pass; `npx hardhat size-contracts` → every impl < 24,576 bytes. Commit: `git commit -am "test: regression suite for V2 fixes + upgrade storage"`

### Task 13: Handoff doc + contract cleanup
**Files:** `docs/doudochain-v2-upgradeable-handoff.md`; remove dead contracts.
- [ ] Rewrite the handoff so it describes ONLY the split-module deployment: delete the stale "Previous Partial Deployment" sections and the monolithic checklist/subgraph/frontend notes that point at old addresses (`0xb2E6…`, `0x9C4a…`); update the coverage table to reflect bundle/refund/consolation/redraw/exchange/tokenURI as implemented.
- [ ] Delete superseded sources after confirming they are unreferenced by tests/scripts: `contracts/DOUDOCHAIN copy.sol`, `contracts/ICHICHAIN copy.sol`, `contracts/*copy.sol`, `contracts/DOUDOCOINNFT721A.txt`, and the monolithic `contracts/DOUDOCHAINV2Upgradeable.sol` / `contracts/DOUDOCHAINV2.sol` if no longer deployed. Keep `contracts/DOUDOCHAIN.sol` (V1) only if still referenced. Commit: `git commit -am "docs+chore: rewrite handoff for split deployment; remove dead contracts"`

### Task 14: Upgrade + redeploy + re-wire script
**Files:** `scripts/upgradeDoudochainV2ArbSepolia.ts`.
- [ ] Script: `upgrades.upgradeProxy` for Core + 4 modules + CollectionBook; redeploy `DoudoVRFRouter`; set Core VRF router; grant Router requester to Core + Redraw; re-grant `MODULE_ROLE`; set consolation prizes / `redrawEnabled` / bundles as needed; **post-deploy assertions** that every role/wiring matches expected (fail fast). Update Chainlink subscription consumer to the new Router. Run on a fork first. Commit: `git commit -am "chore(ops): upgrade script with router redeploy and wiring assertions"`

---

## Self-Review Notes

- **Spec coverage:** P0 (Tasks 1–3) = the three asset-loss areas, reframed around the no-VRF redraw: Task 1 fixes the shared `moduleMintUnrevealed`, Task 2 is the burn-N-mint-N redraw (sold-out bug gone by construction), Task 3 adds the separate consolation inventory + the no-inventory reward mint. P1 (Tasks 4–8) = the four locked decisions (lock-adjustable, tokenURI, exchange, pre-order) plus refund accuracy. P2 (Tasks 9–11) = hardening. P3 (Tasks 12–14) = tests, the stale handoff doc, contract sprawl, and the upgrade/wiring path.
- **Type consistency:** The 5-arg `moduleMintUnrevealed`, `moduleDrawConsolationPrize`, and `pointsPaid(uint256)` are mirrored in `IDoudoCore.sol` and used identically by the Bundle/Redraw/Refund modules. `moduleMintRevealed` keeps its existing signature but now routes through `_mintRevealedNoInventory`.
- **Storage discipline:** Core appends `consolationPrizes` (Task 3) and `seriesLockDuration` (Task 4) → `__gap` 40 → 38. Redraw module appends `redrawEnabled` → `__gap` 45 → 44; the unused `redrawConfigs` slot is retained for layout. The upgrade-storage test in Task 12 is the gate that proves layout safety before shipping.
- **Ordering:** Task 1 before Task 2 (redraw depends on the gated `moduleMintUnrevealed`). P0 first (stops fund loss), then P1/P2 features, then P3 ships them. Each task is independently testable and committable.
