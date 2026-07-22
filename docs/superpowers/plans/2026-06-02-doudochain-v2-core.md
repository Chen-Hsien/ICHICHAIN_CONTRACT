# DOUDOCHAIN V2 Core Lottery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fresh DOUDOCHAIN V2 lottery contract that charges soulbound DOUDO points, supports atomic series setup, reservations, lucky numbers, bundles, refunds, redraw channels, collection-book rewards, range-based series membership, pause controls, and a renamed public data model.

**Architecture:** Create `contracts/DOUDOCHAINV2.sol` and contract `DOUDOCHAINV2` instead of mutating the deployed V1 contract. Keep ERC721A and Chainlink VRF V2.5, remove all native/oracle/currency payment paths, integrate `IDoudoPoints`, and use focused helpers for series setup, paid minting, reveal, refund, redraw, collection-book rewards, and range tracking.

**Tech Stack:** Solidity 0.8.20, ERC721A 4.2.3, OpenZeppelin 4.9.5, Chainlink VRF V2.5, Hardhat 2.28, ethers v6, Chai.

---

## Current Decision Updates

- Series setup is atomic and has a batch path. `createSeriesWithSubPrizes` and `batchCreateSeriesWithSubPrizes` validate subprize quantity before arrival can be marked, so operations cannot accidentally mark `goodsArrived` without a complete prize table.
- Metadata remains editable after goods arrival through guarded metadata update functions. Arrival no longer freezes `exchangeTokenURI`, `unrevealTokenURI`, `revealTokenURI`, or `seriesMetaDataURI`.
- Reveal stays trust-minimized in the callback path. This plan does not split VRF callback and prize settlement into a manually callable settle step; anti-gas-cap work is handled by hard reveal batch caps, frontend-controlled batch sizing, and callback gas configuration.
- Frontend controls reveal batching and retry UX, while the contract enforces the maximum batch size and token ownership/status rules.
- If `requestRandomWords` reverts, the whole transaction reverts and token status remains unrevealed. No extra stuck-state repair path is needed for a failed VRF request transaction.
- V2 is confirmed fully points-only. The old `currencyList`, token payment registry, native MATIC payment path, and price feed path are not part of V2.
- The deployed contract name is `DOUDOCHAINV2`.
- Collection Book NFT rewards and unlock rewards are issued by `DOUDOCHAINV2` through a dedicated `COLLECTION_BOOK_ROLE`; Collection Book does not mint its own reward NFTs.
- Naming and data model are normalized around `doudoSeries`, `priceInPoints`, explicit reason codes, range-based membership, and subgraph-friendly events.

## File Structure

- Create: `contracts/DOUDOCHAINV2.sol` — fresh V2 lottery contract.
- Create: `contracts/interfaces/IDoudoPoints.sol` — already created by the points plan; import it here.
- Create: `contracts/test/VRFCoordinatorV2PlusMock.sol` — deterministic local VRF helper for V2 tests if Chainlink's mock does not match the request shape.
- Create: `test/doudochain-v2-core.test.js` — integration tests for points payment, series setup, lock, lucky numbers, bundles, refunds, redraw, pause.
- Create: `scripts/deployDoudochainV2ArbSepolia.ts` — deployment and role-grant checklist.

## Task 1: Contract Skeleton And Series Setup

**Files:**
- Create: `contracts/DOUDOCHAINV2.sol`
- Test: `test/doudochain-v2-core.test.js`

- [ ] **Step 1: Write failing tests for atomic series setup**

Create `test/doudochain-v2-core.test.js`:

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

function prizeTable(total = 10) {
  return [
    { subPrizeID: 1, prizeGroup: "A", subPrizeName: "A1", subPrizeRemainingQuantity: 2 },
    { subPrizeID: 2, prizeGroup: "B", subPrizeName: "B1", subPrizeRemainingQuantity: total - 2 },
  ];
}

async function deployCore() {
  const [admin, user] = await ethers.getSigners();
  const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
  const points = await Points.deploy(admin.address, admin.address);
  await points.waitForDeployment();

  const Core = await ethers.getContractFactory("contracts/DOUDOCHAINV2.sol:DOUDOCHAINV2");
  const core = await Core.deploy(await points.getAddress(), ethers.ZeroAddress, 0, ethers.ZeroHash, 0);
  await core.waitForDeployment();

  return { admin, user, points, core };
}

