# DOUDOCHAIN V2 Merchant Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-merchant attribution to DOUDOCHAIN V2 by recording an opaque `merchantRef` per series in a dedicated registry, published atomically with series creation, without growing the Core contract.

**Architecture:** Two new contracts plus role wiring on the existing, already-deployed Core. `MerchantSeriesRegistry` (UUPS) is the attribution ledger: `mapping(seriesContract => seriesID => bytes32)`. `MerchantSeriesPublisher` (plain, replaceable) is the single publish entry point: in one transaction it calls the existing `Core.createSeriesWithSubPrizes(...)` and then `Registry.linkSeries(...)`, so a series and its merchant link succeed or revert together. Core is **not** redeployed; the Publisher calls it through `IDoudoSeriesPublishing`, an interface whose struct field types mirror Core's, so the ABI selector and calldata match the deployed contract. Detailed merchant data stays in the off-chain DB.

**Tech Stack:** Solidity 0.8.20, OpenZeppelin (Upgradeable + standard) 4.9.5, custom `MinimalAccessControlUpgradeable`, Hardhat 2.28, hardhat-upgrades 3.9, ethers v6, Arbitrum Sepolia.

---

## Deployment Decision

Use **additive deploy, no Core upgrade**.

Reasons:

- Merchant attribution is new contracts (`MerchantSeriesRegistry`, `MerchantSeriesPublisher`) plus role grants on the existing Core proxy. None of Core's behavior changes.
- The Publisher calls the deployed Core's `createSeriesWithSubPrizes` through `IDoudoSeriesPublishing`. Solidity computes the call selector and calldata from struct field types/order, not struct names, so an interface that mirrors Core's `SeriesInput`/`SubPrize` produces byte-identical calls to the live contract. No Core redeploy is required to call it.
- The only Core source change is removing the uncommitted, undeployed `seriesMerchantRefs` mapping (working-tree hygiene), so it never ships in a future Core upgrade. This is a source revert plus a storage-safety check, not a deployment.

Drift guard: because the publish integration test exercises the real Core through `IDoudoSeriesPublishing`, any future change to Core's `SeriesInput`/`SubPrize` that is not mirrored in the interface breaks that test. Core does not need to adopt the shared interface for this feature; the test is the guard.

## Files

- Create: `contracts/interfaces/IDoudoSeriesPublishing.sol`
- Create: `contracts/interfaces/IMerchantSeriesRegistry.sol`
- Create: `contracts/MerchantSeriesRegistry.sol`
- Create: `contracts/MerchantSeriesPublisher.sol`
- Create: `test/doudochain-v2-merchant-attribution.test.js`
- Create: `scripts/deployMerchantAttributionArbSepolia.ts`
- Modify: `contracts/DOUDOCHAINV2CoreUpgradeable.sol` (remove dangling `seriesMerchantRefs` mapping, restore `__gap`)
- Modify: `docs/subgraph-v2-upgradeable-query-mapping.md` (add Registry data source + join)
- Modify: `docs/doudochain-v2-upgradeable-handoff.md` (record deployed addresses)

## Task 1: Failing Merchant Attribution Tests

**Files:**
- Create: `test/doudochain-v2-merchant-attribution.test.js`

- [ ] **Step 1: Write the failing test file**

Create `test/doudochain-v2-merchant-attribution.test.js` with two fixtures (a
registry-only fixture for unit rules, a full-suite fixture for atomic publish)
and the full test set:

