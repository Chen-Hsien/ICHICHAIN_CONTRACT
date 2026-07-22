# DOUDOCOIN Soulbound Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert DOUDOCOIN from a transferable ERC20 into non-transferable, mint-and-burn-only ecosystem points with controlled minting and authorized burn spending.

**Architecture:** Modify the current `contracts/DDOUDOCOIN.sol` contract in place, keeping OpenZeppelin v4.9.5 ERC20 + AccessControl. Add `BURNER_ROLE`, block wallet-to-wallet transfers in `_beforeTokenTransfer`, and add reason-coded mint/burn events for analytics without changing the 18-decimal balance model.

**Tech Stack:** Solidity 0.8.20, OpenZeppelin Contracts 4.9.5, Hardhat 2.28, ethers v6, Chai.

---

## File Structure

- Modify: `contracts/DDOUDOCOIN.sol` — soulbound point token implementation.
- Create: `contracts/interfaces/IDoudoPoints.sol` — interface used by DOUDOCHAIN V2 and Collection Book.
- Create: `test/doudocoin-soulbound-points.test.js` — role, mint, burn, and non-transferability tests.
- Modify: `package.json` — replace the current failing test script with `hardhat test`.

## Task 1: Test Harness And Interface

**Files:**
- Create: `contracts/interfaces/IDoudoPoints.sol`
- Modify: `package.json`

- [ ] **Step 1: Create the points interface**

Create `contracts/interfaces/IDoudoPoints.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDoudoPoints {
    function mint(address to, uint256 amount) external returns (bool);
    function mintWithReason(address to, uint256 amount, bytes32 reason) external returns (bool);
    function burnFrom(address account, uint256 amount) external;
    function burnFromWithReason(address account, uint256 amount, bytes32 reason) external;
}
```

- [ ] **Step 2: Enable Hardhat tests**

Modify `package.json`:

```json
{
  "scripts": {
    "test": "hardhat test"
  }
}
```

- [ ] **Step 3: Run compile**

Run: `npx hardhat compile`

Expected: compile succeeds with no Solidity errors.

- [ ] **Step 4: Commit**

```bash
git add contracts/interfaces/IDoudoPoints.sol package.json package-lock.json
git commit -m "chore: add points interface and test command"
```

## Task 2: Soulbound Transfer Tests

**Files:**
- Create: `test/doudocoin-soulbound-points.test.js`

- [ ] **Step 1: Write failing transfer tests**