describe("DOUDOCHAINV2 core", function () {
  it("creates a series with subprizes atomically", async function () {
    const { core } = await deployCore();
    const input = {
      seriesName: "Atomic Series",
      totalTicketNumbers: 10,
      priceInPoints: ethers.parseEther("3"),
      priceInTWD: 100,
      estimateDeliverTime: 1780000000,
      exchangeTokenURI: "ipfs://exchange/",
      unrevealTokenURI: "ipfs://unreveal",
      revealTokenURI: "ipfs://reveal/",
      seriesMetaDataURI: "ipfs://series",
      isPreOrder: false,
      useLuckyNumber: true,
      maxPerWallet: 3
    };

    await expect(core.createSeriesWithSubPrizes(input, prizeTable(10), true))
      .to.emit(core, "NewSeries")
      .withArgs(0, "Atomic Series");

    const series = await core.doudoSeries(0);
    expect(series.seriesName).to.equal("Atomic Series");
    expect(series.totalTicketNumbers).to.equal(10);
    expect(series.priceInPoints).to.equal(ethers.parseEther("3"));
    expect(series.isGoodsArrived).to.equal(true);
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run: `npx hardhat test test/doudochain-v2-core.test.js --grep "creates a series"`

Expected: FAIL because `DOUDOCHAINV2` does not exist.

- [ ] **Step 3: Add V2 skeleton and series setup code**

Create `contracts/DOUDOCHAINV2.sol` with this starting structure:

```solidity
// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "erc721a/contracts/ERC721A.sol";
import "./interfaces/IDoudoPoints.sol";

contract DOUDOCHAINV2 is ERC721A, AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");
    bytes32 public constant ADMINMINT_ROLE = keccak256("ADMINMINT_ROLE");
    bytes32 public constant COLLECTION_BOOK_ROLE = keccak256("COLLECTION_BOOK_ROLE");

    IDoudoPoints public immutable doudoPoints;

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

    struct Series {
        string seriesName;
        uint256 totalTicketNumbers;
        uint256 remainingTicketNumbers;
        uint256 priceInPoints;
        bool isGoodsArrived;
        uint256 estimateDeliverTime;
        uint256 exchangeExpireTime;
        string exchangeTokenURI;
        string unrevealTokenURI;
        string revealTokenURI;
        string seriesMetaDataURI;
        uint256 priceInTWD;
        bool isRefund;
        bool isPreOrder;
        bool useLuckyNumber;
        uint256 maxPerWallet;
    }

    mapping(uint256 => Series) public doudoSeries;
    mapping(uint256 => SubPrize[]) public seriesSubPrizes;
    uint256 private seriesCounter;

    error EmptySubPrizes();
    error SubprizeQuantityNotEqual();
    error InvalidSeriesInput();

    event NewSeries(uint256 indexed seriesID, string seriesName);
    event NewSubPrize(uint256 indexed seriesID, uint256 subPrizeID, string prizeGroup, string subPrizeName, uint256 subPrizeRemainingQuantity);
    event UpdateSeriesInformation(uint256 indexed seriesID, bool isGoodsArrived, uint256 estimateDeliverTime, uint256 exchangeExpireTime, string exchangeTokenURI, string unrevealTokenURI, string revealTokenURI, string seriesMetaDataURI);

    constructor(
        address doudoPointsAddress,
        address,
        uint256,
        bytes32,
        uint16
    ) ERC721A("DOUDOCHAIN", "DOUDO") {
        doudoPoints = IDoudoPoints(doudoPointsAddress);
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(OPERATION_ROLE, msg.sender);
        _setupRole(ADMINMINT_ROLE, msg.sender);
        _setupRole(COLLECTION_BOOK_ROLE, msg.sender);
    }

    function createSeriesWithSubPrizes(
        SeriesInput calldata input,
        SubPrize[] calldata subPrizes,
        bool markGoodsArrived
    ) external onlyRole(OPERATION_ROLE) returns (uint256 seriesID) {
        _validateSeriesInput(input, subPrizes);
        seriesID = seriesCounter++;

        Series storage series = doudoSeries[seriesID];
        series.seriesName = input.seriesName;
        series.totalTicketNumbers = input.totalTicketNumbers;
        series.remainingTicketNumbers = input.totalTicketNumbers;
        series.priceInPoints = input.priceInPoints;
        series.priceInTWD = input.priceInTWD;
        series.estimateDeliverTime = input.estimateDeliverTime;
        series.exchangeExpireTime = input.estimateDeliverTime + 60 days;
        series.exchangeTokenURI = input.exchangeTokenURI;
        series.unrevealTokenURI = input.unrevealTokenURI;
        series.revealTokenURI = input.revealTokenURI;
        series.seriesMetaDataURI = input.seriesMetaDataURI;
        series.isPreOrder = input.isPreOrder;
        series.useLuckyNumber = input.useLuckyNumber;
        series.maxPerWallet = input.maxPerWallet;

        for (uint256 i = 0; i < subPrizes.length; i++) {
            seriesSubPrizes[seriesID].push(subPrizes[i]);
            emit NewSubPrize(seriesID, subPrizes[i].subPrizeID, subPrizes[i].prizeGroup, subPrizes[i].subPrizeName, subPrizes[i].subPrizeRemainingQuantity);
        }

        if (markGoodsArrived) {
            series.isGoodsArrived = true;
            uint256 nowTime = block.timestamp;
            series.estimateDeliverTime = nowTime;
            series.exchangeExpireTime = nowTime + 60 days;
        }

        emit NewSeries(seriesID, input.seriesName);
        emit UpdateSeriesInformation(seriesID, series.isGoodsArrived, series.estimateDeliverTime, series.exchangeExpireTime, series.exchangeTokenURI, series.unrevealTokenURI, series.revealTokenURI, series.seriesMetaDataURI);
    }

    function _validateSeriesInput(SeriesInput calldata input, SubPrize[] calldata subPrizes) internal pure {
        if (input.totalTicketNumbers == 0 || input.priceInPoints == 0) revert InvalidSeriesInput();
        if (bytes(input.seriesName).length == 0 || bytes(input.unrevealTokenURI).length == 0 || bytes(input.revealTokenURI).length == 0 || bytes(input.seriesMetaDataURI).length == 0) revert InvalidSeriesInput();
        if (subPrizes.length == 0) revert EmptySubPrizes();

        uint256 totalPrizeQuantity;
        for (uint256 i = 0; i < subPrizes.length; i++) {
            totalPrizeQuantity += subPrizes[i].subPrizeRemainingQuantity;
        }
        if (totalPrizeQuantity != input.totalTicketNumbers) revert SubprizeQuantityNotEqual();
    }
}
```

- [ ] **Step 4: Run atomic series test**

Run: `npx hardhat test test/doudochain-v2-core.test.js --grep "creates a series"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/DOUDOCHAINV2.sol test/doudochain-v2-core.test.js
git commit -m "feat: add atomic V2 series setup"
```

## Task 2: Batch Series Setup And Metadata Flexibility

**Files:**
- Modify: `contracts/DOUDOCHAINV2.sol`
- Modify: `test/doudochain-v2-core.test.js`

- [ ] **Step 1: Add failing tests for batch setup and metadata after arrival**

Append:

```javascript
  it("batch creates multiple series and keeps metadata editable after arrival", async function () {
    const { core } = await deployCore();
    const base = {
      seriesName: "Series 1",
      totalTicketNumbers: 10,
      priceInPoints: ethers.parseEther("3"),
      priceInTWD: 100,
      estimateDeliverTime: 1780000000,
      exchangeTokenURI: "ipfs://exchange/",
      unrevealTokenURI: "ipfs://unreveal",
      revealTokenURI: "ipfs://reveal/",
      seriesMetaDataURI: "ipfs://series",
      isPreOrder: false,
      useLuckyNumber: false,
      maxPerWallet: 0
    };

    await core.batchCreateSeriesWithSubPrizes(
      [base, { ...base, seriesName: "Series 2" }],
      [prizeTable(10), prizeTable(10)],
      [true, false]
    );

    await core.updateSeriesMetadata(0, "ipfs://exchange2/", "ipfs://unreveal2", "ipfs://reveal2/", "ipfs://series2");

    const updated = await core.doudoSeries(0);
    expect(updated.exchangeTokenURI).to.equal("ipfs://exchange2/");
    expect(updated.seriesMetaDataURI).to.equal("ipfs://series2");
  });
```

- [ ] **Step 2: Implement batch and metadata functions**

Add to `contracts/DOUDOCHAINV2.sol`:

```solidity
error BatchLengthMismatch();
error BatchTooLarge();
uint256 public constant MAX_BATCH_SERIES_CREATE = 10;

function batchCreateSeriesWithSubPrizes(
    SeriesInput[] calldata inputs,
    SubPrize[][] calldata subPrizesList,
    bool[] calldata markGoodsArrivedList
) external onlyRole(OPERATION_ROLE) returns (uint256[] memory seriesIDs) {
    if (inputs.length != subPrizesList.length || inputs.length != markGoodsArrivedList.length) revert BatchLengthMismatch();
    if (inputs.length == 0 || inputs.length > MAX_BATCH_SERIES_CREATE) revert BatchTooLarge();

    seriesIDs = new uint256[](inputs.length);
    for (uint256 i = 0; i < inputs.length; i++) {
        seriesIDs[i] = _createSeriesWithSubPrizes(inputs[i], subPrizesList[i], markGoodsArrivedList[i]);
    }
}

function updateSeriesMetadata(
    uint256 seriesID,
    string calldata exchangeTokenURI,
    string calldata unrevealTokenURI,
    string calldata revealTokenURI,
    string calldata seriesMetaDataURI
) external onlyRole(OPERATION_ROLE) {
    Series storage series = doudoSeries[seriesID];
    if (bytes(unrevealTokenURI).length == 0 || bytes(revealTokenURI).length == 0 || bytes(seriesMetaDataURI).length == 0) revert InvalidSeriesInput();
    series.exchangeTokenURI = exchangeTokenURI;
    series.unrevealTokenURI = unrevealTokenURI;
    series.revealTokenURI = revealTokenURI;
    series.seriesMetaDataURI = seriesMetaDataURI;
    emit UpdateSeriesInformation(seriesID, series.isGoodsArrived, series.estimateDeliverTime, series.exchangeExpireTime, exchangeTokenURI, unrevealTokenURI, revealTokenURI, seriesMetaDataURI);
}
```

Refactor the public `createSeriesWithSubPrizes` body into an internal `_createSeriesWithSubPrizes(...)` and have both public create functions call it.

- [ ] **Step 3: Run tests**

Run: `npx hardhat test test/doudochain-v2-core.test.js --grep "batch creates"`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add contracts/DOUDOCHAINV2.sol test/doudochain-v2-core.test.js
git commit -m "feat: add batch setup and metadata updates"
```

## Task 3: Points-Only Mint, Reservations, Lucky Numbers, Wallet Caps

**Files:**
- Modify: `contracts/DOUDOCHAINV2.sol`
- Modify: `test/doudochain-v2-core.test.js`

- [ ] **Step 1: Add failing mint tests**

Append:

```javascript
  it("burns points, enforces reservation, lucky-number uniqueness, and wallet cap", async function () {
    const { admin, user, points, core } = await deployCore();
    const burnerRole = await points.BURNER_ROLE();
    await points.grantRole(burnerRole, await core.getAddress());
    await points.mint(user.address, ethers.parseEther("100"));

    const input = {
      seriesName: "Lucky Series",
      totalTicketNumbers: 10,
      priceInPoints: ethers.parseEther("3"),
      priceInTWD: 100,
      estimateDeliverTime: 1780000000,
      exchangeTokenURI: "ipfs://exchange/",
      unrevealTokenURI: "ipfs://unreveal",
      revealTokenURI: "ipfs://reveal/",
      seriesMetaDataURI: "ipfs://series",
      isPreOrder: false,
      useLuckyNumber: true,
      maxPerWallet: 2
    };
    await core.createSeriesWithSubPrizes(input, prizeTable(10), true);

    await core.connect(user).mint(0, [1, 2]);

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("94"));
    await expect(core.connect(user).mint(0, [2])).to.be.revertedWithCustomError(core, "LuckyNumberTaken");
    await expect(core.connect(user).mint(0, [3])).to.be.revertedWithCustomError(core, "WalletCapExceeded");
    expect(await core.mintLockOwner(0)).to.equal(user.address);
  });
```

- [ ] **Step 2: Implement mint state and errors**

Add to `DOUDOCHAINV2.sol`:

```solidity
struct TicketStatus {
    uint256 seriesID;
    uint256 tokenRevealedPrize;
    bool tokenExchange;
    bool tokenRevealed;
    uint16 luckyNumber;
}

mapping(uint256 => TicketStatus) public ticketStatusDetail;
mapping(uint256 => mapping(uint16 => bool)) public luckyNumberUsed;
mapping(uint256 => mapping(address => uint256)) public mintedPerWallet;
mapping(uint256 => address) public mintLockOwner;
mapping(uint256 => uint256) public mintLockUntil;
uint256 public defaultLockDuration = 900;

error GoodsNotArrived();
error NotEnoughNFTsRemaining();
error LuckyNumberTaken();
error LuckyNumberOutOfRange();
error WalletCapExceeded();
error SeriesReserved();

event NewTicketStatus(uint256 indexed tokenID, uint256 indexed seriesID, uint256 tokenRevealedPrize, bool tokenExchange, bool tokenRevealed, address tokenOwner, uint16 luckyNumber);
event MintLockUpdated(uint256 indexed seriesID, address indexed owner, uint256 until);
```

- [ ] **Step 3: Implement points-only mint**

Add:

```solidity
function mint(uint256 seriesID, uint16[] calldata luckyNumbers) external nonReentrant whenNotPaused {
    Series storage series = doudoSeries[seriesID];
    uint256 quantity = luckyNumbers.length;
    if (!series.isGoodsArrived) revert GoodsNotArrived();
    if (quantity == 0 || quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
    _checkAndRefreshMintLock(seriesID, msg.sender);
    _checkWalletCap(seriesID, msg.sender, quantity);
    doudoPoints.burnFromWithReason(msg.sender, quantity * series.priceInPoints, keccak256("LOTTERY_MINT"));
    _mintTickets(seriesID, msg.sender, luckyNumbers);
}

function _mintTickets(uint256 seriesID, address to, uint16[] calldata luckyNumbers) internal {
    Series storage series = doudoSeries[seriesID];
    uint256 quantity = luckyNumbers.length;
    uint256 startTokenId = _nextTokenId();
    _safeMint(to, quantity);
    for (uint256 i = 0; i < quantity; i++) {
        uint16 luckyNumber = _consumeLuckyNumber(seriesID, series.useLuckyNumber, luckyNumbers[i]);
        uint256 tokenId = startTokenId + i;
        ticketStatusDetail[tokenId].seriesID = seriesID;
        ticketStatusDetail[tokenId].luckyNumber = luckyNumber;
        emit NewTicketStatus(tokenId, seriesID, 0, false, false, to, luckyNumber);
    }
    series.remainingTicketNumbers -= quantity;
    mintedPerWallet[seriesID][to] += quantity;
}

function _consumeLuckyNumber(uint256 seriesID, bool useLuckyNumber, uint16 luckyNumber) internal returns (uint16) {
    if (!useLuckyNumber) return 0;
    Series storage series = doudoSeries[seriesID];
    if (luckyNumber == 0 || luckyNumber > series.totalTicketNumbers) revert LuckyNumberOutOfRange();
    if (luckyNumberUsed[seriesID][luckyNumber]) revert LuckyNumberTaken();
    luckyNumberUsed[seriesID][luckyNumber] = true;
    return luckyNumber;
}

function _checkWalletCap(uint256 seriesID, address user, uint256 quantity) internal view {
    uint256 cap = doudoSeries[seriesID].maxPerWallet;
    if (cap != 0 && mintedPerWallet[seriesID][user] + quantity > cap) revert WalletCapExceeded();
}

function _checkAndRefreshMintLock(uint256 seriesID, address user) internal {
    if (block.timestamp < mintLockUntil[seriesID] && mintLockOwner[seriesID] != user) revert SeriesReserved();
    mintLockOwner[seriesID] = user;
    mintLockUntil[seriesID] = block.timestamp + defaultLockDuration;
    emit MintLockUpdated(seriesID, user, mintLockUntil[seriesID]);
}
```

- [ ] **Step 4: Run mint tests**

Run: `npx hardhat test test/doudochain-v2-core.test.js --grep "burns points"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/DOUDOCHAINV2.sol test/doudochain-v2-core.test.js
git commit -m "feat: add points-only mint controls"
```

## Task 4: Bundles And Consolation Entries

**Files:**
- Modify: `contracts/DOUDOCHAINV2.sol`
- Modify: `test/doudochain-v2-core.test.js`

- [ ] **Step 1: Add bundle test**

Append:

```javascript
  it("mints bundles atomically with point rebate and consolation entries", async function () {
    const { admin, user, points, core } = await deployCore();
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.grantRole(await points.MINTER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("2000"));

    const input = {
      seriesName: "Bundle Series",
      totalTicketNumbers: 10,
      priceInPoints: ethers.parseEther("400"),
      priceInTWD: 100,
      estimateDeliverTime: 1780000000,
      exchangeTokenURI: "ipfs://exchange/",
      unrevealTokenURI: "ipfs://unreveal",
      revealTokenURI: "ipfs://reveal/",
      seriesMetaDataURI: "ipfs://series",
      isPreOrder: false,
      useLuckyNumber: false,
      maxPerWallet: 0
    };
    await core.createSeriesWithSubPrizes(input, prizeTable(10), true);
    await core.setSeriesBundles(0, [{ quantity: 5, pricePoints: ethers.parseEther("1600"), rebatePoints: ethers.parseEther("100"), consolationDraws: 1 }]);

    await core.connect(user).mintBundle(0, 0, [0, 0, 0, 0, 0]);

    expect(await core.balanceOf(user.address)).to.equal(5);
    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("500"));
    expect(await core.consolationDraws(user.address)).to.equal(1);
  });
```

- [ ] **Step 2: Implement bundle storage and mintBundle**

Add:

```solidity
struct Bundle {
    uint32 quantity;
    uint256 pricePoints;
    uint256 rebatePoints;
    uint16 consolationDraws;
}

mapping(uint256 => Bundle[]) public seriesBundles;
mapping(address => uint256) public consolationDraws;

error InvalidBundle();

function setSeriesBundles(uint256 seriesID, Bundle[] calldata bundles) external onlyRole(OPERATION_ROLE) {
    delete seriesBundles[seriesID];
    for (uint256 i = 0; i < bundles.length; i++) {
        if (bundles[i].quantity == 0 || bundles[i].pricePoints == 0) revert InvalidBundle();
        seriesBundles[seriesID].push(bundles[i]);
    }
}

function mintBundle(uint256 seriesID, uint256 bundleIndex, uint16[] calldata luckyNumbers) external nonReentrant whenNotPaused {
    Bundle memory bundle = seriesBundles[seriesID][bundleIndex];
    if (luckyNumbers.length != bundle.quantity) revert InvalidBundle();
    Series storage series = doudoSeries[seriesID];
    if (!series.isGoodsArrived) revert GoodsNotArrived();
    if (bundle.quantity > series.remainingTicketNumbers) revert NotEnoughNFTsRemaining();
    _checkAndRefreshMintLock(seriesID, msg.sender);
    _checkWalletCap(seriesID, msg.sender, bundle.quantity);
    doudoPoints.burnFromWithReason(msg.sender, bundle.pricePoints, keccak256("LOTTERY_BUNDLE"));
    _mintTickets(seriesID, msg.sender, luckyNumbers);
    if (bundle.rebatePoints > 0) {
        doudoPoints.mintWithReason(msg.sender, bundle.rebatePoints, keccak256("BUNDLE_REBATE"));
    }
    consolationDraws[msg.sender] += bundle.consolationDraws;
}
```

- [ ] **Step 3: Run bundle test**

Run: `npx hardhat test test/doudochain-v2-core.test.js --grep "mints bundles"`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add contracts/DOUDOCHAINV2.sol test/doudochain-v2-core.test.js
git commit -m "feat: add bundle minting"
```

## Task 5: Refunds And Pause Controls

**Files:**
- Modify: `contracts/DOUDOCHAINV2.sol`
- Modify: `test/doudochain-v2-core.test.js`

- [ ] **Step 1: Add refund and pause tests**

Append:

```javascript
  it("refunds unrevealed tickets only after operator marks the series refundable", async function () {
    const { user, points, core } = await deployCore();
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.grantRole(await points.MINTER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("20"));

    const input = {
      seriesName: "Refund Series",
      totalTicketNumbers: 10,
      priceInPoints: ethers.parseEther("3"),
      priceInTWD: 100,
      estimateDeliverTime: 1780000000,
      exchangeTokenURI: "ipfs://exchange/",
      unrevealTokenURI: "ipfs://unreveal",
      revealTokenURI: "ipfs://reveal/",
      seriesMetaDataURI: "ipfs://series",
      isPreOrder: false,
      useLuckyNumber: false,
      maxPerWallet: 0
    };
    await core.createSeriesWithSubPrizes(input, prizeTable(10), true);
    await core.connect(user).mint(0, [0, 0]);
    await core.seriesRefund(0);
    await core.connect(user).claimRefund([0, 1]);

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("20"));
    await expect(core.ownerOf(0)).to.be.reverted;
  });

  it("pauses user minting but leaves operator config callable", async function () {
    const { core } = await deployCore();
    await core.pause();
    await expect(core.mint(0, [0])).to.be.revertedWith("Pausable: paused");
    await core.unpause();
  });
```

- [ ] **Step 2: Implement refund state and pause functions**

Add:

```solidity
mapping(uint256 => uint256) public pointsPaid;
mapping(uint256 => bool) public refunded;

error SeriesNotRefundable();
error AlreadyRefunded();
error NotTheTokenOwner();
error TokenAlreadyRevealed();

function pause() external onlyRole(OPERATION_ROLE) {
    _pause();
}

function unpause() external onlyRole(OPERATION_ROLE) {
    _unpause();
}

function seriesRefund(uint256 seriesID) external onlyRole(OPERATION_ROLE) {
    doudoSeries[seriesID].isRefund = true;
}

function claimRefund(uint256[] calldata tokenIDs) external nonReentrant {
    uint256 totalRefund;
    for (uint256 i = 0; i < tokenIDs.length; i++) {
        uint256 tokenId = tokenIDs[i];
        TicketStatus storage status = ticketStatusDetail[tokenId];
        if (!doudoSeries[status.seriesID].isRefund) revert SeriesNotRefundable();
        if (ownerOf(tokenId) != msg.sender) revert NotTheTokenOwner();
        if (status.tokenRevealed) revert TokenAlreadyRevealed();
        if (refunded[tokenId]) revert AlreadyRefunded();
        refunded[tokenId] = true;
        totalRefund += pointsPaid[tokenId];
        _burn(tokenId);
    }
    doudoPoints.mintWithReason(msg.sender, totalRefund, keccak256("SERIES_REFUND"));
}
```

Set `pointsPaid[tokenId]` in `_mintTickets`. For regular mints, pass `series.priceInPoints`; for bundles, pass `bundle.pricePoints / bundle.quantity` through a new `_mintTicketsWithPaidPoints(...)`.

- [ ] **Step 3: Run refund and pause tests**

Run: `npx hardhat test test/doudochain-v2-core.test.js --grep "refunds|pauses"`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add contracts/DOUDOCHAINV2.sol test/doudochain-v2-core.test.js
git commit -m "feat: add refunds and pause controls"
```

## Task 6: Reveal Cap, VRF Shape, And Redraw Channels

**Files:**
- Modify: `contracts/DOUDOCHAINV2.sol`
- Modify: `test/doudochain-v2-core.test.js`

- [ ] **Step 1: Add reveal cap and redraw tests**

Append tests asserting:

```javascript
  it("rejects reveal batches above the hard cap", async function () {
    const { core } = await deployCore();
    const tokenIds = Array.from({ length: 21 }, (_, i) => i);
    await expect(core.reveal(0, tokenIds)).to.be.revertedWithCustomError(core, "RevealBatchTooLarge");
  });

  it("requires exact redraw burn counts", async function () {
    const { core } = await deployCore();
    await core.setRedrawConfig(0, 8, 3);
    await expect(core.redrawMain(0, [1, 2, 3])).to.be.revertedWithCustomError(core, "RedrawCountMismatch");
    await expect(core.redrawConsolation(0, [1, 2])).to.be.revertedWithCustomError(core, "RedrawCountMismatch");
  });
```

- [ ] **Step 2: Implement cap and redraw config**

Add:

```solidity
uint256 public constant MAX_REVEAL_BATCH = 20;
mapping(uint256 => uint16) public redrawMainBurnCount;
mapping(uint256 => uint16) public redrawConsolationBurnCount;

error RevealBatchTooLarge();
error RedrawCountMismatch();
error NotEligibleForRedraw();

function reveal(uint256 seriesID, uint256[] calldata tokenIDs) external whenNotPaused {
    if (tokenIDs.length > MAX_REVEAL_BATCH) revert RevealBatchTooLarge();
    _validateRevealTokens(seriesID, tokenIDs, msg.sender);
    _requestRevealRandomWords(seriesID, tokenIDs);
}

function setRedrawConfig(uint256 seriesID, uint16 mainBurnCount, uint16 consolationBurnCount) external onlyRole(OPERATION_ROLE) {
    redrawMainBurnCount[seriesID] = mainBurnCount;
    redrawConsolationBurnCount[seriesID] = consolationBurnCount;
}

function redrawMain(uint256 seriesID, uint256[] calldata tokenIDs) external nonReentrant whenNotPaused {
    if (tokenIDs.length != redrawMainBurnCount[seriesID]) revert RedrawCountMismatch();
    _burnRedrawInputs(seriesID, tokenIDs, msg.sender, true);
    _requestRedrawRandomWords(seriesID, false);
}

function redrawConsolation(uint256 seriesID, uint256[] calldata tokenIDs) external nonReentrant whenNotPaused {
    if (tokenIDs.length != redrawConsolationBurnCount[seriesID]) revert RedrawCountMismatch();
    _burnRedrawInputs(seriesID, tokenIDs, msg.sender, false);
    _requestRedrawRandomWords(seriesID, true);
}
```

Add helper signatures in the same task:

```solidity
function _validateRevealTokens(uint256 seriesID, uint256[] calldata tokenIDs, address user) internal view {
    for (uint256 i = 0; i < tokenIDs.length; i++) {
        if (ownerOf(tokenIDs[i]) != user) revert NotTheTokenOwner();
        TicketStatus storage status = ticketStatusDetail[tokenIDs[i]];
        if (status.seriesID != seriesID) revert InvalidSeriesInput();
        if (status.tokenRevealed) revert TokenAlreadyRevealed();
    }
}

function _burnRedrawInputs(uint256 seriesID, uint256[] calldata tokenIDs, address user, bool returnMainPrizeSlots) internal {
    for (uint256 i = 0; i < tokenIDs.length; i++) {
        uint256 tokenId = tokenIDs[i];
        if (ownerOf(tokenId) != user) revert NotTheTokenOwner();
        TicketStatus storage status = ticketStatusDetail[tokenId];
        if (status.seriesID != seriesID || !status.tokenRevealed || status.tokenExchange) revert NotEligibleForRedraw();
        if (returnMainPrizeSlots) {
            _returnPrizeSlot(seriesID, status.tokenRevealedPrize);
        }
        _burn(tokenId);
    }
}

function _returnPrizeSlot(uint256 seriesID, uint256 subPrizeID) internal {
    SubPrize[] storage prizes = seriesSubPrizes[seriesID];
    for (uint256 i = 0; i < prizes.length; i++) {
        if (prizes[i].subPrizeID == subPrizeID) {
            prizes[i].subPrizeRemainingQuantity += 1;
            return;
        }
    }
    revert InvalidSeriesInput();
}
```

- [ ] **Step 3: Complete VRF and redraw fulfillment**

Use the V1 `fulfillRandomWords` structure, but add request kinds:

```solidity
enum RequestKind { Reveal, LastPrize, RedrawMain, RedrawConsolation }
mapping(uint256 => RequestKind) public requestKind;
```

Implement request-specific mappings:

```solidity
mapping(uint256 => uint256[]) public requestToRevealToken;
mapping(uint256 => uint256) public requestToRedrawSeries;
mapping(uint256 => address) public requestToRedrawUser;
```

Implement the request helpers so callback context is stored before the VRF request leaves the contract:

```solidity
function _requestRevealRandomWords(uint256 seriesID, uint256[] calldata tokenIDs) internal returns (uint256 requestId) {
    requestId = _requestRandomWords();
    requestKind[requestId] = RequestKind.Reveal;
    requestToRedrawSeries[requestId] = seriesID;
    for (uint256 i = 0; i < tokenIDs.length; i++) {
        requestToRevealToken[requestId].push(tokenIDs[i]);
    }
    emit RevealRequested(requestId, seriesID, msg.sender, tokenIDs.length);
}

function _requestRedrawRandomWords(uint256 seriesID, bool consolation) internal returns (uint256 requestId) {
    requestId = _requestRandomWords();
    requestKind[requestId] = consolation ? RequestKind.RedrawConsolation : RequestKind.RedrawMain;
    requestToRedrawSeries[requestId] = seriesID;
    requestToRedrawUser[requestId] = msg.sender;
    emit RedrawRequested(requestId, seriesID, msg.sender, consolation);
}

function _requestRandomWords() internal returns (uint256 requestId) {
    requestId = vrfCoordinator.requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest({
            keyHash: keyHash,
            subId: subscriptionId,
            requestConfirmations: requestConfirmations,
            callbackGasLimit: callbackGasLimit,
            numWords: 1,
            extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: false}))
        })
    );
}
```

Each fulfillment path must emit token-level events:

```solidity
event RevealRequested(uint256 indexed requestId, uint256 indexed seriesID, address indexed user, uint256 quantity);
event PrizeRevealed(uint256 indexed requestId, uint256 indexed seriesID, uint256 indexed tokenID, uint256 subPrizeID);
event RedrawRequested(uint256 indexed requestId, uint256 indexed seriesID, address indexed user, bool consolation);
```

In `fulfillRandomWords`, branch by `requestKind[requestId]`; reveal requests iterate `requestToRevealToken[requestId]`, redraw requests mint one replacement ticket to `requestToRedrawUser[requestId]`, and all branches clear their request mappings after settlement.

- [ ] **Step 4: Run tests**

Run: `npx hardhat test test/doudochain-v2-core.test.js --grep "reveal|redraw"`

Expected: PASS all reveal/redraw tests.

- [ ] **Step 5: Commit**

```bash
git add contracts/DOUDOCHAINV2.sol test/doudochain-v2-core.test.js
git commit -m "feat: add V2 reveal guards and redraw channels"
```

## Task 7: Range-Based Series Membership And Last Prize

**Files:**
- Modify: `contracts/DOUDOCHAINV2.sol`
- Modify: `test/doudochain-v2-core.test.js`

- [ ] **Step 1: Add range tests**

Append:

```javascript
  it("tracks series token ranges instead of pushing every token id", async function () {
    const { user, points, core } = await deployCore();
    await points.grantRole(await points.BURNER_ROLE(), await core.getAddress());
    await points.mint(user.address, ethers.parseEther("100"));
    const input = {
      seriesName: "Range Series",
      totalTicketNumbers: 10,
      priceInPoints: ethers.parseEther("1"),
      priceInTWD: 100,
      estimateDeliverTime: 1780000000,
      exchangeTokenURI: "ipfs://exchange/",
      unrevealTokenURI: "ipfs://unreveal",
      revealTokenURI: "ipfs://reveal/",
      seriesMetaDataURI: "ipfs://series",
      isPreOrder: false,
      useLuckyNumber: false,
      maxPerWallet: 0
    };
    await core.createSeriesWithSubPrizes(input, prizeTable(10), true);
    await core.connect(user).mint(0, [0, 0, 0]);
    const range = await core.seriesRanges(0, 0);
    expect(range.start).to.equal(0);
    expect(range.end).to.equal(2);
  });
