# DOUDOCHAIN V2 UUPS Upgradeable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build UUPS-upgradeable `DOUDOCHAINV2Upgradeable` and `CollectionBookUpgradeable` with proxy-safe VRF, AdminMint, subgraph-compatible events, and focused tests.

**Architecture:** Create fresh upgradeable contracts instead of mutating immutable V2. Use `erc721a-upgradeable` for tickets, OpenZeppelin UUPS for upgrade authorization, direct Chainlink V2Plus coordinator-only callback guard for VRF, and event-first read models for The Graph.

**Tech Stack:** Solidity 0.8.20, Hardhat, ethers v6, OpenZeppelin upgradeable contracts/plugins, ERC721A upgradeable, Chainlink V2Plus request structs.

---

## File Structure

- Modify: `package.json`, `package-lock.json`, `hardhat.config.ts` — add upgrade dependencies and plugin.
- Create: `contracts/access/MinimalAccessControlUpgradeable.sol` — small role system with `grantRole`, `revokeRole`, `hasRole`.
- Create: `contracts/security/LightweightGuardsUpgradeable.sol` — initializer-safe pause and reentrancy guards.
- Create: `contracts/interfaces/IVRFCoordinatorV2PlusMinimal.sol` — minimal request interface for Chainlink V2Plus.
- Create: `contracts/DOUDOCHAINV2Upgradeable.sol` — UUPS lottery implementation.
- Create: `contracts/CollectionBookUpgradeable.sol` — UUPS Collection Book implementation.
- Create: `contracts/test/DOUDOCHAINV2UpgradeableV2Mock.sol` — upgrade test target.
- Create: `test/doudochain-v2-upgradeable.test.js` — proxy, VRF, AdminMint, events, upgrade tests.
- Create: `test/collection-book-upgradeable.test.js` — proxy, event, deposit/claim tests.
- Create: `scripts/deployUpgradeableArbSepolia.ts` — proxy deployment and role grant script.
- Create: `scripts/upgradeDoudochainV2ArbSepolia.ts` — UUPS upgrade script.

## Task 1: Dependencies And Baseline

- [ ] **Step 1: Install dependencies**

Run:

```bash
npm install --save-dev @openzeppelin/hardhat-upgrades erc721a-upgradeable
npm install @openzeppelin/contracts-upgradeable@4.9.3
```

Expected: `package.json` includes upgrade dependencies and `package-lock.json` updates.

- [ ] **Step 2: Register Hardhat upgrades plugin**

Modify `hardhat.config.ts` to include:

```typescript
import "@openzeppelin/hardhat-upgrades";
```

- [ ] **Step 3: Run baseline**

Run:

```bash
npx hardhat compile
npm test
```

Expected: existing tests pass before upgradeable work begins.

## Task 2: Proxy Infrastructure Tests

- [ ] **Step 1: Write failing DOUDOCHAIN proxy tests**

Create `test/doudochain-v2-upgradeable.test.js` with tests that deploy a UUPS proxy, check initializer roles, reject re-initialization, and require `UPGRADER_ROLE` for upgrades.

- [ ] **Step 2: Run proxy tests and confirm failure**

Run:

```bash
npx hardhat test test/doudochain-v2-upgradeable.test.js --grep "proxy"
```

Expected: fails because `DOUDOCHAINV2Upgradeable` does not exist.

- [ ] **Step 3: Implement minimal role/guard infrastructure and upgradeable skeleton**

Create minimal role and guard helper contracts, then create `DOUDOCHAINV2Upgradeable` with initializer, UUPS auth, ERC721AUpgradeable initialization, points address, VRF config storage, and basic getters.

- [ ] **Step 4: Run proxy tests**

Run:

```bash
npx hardhat test test/doudochain-v2-upgradeable.test.js --grep "proxy"
```

Expected: proxy tests pass.

## Task 3: Series, AdminMint, And Compatibility Events

- [ ] **Step 1: Add failing tests for atomic series, AdminMint, and events**

Extend `test/doudochain-v2-upgradeable.test.js` to verify:

- `createSeriesWithSubPrizes` emits full `NewSeries` event with `priceInPoints` in the legacy `priceInUSDTWei` slot.
- `NewTicketStatus` emits `luckyNumber`.
- `adminMint` bypasses points burn, wallet cap, and mint lock.
- `adminMint` consumes inventory and lucky numbers.
- `UpdateSeriesRemainingTicketNumbers` emits after mint.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx hardhat test test/doudochain-v2-upgradeable.test.js --grep "series|AdminMint|NewTicketStatus"
```

Expected: fails because series/admin mint behavior is missing.

- [ ] **Step 3: Implement series setup and AdminMint**

Add series structs, subprize storage, validation, `createSeriesWithSubPrizes`, `batchCreateSeriesWithSubPrizes`, `_mintTickets`, paid `mint`, and `adminMint`.

- [ ] **Step 4: Run tests**

Run:

```bash
npx hardhat test test/doudochain-v2-upgradeable.test.js --grep "series|AdminMint|NewTicketStatus"
```

Expected: tests pass.

## Task 4: VRF, Reveal, Redraw, Last Prize

- [ ] **Step 1: Add failing VRF tests**

Extend tests to verify:

- `setVrfConfig` emits `VrfConfigUpdated`.
- Pending requests fulfill from their recorded coordinator after config update.
- `rawFulfillRandomWords` rejects non-coordinator callers.
- Reveal emits `RevealDrawSent`, `RevealDrawFulfilled`, `UpdatePrize`, and `UpdateTicketStatus`.
- Last prize emits `LastPrizeDraw`, `LastPrizeWinner`, and `UpdateSeriesLastPrizeOwner`.

- [ ] **Step 2: Run VRF tests and confirm failure**

Run:

```bash
npx hardhat test test/doudochain-v2-upgradeable.test.js --grep "VRF|reveal|last prize|redraw"
```

Expected: fails because VRF/reveal paths are missing.

- [ ] **Step 3: Implement proxy-safe VRF and draw paths**

Add request context storage, `requestCoordinator`, direct `rawFulfillRandomWords`, reveal fulfillment, redraw fulfillment, and last-prize range reroll.

- [ ] **Step 4: Run VRF tests**

Run:

```bash
npx hardhat test test/doudochain-v2-upgradeable.test.js --grep "VRF|reveal|last prize|redraw"
```

Expected: tests pass.

## Task 5: CollectionBookUpgradeable

- [ ] **Step 1: Add failing CollectionBook proxy and event tests**

Create `test/collection-book-upgradeable.test.js` verifying UUPS initialization, book creation, slot definition, deposit, withdraw, claim, and the Collection Book subgraph events.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx hardhat test test/collection-book-upgradeable.test.js
```

Expected: fails because `CollectionBookUpgradeable` does not exist.

- [ ] **Step 3: Implement CollectionBookUpgradeable**

Port current `CollectionBook` behavior to initializer storage, UUPS authorization, storage-backed points address, and the approved Collection Book events.

- [ ] **Step 4: Run tests**

Run:

```bash
npx hardhat test test/collection-book-upgradeable.test.js
```

Expected: tests pass.

## Task 6: Scripts And Verification

- [ ] **Step 1: Add deploy and upgrade scripts**

Create `scripts/deployUpgradeableArbSepolia.ts` and `scripts/upgradeDoudochainV2ArbSepolia.ts` using `upgrades.deployProxy` and `upgrades.upgradeProxy`.

- [ ] **Step 2: Run local deploy dry-run**

Run:

```bash
npx hardhat run scripts/deployUpgradeableArbSepolia.ts
```

Expected: prints proxy addresses and role grant summaries on local Hardhat network with mock/local-safe env defaults.

- [ ] **Step 3: Final verification**

Run:

```bash
npx hardhat compile
npm test
node - <<'NODE'
const fs = require('fs');
for (const name of ['DOUDOCHAINV2Upgradeable','CollectionBookUpgradeable']) {
  const paths = [
    `artifacts/contracts/${name}.sol/${name}.json`,
    `artifacts/contracts/test/${name}.sol/${name}.json`
  ];
  const p = paths.find(fs.existsSync);
  if (!p) continue;
  const a = JSON.parse(fs.readFileSync(p, 'utf8'));
  console.log(`${name}: ${(a.deployedBytecode.length - 2) / 2} bytes`);
}
NODE
```

Expected: compile and tests pass; implementation bytecode remains under 24,576 bytes.
