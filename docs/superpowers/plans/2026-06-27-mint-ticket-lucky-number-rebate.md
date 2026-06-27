# Mint Ticket Lucky Number Rebate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Bundle 單一 `mintTickets` 入口以 `uint16[] luckyNumbers` 同時支援選號、非選號數量購買、立即開獎與 floor rebate，並恢復可在手機安全操作的選號 UI。

**Architecture:** `luckyNumbers.length` 是所有層唯一的購買數量來源。Core 提供 lucky-number mode getter 與 selected-number module mint；backend 擁有 canonical chain read、reservation 驗證與 calldata 組建；frontend 依 availability mode 顯示 picker 或 quantity stepper，但兩者都送出相同陣列 payload。

**Tech Stack:** Solidity 0.8.19、OpenZeppelin UUPS、Hardhat/Chai、NestJS、Viem、Jest/Supertest、Next.js/React、Testing Library、Tailwind、The Graph ABI artifacts。

---

## File Map

Contract repo `/Users/angustsai/ICHICHAIN_CONTRACT`:

- Modify `contracts/DOUDOCHAINV2CoreUpgradeable.sol`: mode getter、selected-number module mint、uint16 series guard。
- Modify `contracts/interfaces/IDoudoCore.sol`: Core module ABI。
- Modify `contracts/modules/DoudoBundleModuleUpgradeable.sol`: array-based `mintTickets`。
- Modify `test/doudochain-v2-core.test.js`: Core lucky-number validation。
- Modify `test/doudochain-v2-module-split.test.js`: Bundle selected-number mint/reveal。
- Modify `test/doudochain-v2-fixes.test.js`: rebate floor、non-lucky zeros、Redraw regression。
- Modify `scripts/upgradeCoreAndBundleArbSepolia.ts`: post-upgrade getter/signature checks。

Backend repo `/Users/angustsai/doudochain-backend`:

- Modify `packages/contracts/src/index.ts`: `mintTickets(uint256,uint16[],bool)` registry。
- Create `apps/api/src/chain/doudo-series-chain.service.ts`: canonical `seriesUsesLuckyNumber` read。
- Modify `apps/api/src/chain/index.ts` and API module wiring: export/inject service。
- Modify `apps/api/src/index.ts`: availability response 新增 mode。
- Modify `apps/api/src/user-transaction/dto.ts`: reservation/intent 接收 lucky-number array。
- Modify `apps/api/src/user-transaction/services/mint-reservation.service.ts`: mode-specific reservation validation。
- Modify `apps/api/src/user-transaction/controllers/user-transaction.controller.ts`: array-based intent 與 derived quantity。
- Modify `apps/api/src/user-transaction/helpers.ts`: reservation/intent equality。
- Modify focused platform/e2e tests covering chain read、reservation、calldata、orders。

Frontend repo `/Users/angustsai/ichichain`:

- Restore `app/components/dialog/content/purchase/LuckyNumberPicker.tsx` and test。
- Modify `PurchaseDialogContent.tsx`: mode-based picker/stepper in current scroll-safe shell。
- Modify `app/hooks/contract/mintV2.ts`: array-based args/cost helpers。
- Modify `useMintByCurrency.ts`, `useIchibanPurchaseBar.ts`, backend client DTOs: pass lucky-number array end to end。
- Modify `lib/backend/publicCatalog.ts` and `lib/apollo/api/series/getSeriesLuckyNumbers.ts`: map `useLuckyNumber`。
- Update focused Jest tests and browser-check the purchase dialog at desktop/mobile viewport。

Subgraph repo `/Users/angustsai/thegraph/doudochain_amoy`:

- Replace Bundle ABI artifact only; event handlers/schema remain unchanged。
- Run Graph codegen/build to prove ABI compatibility。

---

### Task 1: Core Selected-Number Module API

**Files:**
- Modify: `test/doudochain-v2-core.test.js`
- Modify: `contracts/DOUDOCHAINV2CoreUpgradeable.sol`
- Modify: `contracts/interfaces/IDoudoCore.sol`

- [ ] **Step 1: Write failing Core tests**

Add tests proving the getter, selected module mint, mode validation, and uint16 limit:

```js
expect(await core.seriesUsesLuckyNumber(0)).to.equal(true);
await core.moduleMintUnrevealedWithLuckyNumbers(user.address, 0, [7, 9], price, true);
expect((await core.ticketStatusDetail(0)).luckyNumber).to.equal(7);
expect((await core.ticketStatusDetail(1)).luckyNumber).to.equal(9);

await expect(
  core.moduleMintUnrevealedWithLuckyNumbers(user.address, 0, [0], price, true),
).to.be.revertedWithCustomError(core, "LuckyNumberOutOfRange");
```

