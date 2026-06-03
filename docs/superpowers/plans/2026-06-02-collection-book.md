# Collection Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate Collection Book contract that escrows revealed prize NFTs across series, tracks book progress, and pays configurable rewards once a user completes a book.

**Architecture:** Implement `CollectionBook` as an independent AccessControl + ReentrancyGuard + IERC721Receiver contract. It reads prize identity from DOUDOCHAIN V2 through a narrow interface, locks matching NFTs in escrow, emits rich subgraph events, mints point rewards through DOUDOCOIN, and sends NFT/unlock rewards to DOUDOCHAINV2 through its collection reward interface.

**Tech Stack:** Solidity 0.8.20, OpenZeppelin 4.9.5, ERC721 receiver interface, Hardhat 2.28, ethers v6, Chai.

---

## File Structure

- Create: `contracts/interfaces/IDoudoPrizeSource.sol` — narrow interface for reading DOUDOCHAIN V2 ticket state.
- Create: `contracts/test/MockPrizeSource.sol` — ERC721 test double with controllable revealed prize status.
- Create: `contracts/test/MockCollectionRewardMinter.sol` — test double for DOUDOCHAINV2 reward issuance.
- Create: `contracts/CollectionBook.sol` — collection book escrow and reward contract.
- Create: `test/collection-book.test.js` — book creation, deposit, withdraw, claim, event tests.
- Create: `scripts/deployCollectionBookArbSepolia.ts` — deployment helper.

## Task 1: Prize Source Interface And Test Fixtures

**Files:**
- Create: `contracts/interfaces/IDoudoPrizeSource.sol`
- Create: `contracts/test/MockPrizeSource.sol`
- Create: `test/collection-book.test.js`

- [ ] **Step 1: Create the prize source interface**

Create `contracts/interfaces/IDoudoPrizeSource.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoPrizeSource {
    struct TicketStatus {
        uint256 seriesID;
        uint256 tokenRevealedPrize;
        bool tokenExchange;
        bool tokenRevealed;
        uint16 luckyNumber;
    }

    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function ticketStatusDetail(uint256 tokenId) external view returns (
        uint256 seriesID,
        uint256 tokenRevealedPrize,
        bool tokenExchange,
        bool tokenRevealed,
        uint16 luckyNumber
    );
}
```

- [ ] **Step 2: Add mock source contract**

Create `contracts/test/MockPrizeSource.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockPrizeSource is ERC721 {
    struct TicketStatus {
        uint256 seriesID;
        uint256 tokenRevealedPrize;
        bool tokenExchange;
        bool tokenRevealed;
        uint16 luckyNumber;
    }

    uint256 public nextTokenId;
    mapping(uint256 => TicketStatus) public ticketStatus;

    constructor() ERC721("MockPrizeSource", "MPS") {}

    function mintRevealed(
        address to,
        uint256 seriesID,
        uint256 prizeId,
        bool exchanged
    ) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        ticketStatus[tokenId] = TicketStatus({
            seriesID: seriesID,
            tokenRevealedPrize: prizeId,
            tokenExchange: exchanged,
            tokenRevealed: true,
            luckyNumber: 0
        });
    }

    function mintUnrevealed(address to, uint256 seriesID) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        ticketStatus[tokenId] = TicketStatus({
            seriesID: seriesID,
            tokenRevealedPrize: 0,
            tokenExchange: false,
            tokenRevealed: false,
            luckyNumber: 0
        });
    }

    function ticketStatusDetail(uint256 tokenId) external view returns (
        uint256 seriesID,
        uint256 tokenRevealedPrize,
        bool tokenExchange,
        bool tokenRevealed,
        uint16 luckyNumber
    ) {
        TicketStatus memory status = ticketStatus[tokenId];
        return (
            status.seriesID,
            status.tokenRevealedPrize,
            status.tokenExchange,
            status.tokenRevealed,
            status.luckyNumber
        );
    }
}
```

- [ ] **Step 3: Add test fixture**