Create `test/doudocoin-soulbound-points.test.js`:

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DOUDOCOIN soulbound points", function () {
  async function deployToken() {
    const [admin, minter, burner, user, other] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
    const token = await Token.deploy(admin.address, minter.address);
    await token.waitForDeployment();
    const burnerRole = await token.BURNER_ROLE();
    await token.connect(admin).grantRole(burnerRole, burner.address);
    return { token, admin, minter, burner, user, other };
  }

  it("allows minting but blocks wallet-to-wallet transfer", async function () {
    const { token, minter, user, other } = await deployToken();
    await token.connect(minter).mint(user.address, ethers.parseEther("100"));

    await expect(
      token.connect(user).transfer(other.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(token, "NonTransferable");
  });

  it("blocks transferFrom even when an allowance exists", async function () {
    const { token, minter, user, other } = await deployToken();
    await token.connect(minter).mint(user.address, ethers.parseEther("100"));
    await token.connect(user).approve(other.address, ethers.parseEther("1"));

    await expect(
      token.connect(other).transferFrom(user.address, other.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(token, "NonTransferable");
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx hardhat test test/doudocoin-soulbound-points.test.js`

Expected: FAIL because `BURNER_ROLE` and `NonTransferable` do not exist yet.

- [ ] **Step 3: Commit failing tests**

```bash
git add test/doudocoin-soulbound-points.test.js
git commit -m "test: specify soulbound point transfers"
```

## Task 3: Implement Soulbound Points

**Files:**
- Modify: `contracts/DDOUDOCOIN.sol`

- [ ] **Step 1: Replace the contract with the soulbound implementation**

Modify `contracts/DDOUDOCOIN.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IDoudoPoints.sol";

contract DOUDOCOIN is ERC20, AccessControl, IDoudoPoints {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant REASON_UNSPECIFIED = keccak256("UNSPECIFIED");

    error NonTransferable();

    event PointsMinted(address indexed to, uint256 amount, bytes32 indexed reason, address indexed operator);
    event PointsBurned(address indexed from, uint256 amount, bytes32 indexed reason, address indexed operator);

    constructor(address defaultAdmin, address minter) ERC20("DOUDOCOIN", "DOUDO") {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, minter);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) returns (bool) {
        return mintWithReason(to, amount, REASON_UNSPECIFIED);
    }

    function mintWithReason(
        address to,
        uint256 amount,
        bytes32 reason
    ) public onlyRole(MINTER_ROLE) returns (bool) {
        _mint(to, amount);
        emit PointsMinted(to, amount, reason, msg.sender);
        return true;
    }

    function burnFrom(address account, uint256 amount) external onlyRole(BURNER_ROLE) {
        burnFromWithReason(account, amount, REASON_UNSPECIFIED);
    }

    function burnFromWithReason(
        address account,
        uint256 amount,
        bytes32 reason
    ) public onlyRole(BURNER_ROLE) {
        _burn(account, amount);
        emit PointsBurned(account, amount, reason, msg.sender);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from != address(0) && to != address(0)) {
            revert NonTransferable();
        }
        super._beforeTokenTransfer(from, to, amount);
    }
}
```

- [ ] **Step 2: Run the transfer tests**

Run: `npx hardhat test test/doudocoin-soulbound-points.test.js`

Expected: PASS for the two transfer tests.

- [ ] **Step 3: Commit**

```bash
git add contracts/DDOUDOCOIN.sol
git commit -m "feat: make DOUDO points soulbound"
```

## Task 4: Burn And Reason Event Tests

**Files:**
- Modify: `test/doudocoin-soulbound-points.test.js`

- [ ] **Step 1: Add burn role and reason-event tests**

Append these tests inside the same `describe` block:

```javascript
  it("allows BURNER_ROLE to burn user points", async function () {
    const { token, minter, burner, user } = await deployToken();
    await token.connect(minter).mint(user.address, ethers.parseEther("100"));

    await token.connect(burner).burnFrom(user.address, ethers.parseEther("25"));

    expect(await token.balanceOf(user.address)).to.equal(ethers.parseEther("75"));
  });

  it("rejects burnFrom from non-burners", async function () {
    const { token, minter, user, other } = await deployToken();
    await token.connect(minter).mint(user.address, ethers.parseEther("100"));

    await expect(
      token.connect(other).burnFrom(user.address, ethers.parseEther("1"))
    ).to.be.reverted;
  });

  it("emits reason-coded mint and burn events", async function () {
    const { token, minter, burner, user } = await deployToken();
    const purchaseReason = ethers.id("PURCHASE");
    const spendReason = ethers.id("LOTTERY_MINT");

    await expect(token.connect(minter).mintWithReason(user.address, ethers.parseEther("100"), purchaseReason))
      .to.emit(token, "PointsMinted")
      .withArgs(user.address, ethers.parseEther("100"), purchaseReason, minter.address);

    await expect(token.connect(burner).burnFromWithReason(user.address, ethers.parseEther("40"), spendReason))
      .to.emit(token, "PointsBurned")
      .withArgs(user.address, ethers.parseEther("40"), spendReason, burner.address);
  });
```

- [ ] **Step 2: Run tests**

Run: `npx hardhat test test/doudocoin-soulbound-points.test.js`

Expected: PASS all five tests.

- [ ] **Step 3: Run compile**

Run: `npx hardhat compile`

Expected: compile succeeds.

- [ ] **Step 4: Commit**

```bash
git add contracts/DDOUDOCOIN.sol test/doudocoin-soulbound-points.test.js
git commit -m "test: cover point burning and reason events"
```

## Task 5: Deployment Script Update

**Files:**
- Create: `scripts/deployDoudocoinSoulboundArbSepolia.ts`

- [ ] **Step 1: Add deployment script**

Create `scripts/deployDoudocoinSoulboundArbSepolia.ts`:

```typescript
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const Token = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
  const token = await Token.deploy(deployerAddress, deployerAddress);
  await token.waitForDeployment();

  console.log("DOUDOCOIN soulbound points:", await token.getAddress());
  console.log("DEFAULT_ADMIN_ROLE:", deployerAddress);
  console.log("MINTER_ROLE:", deployerAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the script against a local fork-free Hardhat network**

Run: `npx hardhat run scripts/deployDoudocoinSoulboundArbSepolia.ts`

Expected: prints a deployed local address and role owners.

- [ ] **Step 3: Commit**

```bash
git add scripts/deployDoudocoinSoulboundArbSepolia.ts
git commit -m "chore: add soulbound points deployment script"
```

## Verification Checklist

- `npx hardhat test test/doudocoin-soulbound-points.test.js` passes.
- `npx hardhat compile` passes.
- `contracts/DDOUDOCOIN.sol` imports OpenZeppelin v4 hooks and does not mention OZ v5.
- `BURNER_ROLE` exists and is the only path for third-party point spending.
- Wallet-to-wallet `transfer` and `transferFrom` revert with `NonTransferable`.