For `useLuckyNumber=false`, assert `[0, 0]` succeeds and `[1]` reverts with a mode-specific custom error. Assert creating a lucky-number series above `type(uint16).max` reverts.

- [ ] **Step 2: Run Core test and verify RED**

Run:

```bash
npx hardhat test test/doudochain-v2-core.test.js --grep "selected-number module"
```

Expected: FAIL because `seriesUsesLuckyNumber` and `moduleMintUnrevealedWithLuckyNumbers` do not exist.

- [ ] **Step 3: Implement minimal Core API**

Add:

```solidity
function seriesUsesLuckyNumber(uint256 seriesID) external view returns (bool) {
    Series storage series = seriesData[seriesID];
    if (series.totalTicketNumbers == 0) revert InvalidSeriesInput();
    return series.useLuckyNumber;
}

function moduleMintUnrevealedWithLuckyNumbers(
    address to,
    uint256 seriesID,
    uint16[] calldata luckyNumbers,
    uint256 pointsPerTicket,
    bool enforceWalletAndLock
) external onlyRole(MODULE_ROLE) nonReentrant whenNotPaused returns (uint256 firstTokenId) {
    // Run existing inventory/lock/cap checks, copy calldata to memory, and call
    // _mintTickets(..., luckyNumbersPreassigned=false).
}
```

Add a custom error for a non-lucky series receiving non-zero values. In `_validateSeriesInput`, reject `useLuckyNumber && totalTicketNumbers > type(uint16).max`.

Update `IDoudoCore` with both the getter and selected-number module method. Keep existing quantity-based `moduleMintUnrevealed` for Redraw.

- [ ] **Step 4: Run Core tests and verify GREEN**

Run:

```bash
npx hardhat test test/doudochain-v2-core.test.js
```

Expected: all Core tests pass.

- [ ] **Step 5: Commit Core API**

```bash
git add contracts/DOUDOCHAINV2CoreUpgradeable.sol contracts/interfaces/IDoudoCore.sol test/doudochain-v2-core.test.js
git commit -m "feat(core): support selected lucky-number module mints"
```

### Task 2: Bundle Array-Based Mint And Rebate

**Files:**
- Modify: `test/doudochain-v2-module-split.test.js`
- Modify: `test/doudochain-v2-fixes.test.js`
- Modify: `contracts/modules/DoudoBundleModuleUpgradeable.sol`

- [ ] **Step 1: Write failing Bundle tests**

Replace quantity calls with arrays and assert selected numbers survive:

```js
await bundle.connect(user).mintTickets(0, [4, 8, 9], false);
expect((await core.ticketStatusDetail(0)).luckyNumber).to.equal(4);
expect((await core.ticketStatusDetail(1)).luckyNumber).to.equal(8);
expect((await core.ticketStatusDetail(2)).luckyNumber).to.equal(9);
```

Add cases for:

- `[0, 0, 0]` on non-lucky series.
- non-zero input on non-lucky series reverting.
- duplicate/used/out-of-range selected numbers reverting in Core.
- three/five/ten-length arrays selecting the expected floor rebate once.
- immediate reveal using selected numbers and rejecting arrays longer than 10.
- Redraw retaining automatic lucky-number assignment.

- [ ] **Step 2: Run Bundle tests and verify RED**

Run:

```bash
npx hardhat test test/doudochain-v2-module-split.test.js test/doudochain-v2-fixes.test.js
```

Expected: FAIL because current ABI expects `uint256 ticketQuantity`.

- [ ] **Step 3: Implement array-based Bundle mint**

Replace the public/internal signatures with:

```solidity
function mintTickets(
    uint256 seriesID,
    uint16[] calldata luckyNumbers,
    bool revealImmediately
) external nonReentrant returns (uint256 firstTokenID);
```

Inside, set `uint256 ticketQuantity = luckyNumbers.length`, validate mode through Core, burn points, call `moduleMintUnrevealedWithLuckyNumbers`, optionally reveal, then call `_rebateFor(seriesID, ticketQuantity)` once. Keep existing event signatures.

- [ ] **Step 4: Run Bundle and full contract tests**

```bash
npx hardhat test test/doudochain-v2-module-split.test.js test/doudochain-v2-fixes.test.js
npm test
```