```

- [ ] **Step 2: Add range storage and update helper**

Add:

```solidity
struct TokenRange {
    uint256 start;
    uint256 end;
}

mapping(uint256 => TokenRange[]) public seriesRanges;

function _recordSeriesRange(uint256 seriesID, uint256 start, uint256 quantity) internal {
    uint256 end = start + quantity - 1;
    uint256 length = seriesRanges[seriesID].length;
    if (length > 0 && seriesRanges[seriesID][length - 1].end + 1 == start) {
        seriesRanges[seriesID][length - 1].end = end;
    } else {
        seriesRanges[seriesID].push(TokenRange({ start: start, end: end }));
    }
}
```

Call `_recordSeriesRange(seriesID, startTokenId, quantity)` in `_mintTickets`.

- [ ] **Step 3: Implement last-prize selection with burned-token reroll**

Add a helper:

```solidity
function _tokenIdFromSeriesIndex(uint256 seriesID, uint256 index) internal view returns (uint256 tokenId) {
    TokenRange[] storage ranges = seriesRanges[seriesID];
    uint256 cursor;
    for (uint256 i = 0; i < ranges.length; i++) {
        uint256 size = ranges[i].end - ranges[i].start + 1;
        if (index < cursor + size) {
            return ranges[i].start + (index - cursor);
        }
        cursor += size;
    }
    revert InvalidSeriesInput();
}
```

In the VRF last-prize fulfill path, if `_exists(candidateTokenId)` is false, use `candidateTokenId = _tokenIdFromSeriesIndex(seriesID, uint256(keccak256(abi.encode(randomWords[i], attempt))) % totalMintedInSeries)` for up to 20 attempts. Revert after 20 attempts; tests must include one burned-token reroll case.

- [ ] **Step 4: Run range tests**

Run: `npx hardhat test test/doudochain-v2-core.test.js --grep "tracks series token ranges"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/DOUDOCHAINV2.sol test/doudochain-v2-core.test.js
git commit -m "feat: track series by token ranges"
```

## Task 8: Collection Book Reward Issuance

**Files:**
- Modify: `contracts/DOUDOCHAINV2.sol`
- Modify: `test/doudochain-v2-core.test.js`

- [ ] **Step 1: Add collection reward tests**

Append:

```javascript
  it("lets the collection book role mint configured reward NFTs and unlock series", async function () {
    const { admin, user, core } = await deployCore();
    const input = {
      seriesName: "Reward Series",
      totalTicketNumbers: 3,
      priceInPoints: ethers.parseEther("1"),
      priceInTWD: 100,
      estimateDeliverTime: 1780000000,
      exchangeTokenURI: "ipfs://exchange/",
      unrevealTokenURI: "ipfs://unreveal",
      revealTokenURI: "ipfs://reveal/",
      seriesMetaDataURI: "ipfs://series",
      isPreOrder: false,
      useLuckyNumber: false,
      maxPerWallet: 0
    };
    await core.createSeriesWithSubPrizes(input, prizeTable(3), true);
    await core.setCollectionRewardConfig(9001, 0, 1, true);

    await expect(core.mintCollectionReward(user.address, 9001))
      .to.emit(core, "CollectionRewardMinted")
      .withArgs(user.address, 9001, 0, 0, 1, true);

    const status = await core.ticketStatusDetail(0);
    expect(status.seriesID).to.equal(0);
    expect(status.tokenRevealedPrize).to.equal(1);
    expect(status.tokenRevealed).to.equal(true);

    await expect(core.unlockSeriesFor(user.address, 0))
      .to.emit(core, "SeriesUnlockedFor")
      .withArgs(user.address, 0, admin.address);
    expect(await core.seriesUnlockedFor(0, user.address)).to.equal(true);
  });