```javascript
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const ZERO32 = ethers.ZeroHash;
const MERCHANT_A = ethers.keccak256(ethers.toUtf8Bytes("merchant-A"));
const MERCHANT_B = ethers.keccak256(ethers.toUtf8Bytes("merchant-B"));

function prizeTable(total = 6) {
  return [
    { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 2 },
    { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: total - 2 },
  ];
}

function seriesInput(overrides = {}) {
  return {
    seriesName: "Merchant Series",
    totalTicketNumbers: 6,
    priceInPoints: ethers.parseEther("1"),
    priceInTWD: 100,
    estimateDeliverTime: 1780000000,
    exchangeTokenURI: "ipfs://exchange/",
    unrevealTokenURI: "ipfs://unreveal",
    revealTokenURI: "ipfs://reveal/",
    seriesMetaDataURI: "ipfs://series",
    isPreOrder: false,
    useLuckyNumber: false,
    maxPerWallet: 0,
    ...overrides,
  };
}

async function deployRegistryOnly() {
  const [admin, human, user, other] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory(
    "contracts/MerchantSeriesRegistry.sol:MerchantSeriesRegistry"
  );
  const registry = await upgrades.deployProxy(Registry, [admin.address], {
    initializer: "initialize",
    kind: "uups",
  });
  await registry.waitForDeployment();
  // Grant LINKER_ROLE to admin so unit tests can call linkSeries directly.
  await registry.grantRole(await registry.LINKER_ROLE(), admin.address);
  return { admin, human, user, other, registry };
}

async function deployFullSuite() {
  const [admin, operator, human, user] = await ethers.getSigners();

  // Core.initialize requires non-zero points + router. createSeries calls
  // neither, so a deployed points token + a non-zero placeholder router suffice.
  const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
  const points = await Points.deploy(admin.address, admin.address);
  await points.waitForDeployment();
  const routerPlaceholder = admin.address;

  const Core = await ethers.getContractFactory(
    "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable"
  );
  const core = await upgrades.deployProxy(
    Core,
    [await points.getAddress(), routerPlaceholder],
    { initializer: "initialize", kind: "uups" }
  );
  await core.waitForDeployment();

  const Registry = await ethers.getContractFactory(
    "contracts/MerchantSeriesRegistry.sol:MerchantSeriesRegistry"
  );
  const registry = await upgrades.deployProxy(Registry, [admin.address], {
    initializer: "initialize",
    kind: "uups",
  });
  await registry.waitForDeployment();

  const Publisher = await ethers.getContractFactory(
    "contracts/MerchantSeriesPublisher.sol:MerchantSeriesPublisher"
  );
  const publisher = await Publisher.deploy(admin.address, await registry.getAddress());
  await publisher.waitForDeployment();

  // Publisher is the only series creator + the only linker.
  await core.grantRole(await core.OPERATION_ROLE(), await publisher.getAddress());
  await registry.grantRole(await registry.LINKER_ROLE(), await publisher.getAddress());
  await publisher.grantRole(await publisher.PUBLISHER_OPERATION_ROLE(), operator.address);

  return { admin, operator, human, user, points, core, registry, publisher };
}

describe("Merchant publish — atomic flow", function () {
  it("publishes a series and links the merchant in one transaction", async function () {
    const { operator, core, registry, publisher } = await deployFullSuite();
    const coreAddr = await core.getAddress();
    await publisher
      .connect(operator)
      .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, MERCHANT_A);
    expect(await registry.merchantOf(coreAddr, 0)).to.equal(MERCHANT_A);
  });

  it("emits NewSeries (Core) and SeriesMerchantLinked (Registry) in the same tx", async function () {
    const { operator, core, registry, publisher } = await deployFullSuite();
    const coreAddr = await core.getAddress();
    const publisherAddr = await publisher.getAddress();
    await expect(
      publisher
        .connect(operator)
        .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, MERCHANT_A)
    )
      .to.emit(core, "NewSeries")
      .and.to.emit(registry, "SeriesMerchantLinked")
      .withArgs(coreAddr, 0, MERCHANT_A, publisherAddr);
  });

  it("reverts atomically — a failed link does not advance the series counter", async function () {
    const { operator, core, registry, publisher } = await deployFullSuite();
    const coreAddr = await core.getAddress();
    // Zero ref makes linkSeries revert, which must roll back createSeries.
    await expect(
      publisher
        .connect(operator)
        .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, ZERO32)
    ).to.be.revertedWithCustomError(registry, "ZeroMerchantRef");
    // The next successful publish still gets seriesID 0 — proof no phantom
    // series 0 was created by the reverted tx.
    await publisher
      .connect(operator)
      .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, MERCHANT_A);
    expect(await registry.merchantOf(coreAddr, 0)).to.equal(MERCHANT_A);
  });

  it("allows one merchant to own many series", async function () {
    const { operator, core, registry, publisher } = await deployFullSuite();
    const coreAddr = await core.getAddress();
    await publisher
      .connect(operator)
      .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, MERCHANT_A);
    await publisher
      .connect(operator)
      .publishSeriesWithMerchant(coreAddr, seriesInput(), prizeTable(), false, MERCHANT_A);
    expect(await registry.merchantOf(coreAddr, 0)).to.equal(MERCHANT_A);
    expect(await registry.merchantOf(coreAddr, 1)).to.equal(MERCHANT_A);
  });
});

describe("Publisher access control", function () {
  it("rejects publish from a wallet without PUBLISHER_OPERATION_ROLE", async function () {
    const { human, core, publisher } = await deployFullSuite();
    await expect(
      publisher
        .connect(human)
        .publishSeriesWithMerchant(await core.getAddress(), seriesInput(), prizeTable(), false, MERCHANT_A)
    ).to.be.revertedWith(/is missing role/);
  });

  it("rejects a direct createSeries from a wallet without OPERATION_ROLE", async function () {
    const { human, core } = await deployFullSuite();
    await expect(
      core.connect(human).createSeriesWithSubPrizes(seriesInput(), prizeTable(), false)
    ).to.be.revertedWithCustomError(core, "MissingRole");
  });
});

describe("MerchantSeriesRegistry rules", function () {
  it("rejects a zero merchantRef", async function () {
    const { admin, registry } = await deployRegistryOnly();
    await expect(
      registry.linkSeries(admin.address, 1, ZERO32)
    ).to.be.revertedWithCustomError(registry, "ZeroMerchantRef");
  });

  it("links a series once then rejects a second link", async function () {
    const { admin, registry } = await deployRegistryOnly();
    await registry.linkSeries(admin.address, 1, MERCHANT_A);
    await expect(
      registry.linkSeries(admin.address, 1, MERCHANT_B)
    ).to.be.revertedWithCustomError(registry, "AlreadyLinked");
  });

  it("rejects linkSeries from a wallet without LINKER_ROLE", async function () {
    const { human, registry } = await deployRegistryOnly();
    await expect(
      registry.connect(human).linkSeries(human.address, 1, MERCHANT_A)
    ).to.be.revertedWithCustomError(registry, "MissingRole");
  });

  it("isolates the same seriesID across different series contracts", async function () {
    const { registry, user, other } = await deployRegistryOnly();
    await registry.linkSeries(user.address, 1, MERCHANT_A);
    await registry.linkSeries(other.address, 1, MERCHANT_B);
    expect(await registry.merchantOf(user.address, 1)).to.equal(MERCHANT_A);
    expect(await registry.merchantOf(other.address, 1)).to.equal(MERCHANT_B);
  });

  it("lets admin relink with an audit event and blocks non-admin relink", async function () {
    const { admin, human, registry } = await deployRegistryOnly();
    await registry.linkSeries(admin.address, 1, MERCHANT_A);
    await expect(registry.relinkSeries(admin.address, 1, MERCHANT_B))
      .to.emit(registry, "SeriesMerchantRelinked")
      .withArgs(admin.address, 1, MERCHANT_A, MERCHANT_B, admin.address);
    expect(await registry.merchantOf(admin.address, 1)).to.equal(MERCHANT_B);
    await expect(
      registry.connect(human).relinkSeries(admin.address, 1, MERCHANT_A)
    ).to.be.revertedWithCustomError(registry, "MissingRole");
  });

  it("rejects relink of an unlinked series", async function () {
    const { admin, registry } = await deployRegistryOnly();
    await expect(
      registry.relinkSeries(admin.address, 99, MERCHANT_A)
    ).to.be.revertedWithCustomError(registry, "NotLinked");
  });

  it("allows only UPGRADER_ROLE to authorize an upgrade", async function () {
    const { human, registry } = await deployRegistryOnly();
    await expect(
      registry.connect(human).upgradeToAndCall(human.address, "0x")
    ).to.be.revertedWithCustomError(registry, "MissingRole");
  });
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
npx hardhat test test/doudochain-v2-merchant-attribution.test.js
```