Expected: focused and full suites pass; Redraw regression remains green.

- [ ] **Step 5: Validate UUPS layouts and commit**

```bash
env DRY_RUN=true npx hardhat run scripts/upgradeCoreAndBundleArbSepolia.ts --network arbitrumSepolia
git add contracts/modules/DoudoBundleModuleUpgradeable.sol test/doudochain-v2-module-split.test.js test/doudochain-v2-fixes.test.js scripts/upgradeCoreAndBundleArbSepolia.ts
git commit -m "feat(bundle): mint selected lucky numbers with floor rebates"
```

### Task 3: Backend Contract Registry

**Files:**
- Modify: `test/platform/config-and-contracts.spec.ts`
- Modify: `test/platform/external-adapters.spec.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write failing calldata tests**

Assert the registry produces selector `mintTickets(uint256,uint16[],bool)` and decoded args:

```ts
expect(request).toMatchObject({
  functionName: 'mintTickets',
  functionSelector: selectorFor('mintTickets(uint256,uint16[],bool)'),
  decodedArgs: {
    seriesID: 7n,
    luckyNumbers: [4, 8, 9],
    revealImmediately: true,
  },
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
npm run test -- test/platform/config-and-contracts.spec.ts test/platform/external-adapters.spec.ts --runInBand
```

Expected: FAIL with old quantity signature/args.

- [ ] **Step 3: Implement registry mapping**

Use `toUint16Array(args.luckyNumbers)` and remove `ticketQuantity` from calldata inputs. Keep the action name `mintTickets` and Bundle contract key.

- [ ] **Step 4: Re-run tests and commit**

```bash
npm run test -- test/platform/config-and-contracts.spec.ts test/platform/external-adapters.spec.ts --runInBand
git add packages/contracts/src/index.ts test/platform/config-and-contracts.spec.ts test/platform/external-adapters.spec.ts
git commit -m "feat(backend): encode lucky-number bundle mints"
```

### Task 4: Backend Canonical Lucky-Number Mode

**Files:**
- Create: `apps/api/src/chain/doudo-series-chain.service.ts`
- Modify: `apps/api/src/chain/index.ts`
- Modify: API module provider wiring files found under `apps/api/src/chain` and `apps/api/src/index.ts`
- Test: `test/platform/external-adapters.spec.ts`
- Test: `test/api/business-api.e2e-spec.ts`

- [ ] **Step 1: Write failing chain-reader and availability tests**

Inject a fake Viem client and assert:

```ts
await expect(service.usesLuckyNumbers({ seriesId: '7' })).resolves.toBe(true);
expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
  functionName: 'seriesUsesLuckyNumber',
  args: [7n],
}));
```

Assert `/availability` returns `useLuckyNumber: true` and returns 503 rather than defaulting when the canonical chain read fails.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm run test -- test/platform/external-adapters.spec.ts --runInBand
npm run test:e2e -- test/api/business-api.e2e-spec.ts --runInBand -t "availability"
```

Expected: FAIL because the service/field do not exist.

- [ ] **Step 3: Implement chain service and response field**

Follow existing Viem chain service construction. Read the configured Core proxy and expose:

```ts
usesLuckyNumbers(input: { seriesId: string; contractAddress?: HexAddress }): Promise<boolean>
```

Inject it into the public availability controller and include `useLuckyNumber` in the response. Preserve unavailable-number and mint-lock fields.

- [ ] **Step 4: Run tests/typecheck and commit**

```bash
npm run test -- test/platform/external-adapters.spec.ts --runInBand
npm run test:e2e -- test/api/business-api.e2e-spec.ts --runInBand -t "availability"
npm run typecheck
git add apps/api/src/chain apps/api/src/index.ts test/platform/external-adapters.spec.ts test/api/business-api.e2e-spec.ts
git commit -m "feat(backend): expose canonical lucky-number mode"
```

### Task 5: Backend Reservation And Intent Arrays

**Files:**
- Modify: `apps/api/src/user-transaction/dto.ts`
- Modify: `apps/api/src/user-transaction/services/mint-reservation.service.ts`
- Modify: `apps/api/src/user-transaction/controllers/user-transaction.controller.ts`
- Modify: `apps/api/src/user-transaction/helpers.ts`
- Modify: `test/platform/mint-logistics-graph.spec.ts`
- Modify: `test/api/namespaces.e2e-spec.ts`
- Modify: `test/api/business-api.e2e-spec.ts`

- [ ] **Step 1: Write failing reservation tests**