Create the start of `test/collection-book.test.js`:

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CollectionBook", function () {
  async function deployFixture() {
    const [admin, user, other] = await ethers.getSigners();
    const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
    const points = await Points.deploy(admin.address, admin.address);
    await points.waitForDeployment();

    const PrizeSource = await ethers.getContractFactory("contracts/test/MockPrizeSource.sol:MockPrizeSource");
    const source = await PrizeSource.deploy();
    await source.waitForDeployment();

    const Book = await ethers.getContractFactory("contracts/CollectionBook.sol:CollectionBook");
    const book = await Book.deploy(await points.getAddress());
    await book.waitForDeployment();

    return { admin, user, other, points, source, book };
  }
});
```

- [ ] **Step 4: Run compile and confirm failure**

Run: `npx hardhat test test/collection-book.test.js`

Expected: FAIL because `CollectionBook` does not exist.

- [ ] **Step 5: Commit**

```bash
git add contracts/interfaces/IDoudoPrizeSource.sol contracts/test/MockPrizeSource.sol test/collection-book.test.js
git commit -m "test: scaffold collection book fixtures"
```

## Task 2: Book Definition

**Files:**
- Create: `contracts/CollectionBook.sol`
- Modify: `test/collection-book.test.js`

- [ ] **Step 1: Add failing book creation test**

Append inside `describe`:

```javascript
  it("creates a book and emits slot definitions", async function () {
    const { admin, source, book } = await deployFixture();
    const slots = [
      { sourceContract: await source.getAddress(), seriesID: 0, prizeId: 1, quantity: 2 },
      { sourceContract: await source.getAddress(), seriesID: 1, prizeId: 5, quantity: 1 }
    ];

    await expect(book.createBook("Dragon Set", slots, 1, ethers.parseEther("100"), true))
      .to.emit(book, "BookCreated")
      .withArgs(0, "Dragon Set", 1, ethers.parseEther("100"), true);

    const firstSlot = await book.bookSlots(0, 0);
    expect(firstSlot.seriesID).to.equal(0);
    expect(firstSlot.prizeId).to.equal(1);
    expect(await book.totalRequired(0)).to.equal(3);
  });
```

- [ ] **Step 2: Implement book storage and creation**

Create `contracts/CollectionBook.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./interfaces/IDoudoPoints.sol";