```

- [ ] **Step 2: Implement reward config and collection role functions**

Add:

```solidity
struct CollectionRewardConfig {
    uint256 seriesID;
    uint256 subPrizeID;
    bool revealed;
    bool active;
}

mapping(uint256 => CollectionRewardConfig) public collectionRewardConfigs;
mapping(uint256 => mapping(address => bool)) public seriesUnlockedFor;

error CollectionRewardNotConfigured();

event CollectionRewardConfigSet(uint256 indexed rewardData, uint256 indexed seriesID, uint256 subPrizeID, bool revealed, bool active);
event CollectionRewardMinted(address indexed to, uint256 indexed rewardData, uint256 indexed seriesID, uint256 tokenID, uint256 subPrizeID, bool revealed);
event SeriesUnlockedFor(address indexed user, uint256 indexed seriesID, address indexed operator);

function setCollectionRewardConfig(
    uint256 rewardData,
    uint256 seriesID,
    uint256 subPrizeID,
    bool revealed
) external onlyRole(OPERATION_ROLE) {
    if (doudoSeries[seriesID].totalTicketNumbers == 0) revert InvalidSeriesInput();
    collectionRewardConfigs[rewardData] = CollectionRewardConfig({
        seriesID: seriesID,
        subPrizeID: subPrizeID,
        revealed: revealed,
        active: true
    });
    emit CollectionRewardConfigSet(rewardData, seriesID, subPrizeID, revealed, true);
}

