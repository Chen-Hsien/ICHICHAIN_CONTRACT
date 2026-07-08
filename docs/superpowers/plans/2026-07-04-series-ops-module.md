# SeriesOpsModule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move non-lottery series operations out of `DOUDOCHAINV2CoreUpgradeable` into `DoudoSeriesOpsModuleUpgradeable` while preserving user trust in Core-held NFT ownership, ticket inventory, prize draw, reveal settlement, and token URI behavior.

**Architecture:** Core remains the source of truth for ERC721A ownership, ticket status, prize inventory, VRF request lifecycle, ticket ranges, and mint/burn primitives. `SeriesOpsModule` owns operational policy state: mint reservations, wallet cap accounting, per-series lock duration, default lock duration, and reveal enablement. Core calls SeriesOps during mint/reveal primitives; admin/backend calls SeriesOps for setters.

**Tech Stack:** Solidity 0.8.20 UUPS modules, Hardhat Upgrades, The Graph mappings, NestJS backend contract registry/workflows, Next.js admin/frontend consumers.

---

### Task 1: Contract Tests First

**Files:**
- Modify: `/Users/angustsai/ICHICHAIN_CONTRACT/test/doudochain-v2-fixes.test.js`

- [ ] **Step 1: Write failing deployment wiring test**

Add deployment of `DoudoSeriesOpsModuleUpgradeable` in `deploySplitSuite()`:

```js
const SeriesOps = await ethers.getContractFactory(
  "contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol:DoudoSeriesOpsModuleUpgradeable"
);
const seriesOps = await upgrades.deployProxy(SeriesOps, [await core.getAddress()], {
  initializer: "initialize",
  kind: "uups",
});
await seriesOps.waitForDeployment();
await core.setSeriesOpsModule(await seriesOps.getAddress());
```

Expected first failure before implementation:

```bash
npx hardhat test test/doudochain-v2-fixes.test.js --grep "SeriesOps"
```

Expected: contract factory or `setSeriesOpsModule` missing.

- [ ] **Step 2: Write failing behavior tests**

Add tests that call SeriesOps setters and verify Core behavior:

```js
await seriesOps.setDefaultLockDuration(60);
await seriesOps.setSeriesMaxPerWallet(0, 2);
await core.connect(user).mint(0, [0]);
await expect(core.connect(other).mint(0, [0]))
  .to.be.revertedWithCustomError(seriesOps, "SeriesReserved");
await seriesOps.clearMintLock(0);
await core.connect(user).mint(0, [0]);
await expect(core.connect(user).mint(0, [0]))
  .to.be.revertedWithCustomError(seriesOps, "WalletCapExceeded");
```

Also test reveal switch:

```js
await createSeries(core, { isPreOrder: true, useLuckyNumber: false }, false);
await core.connect(user).mint(0, [0]);
await expect(core.connect(user).reveal(0, [0]))
  .to.be.revertedWithCustomError(core, "GoodsNotArrived");
await seriesOps.setSeriesRevealEnabled(0, true);
await expect(core.connect(user).reveal(0, [0]))
  .to.emit(core, "RevealDrawSent");
```

### Task 2: Contract Implementation

**Files:**
- Create: `/Users/angustsai/ICHICHAIN_CONTRACT/contracts/interfaces/IDoudoSeriesOps.sol`
- Create: `/Users/angustsai/ICHICHAIN_CONTRACT/contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol`
- Modify: `/Users/angustsai/ICHICHAIN_CONTRACT/contracts/DOUDOCHAINV2CoreUpgradeable.sol`
- Modify: `/Users/angustsai/ICHICHAIN_CONTRACT/contracts/interfaces/IDoudoCore.sol`

- [ ] **Step 1: Add SeriesOps interface**

Required external surface:

```solidity
interface IDoudoSeriesOps {
    function initializeSeries(uint256 seriesID, uint256 maxPerWallet, bool revealEnabled) external;
    function checkAndRefreshMintLock(uint256 seriesID, address user, uint256 quantity) external;
    function refreshMintLockFor(uint256 seriesID, address user, uint256 duration) external;
    function recordMint(uint256 seriesID, address user, uint256 quantity) external;
    function revealEnabled(uint256 seriesID) external view returns (bool);
}
```

Required admin surface:

```solidity
function setDefaultLockDuration(uint256 duration) external;
function setSeriesLockDuration(uint256 seriesID, uint256 duration) external;
function clearMintLock(uint256 seriesID) external;
function setSeriesMaxPerWallet(uint256 seriesID, uint256 cap) external;
function setSeriesRevealEnabled(uint256 seriesID, bool enabled) external;
function seedMintedCount(uint256 seriesID, address user, uint256 count) external;
```

- [ ] **Step 2: Implement module**

Module follows existing UUPS module pattern:

```solidity
contract DoudoSeriesOpsModuleUpgradeable is Initializable, UUPSUpgradeable, MinimalAccessControlUpgradeable {
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    address public core;
    uint256 public defaultLockDuration;
    mapping(uint256 => uint256) public seriesLockDuration;
    mapping(uint256 => address) public mintLockOwner;
    mapping(uint256 => uint256) public mintLockUntil;
    mapping(uint256 => uint256) public seriesMaxPerWallet;
    mapping(uint256 => mapping(address => uint256)) public mintedPerWallet;
    mapping(uint256 => bool) private seriesRevealDisabled;
}
```

Events to keep Graph/admin/backend observable:

```solidity
event MintLockUpdated(uint256 indexed seriesID, address indexed owner, uint256 until);
event SeriesMaxPerWalletUpdated(uint256 indexed seriesID, uint256 maxPerWallet);
event SeriesRevealEnabledUpdated(uint256 indexed seriesID, bool enabled);
event SeriesLockDurationUpdated(uint256 indexed seriesID, uint256 duration);
event DefaultLockDurationUpdated(uint256 duration);
```

- [ ] **Step 3: Wire Core to module**

Core changes:

```solidity
IDoudoSeriesOps public seriesOpsModule;
event SeriesOpsModuleUpdated(address indexed previousModule, address indexed newModule);

function setSeriesOpsModule(address moduleAddress) external onlyRole(OPERATION_ROLE) {
    if (moduleAddress == address(0)) revert InvalidConfig();
    emit SeriesOpsModuleUpdated(address(seriesOpsModule), moduleAddress);
    seriesOpsModule = IDoudoSeriesOps(moduleAddress);
}
```

Replace Core policy checks:

```solidity
seriesOpsModule.checkAndRefreshMintLock(seriesID, buyer, quantity);
seriesOpsModule.recordMint(seriesID, to, quantity);
seriesOpsModule.refreshMintLockFor(seriesID, to, 5 minutes);
if (!seriesOpsModule.revealEnabled(seriesID)) revert GoodsNotArrived();
```

Remove or stop exposing Core admin setters that move to SeriesOps:

```solidity
setDefaultLockDuration
setSeriesLockDuration
clearMintLock
setSeriesMaxPerWallet
setSeriesRevealEnabled
```

### Task 3: Deployment Scripts

**Files:**
- Modify: `/Users/angustsai/ICHICHAIN_CONTRACT/scripts/deploySplitModuleArbSepolia.ts`
- Modify: `/Users/angustsai/ICHICHAIN_CONTRACT/scripts/upgradeCoreArbSepolia.ts`
- Modify: `/Users/angustsai/ICHICHAIN_CONTRACT/scripts/upgradeCoreAndBundleArbSepolia.ts`
- Modify: `/Users/angustsai/ICHICHAIN_CONTRACT/scripts/verifySplitModuleArbSepolia.ts`

- [ ] Deploy `DoudoSeriesOpsModuleUpgradeable` after Core.
- [ ] Call `core.setSeriesOpsModule(seriesOpsProxy)`.
- [ ] Add `DOUDO_SERIES_OPS_MODULE` to deployment output.
- [ ] In upgrade script, read `DOUDO_SERIES_OPS_MODULE_ADDRESS`; deploy if absent only when explicitly requested.

### Task 4: The Graph

**Files:**
- Add ABI: `/Users/angustsai/thegraph/doudochain_amoy/abis/DoudoSeriesOpsModuleUpgradeable.json`
- Modify: `/Users/angustsai/thegraph/doudochain_amoy/schema.graphql`
- Modify: `/Users/angustsai/thegraph/doudochain_amoy/subgraph.yaml`
- Create: `/Users/angustsai/thegraph/doudochain_amoy/src/series-ops.ts`

- [ ] Add datasource for SeriesOps module.
- [ ] Index `MintLockUpdated` from SeriesOps.
- [ ] Index `SeriesMaxPerWalletUpdated` into `NewSeries.maxPerWallet` only after module event exists.
- [ ] Keep existing Core NFT/ticket events unchanged.

### Task 5: Backend

**Files:**
- Modify: `/Users/angustsai/doudochain-backend/packages/contracts/src/index.ts`
- Modify: `/Users/angustsai/doudochain-backend/packages/ops-workflow/src/index.ts`
- Modify config tests under `/Users/angustsai/doudochain-backend/test/platform`

- [ ] Add registry key `DOUDO_SERIES_OPS_MODULE`.
- [ ] Route moved actions to `DOUDO_SERIES_OPS_MODULE`:

```ts
setDefaultLockDuration
setSeriesLockDuration
clearMintLock
setSeriesMaxPerWallet
setSeriesRevealEnabled
```

- [ ] Leave `setGoodsArrived`, `setSeriesMetadata`, `pause`, `unpause`, and `chooseLastPrizeWinner` on Core.

### Task 6: Admin And ichichain

**Files:**
- Inspect and modify only if direct contract target assumptions exist:
  - `/Users/angustsai/DOUDO-ADMIN/src/lib/emergency-contract-writes.ts`
  - `/Users/angustsai/DOUDO-ADMIN/src/lib/ops-workflow-review.ts`
  - `/Users/angustsai/ichichain/lib/apollo/api/series/*`
  - `/Users/angustsai/ichichain/lib/backend/publicCatalog.ts`

- [ ] Admin should show/write SeriesOps module address for moved emergency writes.
- [ ] ichichain should continue to read `mintLock`, `redrawConfig`, and token URI as before.
- [ ] No user-facing NFT ownership/tokenURI behavior may depend on SeriesOps.

### Task 7: Verification

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT
npx hardhat compile
npx hardhat test test/doudochain-v2-fixes.test.js
node -e "const a=require('./artifacts/contracts/DOUDOCHAINV2CoreUpgradeable.sol/DOUDOCHAINV2CoreUpgradeable.json'); console.log((a.deployedBytecode.length-2)/2)"

cd /Users/angustsai/thegraph/doudochain_amoy
npm run codegen && npm run build

cd /Users/angustsai/doudochain-backend
npm run typecheck

cd /Users/angustsai/DOUDO-ADMIN
npm run typecheck

cd /Users/angustsai/ichichain
npm test -- GoodsInfo.test.tsx --runInBand
```

Completion requires all commands to pass or any skipped command to have a concrete reason and remaining risk documented.