Expected: FAIL. Every test errors because `MerchantSeriesRegistry` and
`MerchantSeriesPublisher` artifacts do not exist yet (`getContractFactory` throws
"artifact ... not found").

## Task 2: Interfaces

**Files:**
- Create: `contracts/interfaces/IDoudoSeriesPublishing.sol`
- Create: `contracts/interfaces/IMerchantSeriesRegistry.sol`

- [ ] **Step 1: Create the series-publishing interface**

Create `contracts/interfaces/IDoudoSeriesPublishing.sol`. The struct field order
and types must mirror `DOUDOCHAINV2CoreUpgradeable` exactly so the ABI selector
and calldata match the deployed Core.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal view of DOUDOCHAINV2CoreUpgradeable's series-creation entry,
/// used by MerchantSeriesPublisher to publish without importing the full Core.
/// Struct field order/types mirror the deployed Core so calldata encoding matches.
interface IDoudoSeriesPublishing {
    struct SubPrize {
        uint256 subPrizeID;
        string prizeGroup;
        string subPrizeName;
        uint256 subPrizeRemainingQuantity;
    }

    struct SeriesInput {
        string seriesName;
        uint256 totalTicketNumbers;
        uint256 priceInPoints;
        uint256 priceInTWD;
        uint256 estimateDeliverTime;
        string exchangeTokenURI;
        string unrevealTokenURI;
        string revealTokenURI;
        string seriesMetaDataURI;
        bool isPreOrder;
        bool useLuckyNumber;
        uint256 maxPerWallet;
    }