function mintCollectionReward(address to, uint256 rewardData) external onlyRole(COLLECTION_BOOK_ROLE) returns (uint256 tokenId) {
    CollectionRewardConfig memory config = collectionRewardConfigs[rewardData];
    if (!config.active) revert CollectionRewardNotConfigured();
    if (config.revealed && config.subPrizeID != 0) {
        _consumePrizeSlot(config.seriesID, config.subPrizeID);
    }
    tokenId = _mintOneTicketWithoutPoints(config.seriesID, to);
    if (config.revealed) {
        ticketStatusDetail[tokenId].tokenRevealed = true;
        ticketStatusDetail[tokenId].tokenRevealedPrize = config.subPrizeID;
    }
    emit CollectionRewardMinted(to, rewardData, config.seriesID, tokenId, config.subPrizeID, config.revealed);
}

function unlockSeriesFor(address user, uint256 seriesID) external onlyRole(COLLECTION_BOOK_ROLE) {
    if (doudoSeries[seriesID].totalTicketNumbers == 0) revert InvalidSeriesInput();
    seriesUnlockedFor[seriesID][user] = true;
    emit SeriesUnlockedFor(user, seriesID, msg.sender);
}

function _mintOneTicketWithoutPoints(uint256 seriesID, address to) internal returns (uint256 tokenId) {
    Series storage series = doudoSeries[seriesID];
    if (!series.isGoodsArrived) revert GoodsNotArrived();
    if (series.remainingTicketNumbers == 0) revert NotEnoughNFTsRemaining();
    tokenId = _nextTokenId();
    _safeMint(to, 1);
    ticketStatusDetail[tokenId].seriesID = seriesID;
    series.remainingTicketNumbers -= 1;
    mintedPerWallet[seriesID][to] += 1;
    _recordSeriesRange(seriesID, tokenId, 1);
    emit NewTicketStatus(tokenId, seriesID, 0, false, false, to, 0);
}