contract CollectionBook is AccessControl, ReentrancyGuard, IERC721Receiver {
    bytes32 public constant OPERATION_ROLE = keccak256("OPERATION_ROLE");

    enum RewardKind {
        NftPrize,
        Points,
        UnlockSeries
    }

    struct Slot {
        address sourceContract;
        uint256 seriesID;
        uint256 prizeId;
        uint32 quantity;
    }

    struct Book {
        string name;
        RewardKind rewardKind;
        uint256 rewardData;
        bool active;
    }

    IDoudoPoints public immutable doudoPoints;
    uint256 public nextBookId;
    mapping(uint256 => Book) public books;
    mapping(uint256 => Slot[]) private slotsByBook;
    mapping(uint256 => uint256) public totalRequired;

    error EmptyBook();
    error InvalidSlot();

    event BookCreated(uint256 indexed bookId, string name, RewardKind rewardKind, uint256 rewardData, bool active);
    event BookSlotDefined(uint256 indexed bookId, uint256 indexed slotIndex, address sourceContract, uint256 seriesID, uint256 prizeId, uint32 quantity);

    constructor(address doudoPointsAddress) {
        doudoPoints = IDoudoPoints(doudoPointsAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATION_ROLE, msg.sender);
    }

    function createBook(
        string calldata name,
        Slot[] calldata slots,
        RewardKind rewardKind,
        uint256 rewardData,
        bool active
    ) external onlyRole(OPERATION_ROLE) returns (uint256 bookId) {
        if (slots.length == 0) revert EmptyBook();
        bookId = nextBookId++;
        books[bookId] = Book(name, rewardKind, rewardData, active);
        for (uint256 i = 0; i < slots.length; i++) {
            if (slots[i].sourceContract == address(0) || slots[i].quantity == 0) revert InvalidSlot();
            slotsByBook[bookId].push(slots[i]);
            totalRequired[bookId] += slots[i].quantity;
            emit BookSlotDefined(bookId, i, slots[i].sourceContract, slots[i].seriesID, slots[i].prizeId, slots[i].quantity);
        }
        emit BookCreated(bookId, name, rewardKind, rewardData, active);
    }

    function bookSlots(uint256 bookId, uint256 slotIndex) external view returns (Slot memory) {
        return slotsByBook[bookId][slotIndex];
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
```

- [ ] **Step 3: Run book creation test**

Run: `npx hardhat test test/collection-book.test.js --grep "creates a book"`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add contracts/CollectionBook.sol test/collection-book.test.js
git commit -m "feat: add collection book definitions"
```

## Task 3: Deposit And Progress Tracking

**Files:**
- Modify: `contracts/CollectionBook.sol`
- Modify: `test/collection-book.test.js`

- [ ] **Step 1: Add deposit tests**

Append:

```javascript
  it("locks matching revealed prizes and tracks progress", async function () {
    const { user, source, book } = await deployFixture();
    await source.mintRevealed(user.address, 0, 1, false);
    await source.connect(user).approve(await book.getAddress(), 0);

    await book.createBook("A Book", [{ sourceContract: await source.getAddress(), seriesID: 0, prizeId: 1, quantity: 1 }], 1, ethers.parseEther("10"), true);

    await expect(book.connect(user).depositToBook(0, [0]))
      .to.emit(book, "SlotFilled")
      .withArgs(user.address, 0, 0, await source.getAddress(), 0, 1);

    expect(await book.filledCount(user.address, 0)).to.equal(1);
    expect(await source.ownerOf(0)).to.equal(await book.getAddress());
  });
```

- [ ] **Step 2: Implement deposit state**

Add to `CollectionBook.sol`:

```solidity
import "./interfaces/IDoudoPrizeSource.sol";

mapping(address => mapping(uint256 => uint32)) public filledCount;
mapping(address => mapping(uint256 => mapping(uint256 => uint32))) public filledPerSlot;
mapping(address => mapping(uint256 => bool)) public claimed;
mapping(address => mapping(uint256 => uint256)) public depositedTokenBook;
mapping(address => mapping(uint256 => uint256)) public depositedTokenSlotPlusOne;
mapping(address => mapping(uint256 => address)) public depositedTokenOwner;

error BookInactive();
error BookAlreadyClaimed();
error TokenDoesNotMatchAnyOpenSlot();
error TokenNotRevealed();
error TokenAlreadyExchanged();

event SlotFilled(address indexed user, uint256 indexed bookId, uint256 indexed slotIndex, address sourceContract, uint256 tokenId, uint32 newFilledCount);
```

- [ ] **Step 3: Implement depositToBook**

Add:

```solidity
function depositToBook(uint256 bookId, uint256[] calldata tokenIds) external nonReentrant {
    Book storage book = books[bookId];
    if (!book.active) revert BookInactive();
    if (claimed[msg.sender][bookId]) revert BookAlreadyClaimed();

    for (uint256 i = 0; i < tokenIds.length; i++) {
        _depositOne(bookId, tokenIds[i]);
    }
}

function _depositOne(uint256 bookId, uint256 tokenId) internal {
    Slot[] storage slots = slotsByBook[bookId];
    for (uint256 slotIndex = 0; slotIndex < slots.length; slotIndex++) {
        Slot storage slot = slots[slotIndex];
        if (filledPerSlot[msg.sender][bookId][slotIndex] >= slot.quantity) continue;
        IDoudoPrizeSource source = IDoudoPrizeSource(slot.sourceContract);
        (
            uint256 seriesID,
            uint256 prizeId,
            bool tokenExchange,
            bool tokenRevealed,
        ) = _readTicket(source, tokenId);
        if (seriesID == slot.seriesID && prizeId == slot.prizeId) {
            if (!tokenRevealed) revert TokenNotRevealed();
            if (tokenExchange) revert TokenAlreadyExchanged();
            source.safeTransferFrom(msg.sender, address(this), tokenId);
            filledPerSlot[msg.sender][bookId][slotIndex] += 1;
            filledCount[msg.sender][bookId] += 1;
            depositedTokenBook[slot.sourceContract][tokenId] = bookId + 1;
            depositedTokenSlotPlusOne[slot.sourceContract][tokenId] = slotIndex + 1;
            depositedTokenOwner[slot.sourceContract][tokenId] = msg.sender;
            emit SlotFilled(msg.sender, bookId, slotIndex, slot.sourceContract, tokenId, filledPerSlot[msg.sender][bookId][slotIndex]);
            return;
        }
    }
    revert TokenDoesNotMatchAnyOpenSlot();
}

function _readTicket(IDoudoPrizeSource source, uint256 tokenId) internal view returns (uint256 seriesID, uint256 prizeId, bool tokenExchange, bool tokenRevealed) {
    (seriesID, prizeId, tokenExchange, tokenRevealed,) = source.ticketStatusDetail(tokenId);
}
```

- [ ] **Step 4: Run deposit test**

Run: `npx hardhat test test/collection-book.test.js --grep "locks matching"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/CollectionBook.sol test/collection-book.test.js
git commit -m "feat: lock collection book prizes"
```

## Task 4: Withdraw Before Claim

**Files:**
- Modify: `contracts/CollectionBook.sol`
- Modify: `test/collection-book.test.js`

- [ ] **Step 1: Add withdraw test**

Append:

```javascript
  it("lets users withdraw deposited tokens before claim", async function () {
    const { user, other, source, book } = await deployFixture();
    const tokenId = await source.mintRevealed.staticCall(user.address, 0, 1, false);
    await source.mintRevealed(user.address, 0, 1, false);
    await source.connect(user).approve(await book.getAddress(), tokenId);
    await book.createBook("A Book", [{ sourceContract: await source.getAddress(), seriesID: 0, prizeId: 1, quantity: 1 }], 1, ethers.parseEther("10"), true);
    const bookId = 0;
    await book.connect(user).depositToBook(bookId, [tokenId]);

    await expect(book.connect(other).withdrawDeposited(bookId, await source.getAddress(), [tokenId]))
      .to.be.revertedWithCustomError(book, "TokenDepositedByAnotherUser");

    await expect(book.connect(user).withdrawDeposited(bookId, await source.getAddress(), [tokenId]))
      .to.emit(book, "SlotEmptied");

    expect(await book.filledCount(user.address, bookId)).to.equal(0);
    expect(await source.ownerOf(tokenId)).to.equal(user.address);
  });
```

- [ ] **Step 2: Implement withdrawDeposited**

Add:

```solidity
error CannotWithdrawAfterClaim();
error TokenNotDeposited();
error TokenDepositedByAnotherUser();

event SlotEmptied(address indexed user, uint256 indexed bookId, uint256 indexed slotIndex, address sourceContract, uint256 tokenId, uint32 newFilledCount);

function withdrawDeposited(uint256 bookId, address sourceContract, uint256[] calldata tokenIds) external nonReentrant {
    if (claimed[msg.sender][bookId]) revert CannotWithdrawAfterClaim();
    for (uint256 i = 0; i < tokenIds.length; i++) {
        _withdrawOne(bookId, sourceContract, tokenIds[i]);
    }
}

function _withdrawOne(uint256 bookId, address sourceContract, uint256 tokenId) internal {
    if (depositedTokenBook[sourceContract][tokenId] != bookId + 1) revert TokenNotDeposited();
    if (depositedTokenOwner[sourceContract][tokenId] != msg.sender) revert TokenDepositedByAnotherUser();
    uint256 slotIndex = _findFilledSlotForToken(bookId, sourceContract, tokenId);
    depositedTokenBook[sourceContract][tokenId] = 0;
    depositedTokenSlotPlusOne[sourceContract][tokenId] = 0;
    depositedTokenOwner[sourceContract][tokenId] = address(0);
    filledPerSlot[msg.sender][bookId][slotIndex] -= 1;
    filledCount[msg.sender][bookId] -= 1;
    IDoudoPrizeSource(sourceContract).safeTransferFrom(address(this), msg.sender, tokenId);
    emit SlotEmptied(msg.sender, bookId, slotIndex, sourceContract, tokenId, filledPerSlot[msg.sender][bookId][slotIndex]);
}
```

Use the direct token-to-slot indexing created in Task 3:

```solidity
function _findFilledSlotForToken(uint256 bookId, address sourceContract, uint256 tokenId) internal view returns (uint256 slotIndex) {
    uint256 slotPlusOne = depositedTokenSlotPlusOne[sourceContract][tokenId];
    if (slotPlusOne == 0) revert TokenNotDeposited();
    slotIndex = slotPlusOne - 1;
    Slot storage slot = bookSlots[bookId][slotIndex];
    if (slot.sourceContract != sourceContract) revert TokenNotDeposited();
}
```

This makes withdraw O(1) and avoids scanning all book slots for each token.

- [ ] **Step 3: Run withdraw test**

Run: `npx hardhat test test/collection-book.test.js --grep "withdraw deposited"`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add contracts/CollectionBook.sol test/collection-book.test.js
git commit -m "feat: allow book disassembly before claim"
```

## Task 5: Claim Rewards

**Files:**
- Modify: `contracts/CollectionBook.sol`
- Modify: `test/collection-book.test.js`

- [ ] **Step 1: Add point reward claim test**

Append:

```javascript
  it("claims a point reward once and blocks double claim", async function () {
    const { user, points, source, book } = await deployFixture();
    await points.grantRole(await points.MINTER_ROLE(), await book.getAddress());
    const tokenId = await source.mintRevealed.staticCall(user.address, 0, 1, false);
    await source.mintRevealed(user.address, 0, 1, false);
    await source.connect(user).approve(await book.getAddress(), tokenId);
    await book.createBook("A Book", [{ sourceContract: await source.getAddress(), seriesID: 0, prizeId: 1, quantity: 1 }], 1, ethers.parseEther("50"), true);
    const bookId = 0;
    await book.connect(user).depositToBook(bookId, [tokenId]);

    await expect(book.connect(user).claimBook(bookId))
      .to.emit(book, "BookClaimed")
      .withArgs(user.address, bookId, 1, ethers.parseEther("50"));

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("50"));
    await expect(book.connect(user).claimBook(bookId)).to.be.revertedWithCustomError(book, "BookAlreadyClaimed");
  });
```

- [ ] **Step 2: Implement point reward claim**

Add:

```solidity
error BookIncomplete();
error RewardTargetMissing();

event BookClaimed(address indexed user, uint256 indexed bookId, RewardKind rewardKind, uint256 rewardData);

function claimBook(uint256 bookId) external nonReentrant {
    Book storage book = books[bookId];
    if (claimed[msg.sender][bookId]) revert BookAlreadyClaimed();
    if (filledCount[msg.sender][bookId] != totalRequired[bookId]) revert BookIncomplete();

    claimed[msg.sender][bookId] = true;

    if (book.rewardKind == RewardKind.Points) {
        doudoPoints.mintWithReason(msg.sender, book.rewardData, keccak256("COLLECTION_BOOK_REWARD"));
    } else if (book.rewardKind == RewardKind.NftPrize) {
        revert RewardTargetMissing();
    } else if (book.rewardKind == RewardKind.UnlockSeries) {
        revert RewardTargetMissing();
    }

    emit BookClaimed(msg.sender, bookId, book.rewardKind, book.rewardData);
}
```

For `NftPrize` and `UnlockSeries`, Task 6 replaces the explicit revert paths with DOUDOCHAINV2 reward target calls. Keeping the explicit revert at this stage makes unsupported reward kinds fail predictably instead of silently succeeding.

- [ ] **Step 3: Run claim tests**

Run: `npx hardhat test test/collection-book.test.js --grep "claims a point reward"`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add contracts/CollectionBook.sol test/collection-book.test.js
git commit -m "feat: claim collection book point rewards"
```

## Task 6: DOUDOCHAINV2 Reward Integration And Deployment

**Files:**
- Modify: `contracts/CollectionBook.sol`
- Create: `contracts/test/MockCollectionRewardMinter.sol`
- Modify: `test/collection-book.test.js`
- Create: `scripts/deployCollectionBookArbSepolia.ts`

- [ ] **Step 1: Add DOUDOCHAINV2 reward target tests**

Create `contracts/test/MockCollectionRewardMinter.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockCollectionRewardMinter {
    event MockCollectionRewardMinted(address indexed to, uint256 indexed rewardData);
    event MockSeriesUnlocked(address indexed user, uint256 indexed seriesID);

    function mintCollectionReward(address to, uint256 rewardData) external returns (uint256 tokenId) {
        emit MockCollectionRewardMinted(to, rewardData);
        return rewardData;
    }

    function unlockSeriesFor(address user, uint256 seriesID) external {
        emit MockSeriesUnlocked(user, seriesID);
    }
}
```

Append:

```javascript
  it("routes NFT and unlock rewards to DOUDOCHAINV2 reward target", async function () {
    const { user, source, book } = await deployFixture();
    const RewardTarget = await ethers.getContractFactory("contracts/test/MockCollectionRewardMinter.sol:MockCollectionRewardMinter");
    const rewardTarget = await RewardTarget.deploy();
    await rewardTarget.waitForDeployment();
    await book.setDoudochainV2RewardTarget(await rewardTarget.getAddress());

    const tokenId = await source.mintRevealed.staticCall(user.address, 0, 1, false);
    await source.mintRevealed(user.address, 0, 1, false);
    await source.connect(user).approve(await book.getAddress(), tokenId);
    await book.createBook("NFT Reward Book", [{ sourceContract: await source.getAddress(), seriesID: 0, prizeId: 1, quantity: 1 }], 0, 9001, true);
    await book.connect(user).depositToBook(0, [tokenId]);

    await expect(book.connect(user).claimBook(0))
      .to.emit(rewardTarget, "MockCollectionRewardMinted")
      .withArgs(user.address, 9001);

    const unlockTokenId = await source.mintRevealed.staticCall(user.address, 0, 1, false);
    await source.mintRevealed(user.address, 0, 1, false);
    await source.connect(user).approve(await book.getAddress(), unlockTokenId);
    await book.createBook("Unlock Book", [{ sourceContract: await source.getAddress(), seriesID: 0, prizeId: 1, quantity: 1 }], 2, 7, true);
    await book.connect(user).depositToBook(1, [unlockTokenId]);

    await expect(book.connect(user).claimBook(1))
      .to.emit(rewardTarget, "MockSeriesUnlocked")
      .withArgs(user.address, 7);
  });
```

- [ ] **Step 2: Add DOUDOCHAINV2 reward target address**

Add:

```solidity
address public doudochainV2RewardTarget;

event DoudochainV2RewardTargetUpdated(address doudochainV2RewardTarget);

function setDoudochainV2RewardTarget(address doudochainV2RewardTarget_) external onlyRole(OPERATION_ROLE) {
    doudochainV2RewardTarget = doudochainV2RewardTarget_;
    emit DoudochainV2RewardTargetUpdated(doudochainV2RewardTarget_);
}
```

Define the narrow DOUDOCHAINV2 reward interface:

```solidity
interface IDoudochainV2CollectionRewards {
    function mintCollectionReward(address to, uint256 rewardData) external;
    function unlockSeriesFor(address user, uint256 seriesID) external;
}
```

Replace the claim revert paths with DOUDOCHAINV2 target calls:

```solidity
if (book.rewardKind == RewardKind.NftPrize) {
    if (doudochainV2RewardTarget == address(0)) revert RewardTargetMissing();
    IDoudochainV2CollectionRewards(doudochainV2RewardTarget).mintCollectionReward(msg.sender, book.rewardData);
} else if (book.rewardKind == RewardKind.UnlockSeries) {
    if (doudochainV2RewardTarget == address(0)) revert RewardTargetMissing();
    IDoudochainV2CollectionRewards(doudochainV2RewardTarget).unlockSeriesFor(msg.sender, book.rewardData);
}
```

- [ ] **Step 3: Add deployment script**

Create `scripts/deployCollectionBookArbSepolia.ts`:

```typescript
import { ethers } from "hardhat";

const POINTS_ADDRESS = process.env.DOUDO_POINTS_ADDRESS || "";
const DOUDOCHAIN_V2_ADDRESS = process.env.DOUDOCHAIN_V2_ADDRESS || "";

async function main() {
  if (!POINTS_ADDRESS) {
    throw new Error("Set DOUDO_POINTS_ADDRESS");
  }
  const factory = await ethers.getContractFactory("contracts/CollectionBook.sol:CollectionBook");
  const book = await factory.deploy(POINTS_ADDRESS);
  await book.waitForDeployment();
  console.log("CollectionBook:", await book.getAddress());
  if (DOUDOCHAIN_V2_ADDRESS) {
    const tx = await book.setDoudochainV2RewardTarget(DOUDOCHAIN_V2_ADDRESS);
    await tx.wait();
    console.log("DOUDOCHAINV2 reward target:", DOUDOCHAIN_V2_ADDRESS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run all collection tests**

Run: `npx hardhat test test/collection-book.test.js`

Expected: PASS all collection book tests.

- [ ] **Step 5: Commit**

```bash
git add contracts/CollectionBook.sol contracts/test/MockCollectionRewardMinter.sol scripts/deployCollectionBookArbSepolia.ts test/collection-book.test.js
git commit -m "feat: route collection rewards to DOUDOCHAIN V2"
```

## Verification Checklist

- `npx hardhat test test/collection-book.test.js` passes.
- `CollectionBook` is separate from DOUDOCHAIN V2.
- Deposited NFTs are escrowed, not burned.
- Users can withdraw before claim and cannot withdraw after claim.
- `BookCreated`, `BookSlotDefined`, `SlotFilled`, `SlotEmptied`, and `BookClaimed` events include enough data for The Graph.
- Point rewards use `mintWithReason(..., "COLLECTION_BOOK_REWARD")`.
- NFT and unlock rewards route to DOUDOCHAINV2 through `mintCollectionReward` and `unlockSeriesFor`.