    function createSeriesWithSubPrizes(
        SeriesInput calldata input,
        SubPrize[] calldata subPrizes,
        bool markGoodsArrived
    ) external returns (uint256 seriesID);
}
```

- [ ] **Step 2: Create the registry interface**

Create `contracts/interfaces/IMerchantSeriesRegistry.sol`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMerchantSeriesRegistry {
    function linkSeries(
        address seriesContract,
        uint256 seriesID,
        bytes32 merchantRef
    ) external;

    function relinkSeries(
        address seriesContract,
        uint256 seriesID,
        bytes32 newMerchantRef
    ) external;

    function merchantOf(
        address seriesContract,
        uint256 seriesID
    ) external view returns (bytes32);
}
```

- [ ] **Step 3: Compile**

Run:

```bash
npx hardhat compile
```

Expected: compiles. Interfaces alone do not make tests pass yet.

## Task 3: MerchantSeriesRegistry

**Files:**
- Create: `contracts/MerchantSeriesRegistry.sol`
- Test: `test/doudochain-v2-merchant-attribution.test.js` (describe "MerchantSeriesRegistry rules")

- [ ] **Step 1: Implement the registry**

Create `contracts/MerchantSeriesRegistry.sol`. Reuse the codebase's
`MinimalAccessControlUpgradeable` (the same base Core uses) for consistency.