function _consumePrizeSlot(uint256 seriesID, uint256 subPrizeID) internal {
    SubPrize[] storage prizes = seriesSubPrizes[seriesID];
    for (uint256 i = 0; i < prizes.length; i++) {
        if (prizes[i].subPrizeID == subPrizeID) {
            if (prizes[i].subPrizeRemainingQuantity == 0) revert NotEnoughNFTsRemaining();
            prizes[i].subPrizeRemainingQuantity -= 1;
            return;
        }
    }
    revert InvalidSeriesInput();
}
```

Collection rewards do not burn points and do not use `ADMINMINT_ROLE`; grant `COLLECTION_BOOK_ROLE` only to the deployed `CollectionBook` contract.

- [ ] **Step 3: Run collection reward tests**

Run: `npx hardhat test test/doudochain-v2-core.test.js --grep "collection book role"`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add contracts/DOUDOCHAINV2.sol test/doudochain-v2-core.test.js
git commit -m "feat: let collection book issue V2 rewards"
```

## Task 9: Deployment Script And Role Grants

**Files:**
- Create: `scripts/deployDoudochainV2ArbSepolia.ts`

- [ ] **Step 1: Create deployment script**

Create:

```typescript
import { ethers } from "hardhat";

const POINTS_ADDRESS = process.env.DOUDO_POINTS_ADDRESS || "";
const VRF_COORDINATOR = "0x5CE8D5A2BC84beb22a398CCA51996F7930313D61";
const KEY_HASH = "0x1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be";
const SUBSCRIPTION_ID = "106016056432422253373974444299096295296684744368940754254159766683809634643463";
const REQUEST_CONFIRMATIONS = 0;
const COLLECTION_BOOK_ADDRESS = process.env.COLLECTION_BOOK_ADDRESS || "";

async function main() {
  if (!POINTS_ADDRESS) {
    throw new Error("Set DOUDO_POINTS_ADDRESS");
  }
  const factory = await ethers.getContractFactory("contracts/DOUDOCHAINV2.sol:DOUDOCHAINV2");
  const core = await factory.deploy(POINTS_ADDRESS, VRF_COORDINATOR, SUBSCRIPTION_ID, KEY_HASH, REQUEST_CONFIRMATIONS);
  await core.waitForDeployment();
  console.log("DOUDOCHAINV2:", await core.getAddress());
  if (COLLECTION_BOOK_ADDRESS) {
    const tx = await core.grantRole(await core.COLLECTION_BOOK_ROLE(), COLLECTION_BOOK_ADDRESS);
    await tx.wait();
    console.log("COLLECTION_BOOK_ROLE granted to:", COLLECTION_BOOK_ADDRESS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run local deployment check**

Run: `DOUDO_POINTS_ADDRESS=0x0000000000000000000000000000000000000001 npx hardhat run scripts/deployDoudochainV2ArbSepolia.ts`

Expected: local deployment prints `DOUDOCHAINV2:` address.

- [ ] **Step 3: Commit**

```bash
git add scripts/deployDoudochainV2ArbSepolia.ts
git commit -m "chore: add DOUDOCHAIN V2 deployment script"
```

## Verification Checklist

- `npx hardhat test test/doudochain-v2-core.test.js` passes.
- `npx hardhat compile` passes.
- V2 has no `mintByMatic`, `currencyList`, `addCurrencyToken`, `AggregatorV3Interface`, or `getChainlinkDataFeedLatestAnswer`.
- `doudoSeries` replaces the public `ICHISeries` reader.
- Paid mints call `burnFromWithReason`.
- Bundle mints burn points, mint rebate points, and credit consolation entries in one transaction.
- `goodsArrived` cannot exist as a loose unsafe transition; arrival is either atomic at create or guarded by configured subprizes.
- Collection Book can mint reward NFTs and unlock series only through `COLLECTION_BOOK_ROLE` on `DOUDOCHAINV2`.