Cover selected and non-selected modes:

```ts
await expect(service.reserve({ ...scope, luckyNumbers: [4, 8] }))
  .resolves.toMatchObject({ luckyNumbers: [4, 8], ticketQuantity: 2 });

await expect(service.reserve({ ...scope, luckyNumbers: [4, 4] }))
  .rejects.toThrow('luckyNumbers must be unique');

await expect(nonLuckyService.reserve({ ...scope, luckyNumbers: [0, 0, 0] }))
  .resolves.toMatchObject({ ticketQuantity: 3 });
```

Also assert unavailable/reserved numbers are rejected, empty arrays fail, and reservation/intent arrays must match exactly.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm run test -- test/platform/mint-logistics-graph.spec.ts --runInBand
npm run test:e2e -- test/api/namespaces.e2e-spec.ts --runInBand -t "mint"
```

Expected: FAIL because APIs still require `ticketQuantity` and reservations store empty arrays.

- [ ] **Step 3: Implement DTO/reservation/intent flow**

Define numeric array validation without `ArrayUnique` because non-lucky zero arrays repeat. Derive quantity with:

```ts
const ticketQuantity = input.luckyNumbers.length;
```

Use canonical mode to apply uniqueness/range/zero rules. Save the exact array in reservation. Build calldata from `luckyNumbers`; save both `luckyNumbers` and derived `ticketQuantity` in intent `argsJson` for order views.

- [ ] **Step 4: Run backend focused suites and commit**

```bash
npm run test -- test/platform/mint-logistics-graph.spec.ts test/platform/config-and-contracts.spec.ts test/platform/external-adapters.spec.ts --runInBand
npm run test:e2e -- test/api/namespaces.e2e-spec.ts test/api/business-api.e2e-spec.ts --runInBand -t "mint"
npm run typecheck
git add apps/api/src/user-transaction test/platform test/api
git commit -m "feat(backend): reserve and mint selected lucky numbers"
```

### Task 6: Frontend Public Availability And Mint Helpers

**Files:**
- Modify: `lib/backend/publicCatalog.ts`
- Modify: `lib/backend/publicCatalog.test.ts`
- Modify: `lib/apollo/api/series/getSeriesLuckyNumbers.ts`
- Modify: `lib/apollo/api/series/getSeriesLuckyNumbers.test.ts`
- Modify: `app/hooks/contract/mintV2.ts`
- Modify: `app/hooks/contract/mintV2.test.ts`
- Modify: `app/hooks/doudochainBackendClient.ts`
- Modify: `app/hooks/doudochainBackendClient.test.ts`

- [ ] **Step 1: Write failing mapping/helper tests**

Assert availability maps `useLuckyNumber`, and mint helpers derive quantity/cost/args from arrays:

```ts
expect(buildV2MintArgs({
  seriesId: 7,
  luckyNumbers: [4, 8],
  revealImmediately: true,
})).toEqual([7n, [4, 8], true]);

expect(buildZeroLuckyNumbers(3)).toEqual([0, 0, 0]);
```

Assert backend reservation/intent requests contain `luckyNumbers` and no input `ticketQuantity`.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm run test -- lib/backend/publicCatalog.test.ts lib/apollo/api/series/getSeriesLuckyNumbers.test.ts app/hooks/contract/mintV2.test.ts app/hooks/doudochainBackendClient.test.ts --runInBand
```

Expected: FAIL with missing field/new helper and old quantity payload.

- [ ] **Step 3: Implement typed mappings and helpers**

Make `luckyNumbers.length` the only quantity calculation. Keep `buildMintContractFunctionName()` returning `mintTickets`; update tracking and balance checks to use derived length.

- [ ] **Step 4: Run tests and commit**

```bash
npm run test -- lib/backend/publicCatalog.test.ts lib/apollo/api/series/getSeriesLuckyNumbers.test.ts app/hooks/contract/mintV2.test.ts app/hooks/doudochainBackendClient.test.ts --runInBand
git add lib/backend app/hooks lib/apollo/api/series
git commit -m "feat(frontend): send lucky-number mint arrays"
```

### Task 7: Restore Picker In Scroll-Safe Dialog

**Files:**
- Create: `app/components/dialog/content/purchase/LuckyNumberPicker.tsx`
- Create: `app/components/dialog/content/purchase/LuckyNumberPicker.test.tsx`
- Modify: `app/components/dialog/content/purchase/PurchaseDialogContent.tsx`
- Modify: `app/components/dialog/content/purchase/PurchaseDialogContent.test.tsx`
- Modify: `app/hooks/useIchibanPurchaseBar.ts`
- Modify: `app/hooks/contract/useMintByCurrency.ts`
- Modify: purchase panel prop wiring under `app/components/purchase/panel`