```solidity
// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./access/MinimalAccessControlUpgradeable.sol";
import "./interfaces/IMerchantSeriesRegistry.sol";

/// @notice Canonical on-chain attribution ledger mapping a series to a merchant.
/// Detailed merchant records live off-chain; only an opaque merchantRef is stored.
contract MerchantSeriesRegistry is
    Initializable,
    UUPSUpgradeable,
    MinimalAccessControlUpgradeable,
    IMerchantSeriesRegistry
{
    bytes32 public constant LINKER_ROLE = keccak256("LINKER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // seriesContract => seriesID => merchantRef
    mapping(address => mapping(uint256 => bytes32)) public seriesMerchantRefs;

    error ZeroMerchantRef();
    error AlreadyLinked(address seriesContract, uint256 seriesID);
    error NotLinked(address seriesContract, uint256 seriesID);

    event SeriesMerchantLinked(
        address indexed seriesContract,
        uint256 indexed seriesID,
        bytes32 indexed merchantRef,
        address operator
    );

    event SeriesMerchantRelinked(
        address indexed seriesContract,
        uint256 indexed seriesID,
        bytes32 previousMerchantRef,
        bytes32 newMerchantRef,
        address operator
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) public initializer {
        __UUPSUpgradeable_init();
        __MinimalAccessControl_init(admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    function linkSeries(
        address seriesContract,
        uint256 seriesID,
        bytes32 merchantRef
    ) external override onlyRole(LINKER_ROLE) {
        if (merchantRef == bytes32(0)) revert ZeroMerchantRef();
        if (seriesMerchantRefs[seriesContract][seriesID] != bytes32(0)) {
            revert AlreadyLinked(seriesContract, seriesID);
        }
        seriesMerchantRefs[seriesContract][seriesID] = merchantRef;
        emit SeriesMerchantLinked(seriesContract, seriesID, merchantRef, msg.sender);
    }

    function relinkSeries(
        address seriesContract,
        uint256 seriesID,
        bytes32 newMerchantRef
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newMerchantRef == bytes32(0)) revert ZeroMerchantRef();
        bytes32 previous = seriesMerchantRefs[seriesContract][seriesID];
        if (previous == bytes32(0)) revert NotLinked(seriesContract, seriesID);
        seriesMerchantRefs[seriesContract][seriesID] = newMerchantRef;
        emit SeriesMerchantRelinked(seriesContract, seriesID, previous, newMerchantRef, msg.sender);
    }

    function merchantOf(
        address seriesContract,
        uint256 seriesID
    ) external view override returns (bytes32) {
        return seriesMerchantRefs[seriesContract][seriesID];
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    uint256[49] private __gap;
}
```

- [ ] **Step 2: Run the registry tests to verify GREEN**

Run:

```bash
npx hardhat test test/doudochain-v2-merchant-attribution.test.js --grep "Registry rules"
```

Expected: all "MerchantSeriesRegistry rules" tests pass (zero ref, link-once,
role gate, composite key, relink + audit event, relink-unlinked, upgrade auth).

- [ ] **Step 3: Commit**

```bash
git add contracts/interfaces/IDoudoSeriesPublishing.sol contracts/interfaces/IMerchantSeriesRegistry.sol contracts/MerchantSeriesRegistry.sol test/doudochain-v2-merchant-attribution.test.js
git commit -m "feat(merchant): add MerchantSeriesRegistry attribution ledger"
```

## Task 4: MerchantSeriesPublisher

**Files:**
- Create: `contracts/MerchantSeriesPublisher.sol`
- Test: `test/doudochain-v2-merchant-attribution.test.js` (describe "Merchant publish — atomic flow", "Publisher access control")

- [ ] **Step 1: Implement the publisher**

Create `contracts/MerchantSeriesPublisher.sol`. It is plain (non-upgradeable) and
replaceable; it uses standard OpenZeppelin `AccessControl`.

```solidity
// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IDoudoSeriesPublishing.sol";
import "./interfaces/IMerchantSeriesRegistry.sol";

/// @notice Single atomic entry point for publishing a series and linking its
/// merchant in one transaction. Holds no core business state; replaceable by
/// deploying a new Publisher and re-granting roles.
contract MerchantSeriesPublisher is AccessControl {
    bytes32 public constant PUBLISHER_OPERATION_ROLE = keccak256("PUBLISHER_OPERATION_ROLE");

    IMerchantSeriesRegistry public immutable registry;

    error ZeroAddress();

    event SeriesPublished(
        address indexed core,
        uint256 indexed seriesID,
        bytes32 indexed merchantRef,
        address operator
    );

    constructor(address admin, address registry_) {
        if (admin == address(0) || registry_ == address(0)) revert ZeroAddress();
        registry = IMerchantSeriesRegistry(registry_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PUBLISHER_OPERATION_ROLE, admin);
    }

    function publishSeriesWithMerchant(
        address core,
        IDoudoSeriesPublishing.SeriesInput calldata input,
        IDoudoSeriesPublishing.SubPrize[] calldata subPrizes,
        bool markGoodsArrived,
        bytes32 merchantRef
    ) external onlyRole(PUBLISHER_OPERATION_ROLE) returns (uint256 seriesID) {
        seriesID = IDoudoSeriesPublishing(core).createSeriesWithSubPrizes(
            input,
            subPrizes,
            markGoodsArrived
        );
        registry.linkSeries(core, seriesID, merchantRef);
        emit SeriesPublished(core, seriesID, merchantRef, msg.sender);
    }
}
```

- [ ] **Step 2: Run the publish + access tests to verify GREEN**

Run:

```bash
npx hardhat test test/doudochain-v2-merchant-attribution.test.js --grep "atomic flow|access control"
```

Expected: atomic publish, same-tx events, atomic rollback (counter not advanced),
one-merchant-many-series, and both access-control tests pass.

- [ ] **Step 3: Run the full new suite to verify GREEN**

Run:

```bash
npx hardhat test test/doudochain-v2-merchant-attribution.test.js
```

Expected: all tests in the file pass.

- [ ] **Step 4: Commit**

```bash
git add contracts/MerchantSeriesPublisher.sol
git commit -m "feat(merchant): add MerchantSeriesPublisher for atomic series+merchant publish"
```

## Task 5: Remove Dangling Core Merchant Mapping

**Files:**
- Modify: `contracts/DOUDOCHAINV2CoreUpgradeable.sol` (storage tail)

- [ ] **Step 1: Remove the uncommitted mapping and restore the gap**

In `contracts/DOUDOCHAINV2CoreUpgradeable.sol`, the storage tail currently reads:

```solidity
    mapping(uint256 => uint256) public seriesLockDuration;
    mapping(uint256 => bytes32) public seriesMerchantRefs;

    uint256[38] private __gap;
```

Change it to remove `seriesMerchantRefs` and restore the gap to 39:

```solidity
    mapping(uint256 => uint256) public seriesLockDuration;

    uint256[39] private __gap;
```

Merchant attribution now lives entirely in `MerchantSeriesRegistry`; Core holds
no merchant storage.

- [ ] **Step 2: Confirm storage-layout safety against the deployed proxy**

This proves removing the mapping does not corrupt the deployed Core's storage
layout. Run:

```bash
npx hardhat compile
```

Expected: compiles. The deployed Core implementation (per the OZ manifest) does
not contain `seriesMerchantRefs`, so the reverted source restores the original
`__gap[39]` layout. If a later check shows the mapping was actually deployed, do
NOT delete the slot — keep it reserved (rename to `__deprecated_seriesMerchantRefs`)
and leave `__gap` at 38; see the design doc Migration Notes.

- [ ] **Step 3: Confirm the existing Core suite still passes (hot path intact)**

Run:

```bash
npm test
```

Expected: the existing Core/module tests pass unchanged, confirming the user hot
path (mint, mintAndReveal, reveal, exchangePrize) is unaffected.

- [ ] **Step 4: Commit**

```bash
git add contracts/DOUDOCHAINV2CoreUpgradeable.sol
git commit -m "refactor(core): drop unused seriesMerchantRefs, restore storage gap"
```

## Task 6: Deployment And Wiring Script (Arbitrum Sepolia)

**Files:**
- Create: `scripts/deployMerchantAttributionArbSepolia.ts`

- [ ] **Step 1: Implement the deploy + wire + verify script**

Create `scripts/deployMerchantAttributionArbSepolia.ts`, modeled on
`scripts/upgradeCoreArbSepolia.ts`.