- [ ] **Step 1: Restore/write failing picker and dialog tests**

Use the dev picker behavior as a reference, then assert current requirements:

```tsx
renderPurchaseDialog({ useLuckyNumber: true });
await user.click(screen.getByRole('button', { name: '4' }));
await user.click(screen.getByRole('button', { name: '8' }));
await user.click(screen.getByRole('button', { name: /mint/i }));
expect(onClickPayment).toHaveBeenCalledWith(expect.objectContaining({
  luckyNumbers: [4, 8],
}));
```

For `useLuckyNumber=false`, change the stepper to three and expect `[0, 0, 0]`. Assert the dialog body has `overflow-y-auto` and footer has `shrink-0`.

- [ ] **Step 2: Run component tests and verify RED**

```bash
npm run test -- app/components/dialog/content/purchase/LuckyNumberPicker.test.tsx app/components/dialog/content/purchase/PurchaseDialogContent.test.tsx --runInBand
```

Expected: FAIL because picker is absent and payment still receives quantity.

- [ ] **Step 3: Implement dual-mode UI in current shell**

Restore the picker component without restoring the old Dialog layout. Keep:

```text
DialogContent: max-h-[calc(100dvh-1rem)] overflow-hidden
Body: flex-1 overflow-y-auto
Footer: shrink-0
```

Pass selected values through purchase hooks. For non-lucky mode, convert the stepper value with `Array.from({ length: quantity }, () => 0)` only at the UI boundary.

- [ ] **Step 4: Run frontend tests/build and commit**

```bash
npm run test -- app/components/dialog/content/purchase/LuckyNumberPicker.test.tsx app/components/dialog/content/purchase/PurchaseDialogContent.test.tsx app/hooks/contract/mintV2.test.ts --runInBand
npm run build
git add app/components/dialog/content/purchase app/components/purchase/panel app/hooks
git commit -m "feat(frontend): restore responsive lucky-number purchasing"
```

### Task 8: ABI Sync And Cross-Layer Verification

**Files:**
- Modify: `/Users/angustsai/thegraph/doudochain_amoy/abis/DoudoBundleModuleUpgradeable.json`
- Modify: `/Users/angustsai/ICHICHAIN_CONTRACT/docs/doudochain-v2-upgradeable-handoff.md`
- Modify generated/local ABI consumers only where the repo already tracks them。

- [ ] **Step 1: Compile contracts and copy exact Bundle ABI**

```bash
npx hardhat compile
```

Copy the artifact ABI structurally into the subgraph ABI file and verify function/event signature parity with a Node comparison script.

- [ ] **Step 2: Run Graph and backend/frontend static gates**

```bash
cd /Users/angustsai/thegraph/doudochain_amoy && npm run codegen && npm run build
cd /Users/angustsai/doudochain-backend && npm run typecheck
cd /Users/angustsai/ichichain && npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run final contract and app tests**

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT && npm test
cd /Users/angustsai/doudochain-backend && npm run test -- test/platform/config-and-contracts.spec.ts test/platform/external-adapters.spec.ts test/platform/mint-logistics-graph.spec.ts --runInBand
cd /Users/angustsai/doudochain-backend && npm run test:e2e -- test/api/namespaces.e2e-spec.ts test/api/business-api.e2e-spec.ts --runInBand -t "mint|availability"
cd /Users/angustsai/ichichain && npm run test -- app/hooks/contract/mintV2.test.ts app/components/dialog/content/purchase/LuckyNumberPicker.test.tsx app/components/dialog/content/purchase/PurchaseDialogContent.test.tsx --runInBand
```

- [ ] **Step 4: Browser RWD verification**

Start the frontend dev server and test:

```text
series detail -> open purchase dialog -> select enough numbers to overflow the mobile body -> scroll body -> Mint remains visible and clickable
```

Check desktop plus a mobile viewport around 390x844, page identity, no framework overlay, console errors, visible picker/stepper mode, scroll behavior, sticky footer, and successful payment callback preparation without broadcasting a real transaction.

- [ ] **Step 5: Update handoff and commit sync changes**

Document the new ABI signature, storage validation command, test results, and the need to upgrade Core + Bundle together. Commit only files belonging to this feature; do not stage unrelated worktree changes.