```typescript
import { ethers, upgrades, run } from "hardhat";

// Existing deployed Core proxy on Arbitrum Sepolia (see upgradeCoreArbSepolia.ts).
const DEFAULTS = {
  core: "0xf75395A8cd753f47135cfcaE00D2706252c3E0F5",
};

const REGISTRY_FQN = "contracts/MerchantSeriesRegistry.sol:MerchantSeriesRegistry";
const PUBLISHER_FQN = "contracts/MerchantSeriesPublisher.sol:MerchantSeriesPublisher";
const CORE_FQN = "contracts/DOUDOCHAINV2CoreUpgradeable.sol:DOUDOCHAINV2CoreUpgradeable";

async function verify(address: string, contract?: string, args: any[] = []) {
  try {
    await run("verify:verify", { address, constructorArguments: args, contract });
    console.log("Verified:", address, contract || "");
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Already verified:", address, contract || "");
      return;
    }
    console.warn("Verify failed:", address, contract || "", message);
  }
}

async function main() {
  const coreProxy = process.env.DOUDOCHAIN_CORE_PROXY_ADDRESS || DEFAULTS.core;
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const admin = process.env.MERCHANT_REGISTRY_ADMIN || deployerAddr;
  const operator = process.env.MERCHANT_PUBLISHER_OPERATOR || deployerAddr;

  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, network.chainId.toString());
  console.log("Deployer:", deployerAddr);
  console.log("Core proxy:", coreProxy);
  console.log("Registry admin:", admin);
  console.log("Publisher operator:", operator);

  // 1. Registry (UUPS proxy).
  const Registry = await ethers.getContractFactory(REGISTRY_FQN);
  const registry: any = await upgrades.deployProxy(Registry, [admin], {
    initializer: "initialize",
    kind: "uups",
  });
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("MerchantSeriesRegistry proxy:", registryAddr);

  // 2. Publisher (plain).
  const Publisher = await ethers.getContractFactory(PUBLISHER_FQN);
  const publisher: any = await Publisher.deploy(admin, registryAddr);
  await publisher.waitForDeployment();
  const publisherAddr = await publisher.getAddress();
  console.log("MerchantSeriesPublisher:", publisherAddr);

  // 3. Wire roles.
  const core: any = await ethers.getContractAt(CORE_FQN, coreProxy);
  const OPERATION_ROLE = await core.OPERATION_ROLE();
  const LINKER_ROLE = await registry.LINKER_ROLE();
  const PUBLISHER_OPERATION_ROLE = await publisher.PUBLISHER_OPERATION_ROLE();

  await (await core.grantRole(OPERATION_ROLE, publisherAddr)).wait();
  await (await registry.grantRole(LINKER_ROLE, publisherAddr)).wait();
  if (operator.toLowerCase() !== admin.toLowerCase()) {
    await (await publisher.grantRole(PUBLISHER_OPERATION_ROLE, operator)).wait();
  }

  // 4. Post-deploy assertions — fail loudly on incorrect wiring.
  if (!(await core.hasRole(OPERATION_ROLE, publisherAddr))) {
    throw new Error("Publisher is missing Core OPERATION_ROLE");
  }
  if (!(await registry.hasRole(LINKER_ROLE, publisherAddr))) {
    throw new Error("Publisher is missing Registry LINKER_ROLE");
  }
  if (!(await publisher.hasRole(PUBLISHER_OPERATION_ROLE, operator))) {
    throw new Error("Operator is missing Publisher PUBLISHER_OPERATION_ROLE");
  }
  console.log("Role wiring OK.");

  // 5. Verify.
  const registryImpl = await upgrades.erc1967.getImplementationAddress(registryAddr);
  console.log("Registry implementation:", registryImpl);
  await verify(registryImpl, REGISTRY_FQN);
  await verify(publisherAddr, PUBLISHER_FQN, [admin, registryAddr]);

  console.log("\nNEXT OPS STEP (manual, after confirming a Publisher publish works):");
  console.log("Revoke Core OPERATION_ROLE from every human/back-end wallet so all");
  console.log("series creation must go through the Publisher. Review whether any");
  console.log("non-publish operational setters need a separate role first.");
  console.log("Example: core.revokeRole(OPERATION_ROLE, <humanWallet>)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Dry-run compile/type-check of the script**

Run:

```bash
npx hardhat compile
```

Expected: compiles (the script is type-checked on next hardhat run; this confirms
contracts compile). Do not broadcast to Arbitrum Sepolia until Task 7 passes.

- [ ] **Step 3: Commit**

```bash
git add scripts/deployMerchantAttributionArbSepolia.ts
git commit -m "chore(deploy): add merchant attribution deploy+wire script (Arb Sepolia)"
```

## Task 7: Full Verification, Subgraph, And Handoff

**Files:**
- Modify: `docs/subgraph-v2-upgradeable-query-mapping.md`
- Modify: `docs/doudochain-v2-upgradeable-handoff.md`

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass, including the new merchant attribution file and the
existing Core/module suites.

- [ ] **Step 2: Run the bytecode size check**

Run:

```bash
npx hardhat size-contracts
```

Expected: `DOUDOCHAINV2CoreUpgradeable` is below 24,576 bytes and did not grow
from this work (no merchant code added to Core). `MerchantSeriesRegistry` and
`MerchantSeriesPublisher` are well below the limit.

- [ ] **Step 3: Document the subgraph data source**

In `docs/subgraph-v2-upgradeable-query-mapping.md`, add a section documenting:

- New data source: `MerchantSeriesRegistry` proxy address.
- Handlers: `SeriesMerchantLinked(seriesContract, seriesID, merchantRef, operator)`
  patches `merchantRef` onto the existing `Series` entity keyed by
  `(seriesContract, seriesID)`; `SeriesMerchantRelinked(...)` updates it and may
  record a correction-history entity.
- Join rule: `Core.NewSeries(seriesID)` (emitted first in the publish tx) creates
  the `Series`; the Registry event fills in `merchantRef`.
- Orphan alert: a `Series` with a null `merchantRef` indicates a series created
  outside the Publisher; surface it for reconciliation.

Note for the subgraph repo (`thegraph/doudochain_amoy`, Arbitrum Sepolia): add the
Registry ABI and address as a new data source and implement the two handlers.

- [ ] **Step 4: Deploy to Arbitrum Sepolia and record addresses**

Run:

```bash
npx hardhat run scripts/deployMerchantAttributionArbSepolia.ts --network arbitrumSepolia
```

Expected: prints Registry proxy, Publisher address, "Role wiring OK.", and the
manual revoke reminder. Then update `docs/doudochain-v2-upgradeable-handoff.md`
with the Registry proxy, Registry implementation, and Publisher addresses, plus
the new subgraph data source.

- [ ] **Step 5: Commit**

```bash
git add docs/subgraph-v2-upgradeable-query-mapping.md docs/doudochain-v2-upgradeable-handoff.md
git commit -m "docs(merchant): document registry subgraph source and deployed addresses"
```

## Spec Coverage Traceability

| Spec requirement | Task / test |
| --- | --- |
| One series, one merchant | Task 3 `linkSeries` + "links a series once then rejects a second link" |
| One merchant, many series | Task 4 "allows one merchant to own many series" |
| Opaque `bytes32` merchantRef, off-chain detail | Interfaces + Registry storage (Task 2/3) |
| Atomic publish | Task 4 "publishes ... in one transaction", same-tx events |
| Atomic rollback (no orphan on link failure) | Task 4 "reverts atomically — counter not advanced" |
| Composite `(seriesContract, seriesID)` key | Task 3 "isolates the same seriesID across different series contracts" |
| Link-once, non-zero ref, LINKER_ROLE only | Task 3 registry-rule tests |
| Admin-only relink with audit event | Task 3 "lets admin relink ... blocks non-admin" |
| Registry UUPS upgrade authorization | Task 3 "allows only UPGRADER_ROLE to authorize an upgrade" |
| Publisher-only series creation invariant | Task 4 "rejects a direct createSeries ..." + deploy revoke reminder |
| Core not grown / hot path untouched | Task 5 `npm test` + Task 7 `size-contracts` |
| Remove dangling Core mapping | Task 5 |
| The Graph two-source join | Task 7 subgraph docs |
| Deploy + role wiring with assertions | Task 6 |

## Implementation Plan Boundary

This plan delivers the on-chain merchant attribution layer and its deploy wiring.
Out of scope: the off-chain merchant database schema/backend, the subgraph repo's
handler code (documented here, implemented in `thegraph/doudochain_amoy`), and any
future merchant-as-on-chain-actor identity work noted in the design doc's
Extensibility section.
