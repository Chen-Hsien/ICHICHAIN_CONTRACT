# DOUDO Points Economy And Fiat Issuance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define and implement the first controllable version of DOUDO's points economy: reason-coded issuance, budgeted reward minting, fiat purchase issuance workflow, reconciliation artifacts, and referral anti-abuse policy.

**Architecture:** Keep payment processing off-chain, but add an on-chain `DoudoPointsBudgetIssuer` for capped reward sources and a documented backend contract for fiat-backed minting. Use reason-coded DOUDOCOIN events as the analytics backbone and keep regulatory posture in operational docs rather than trying to encode legal policy in Solidity.

**Tech Stack:** Solidity 0.8.20, DOUDOCOIN soulbound points, Hardhat 2.28, Node/TypeScript scripts, markdown runbooks, subgraph-oriented event reasons.

---

## File Structure

- Create: `contracts/DoudoPointsBudgetIssuer.sol` — capped reward-budget minter for non-fiat faucets.
- Create: `test/doudo-points-budget-issuer.test.js` — budget/cap tests.
- Create: `scripts/issueFiatPoints.ts` — operator script for settled payment issuance in testnet/manual ops.
- Create: `docs/points-economy/fiat-issuance-runbook.md` — fiat purchase issuance and reconciliation workflow.
- Create: `docs/points-economy/referral-policy.md` — anti-sybil referral rules.
- Create: `docs/points-economy/reason-codes.md` — canonical `bytes32` reason strings for mint/burn analytics.

## Task 1: Canonical Reason Codes

**Files:**
- Create: `docs/points-economy/reason-codes.md`

- [ ] **Step 1: Write the reason-code document**

Create `docs/points-economy/reason-codes.md`:

```markdown
# DOUDO Points Reason Codes

Reason codes are converted on-chain with `keccak256("REASON")`.

## Mint Reasons

- `PURCHASE` — fiat-backed purchase after settlement.
- `BUNDLE_REBATE` — rebate minted by DOUDOCHAIN V2 bundle minting.
- `COLLECTION_BOOK_REWARD` — points reward from completing a Collection Book.
- `REFERRAL_REWARD` — referral reward after qualifying paid activity.
- `PROMOTION` — operator promotion or airdrop.
- `SERIES_REFUND` — points restored after operator-approved series refund.

## Burn Reasons

- `LOTTERY_MINT` — ordinary paid draw.
- `LOTTERY_BUNDLE` — bundle draw purchase.
- `CONSOLATION_DRAW_REDEEM` — burn points for a consolation draw entry.
- `CHARGEBACK_CLAWBACK` — burn unspent points after payment reversal.

## Analytics Rules

- Fiat-backed issuance is measured by `PURCHASE`.
- Reward inflation is measured by `BUNDLE_REBATE`, `COLLECTION_BOOK_REWARD`, `REFERRAL_REWARD`, and `PROMOTION`.
- Sinks are measured by `LOTTERY_MINT`, `LOTTERY_BUNDLE`, and `CONSOLATION_DRAW_REDEEM`.
- `SERIES_REFUND` is not treated as reward inflation; it offsets a previous spend.
```

- [ ] **Step 2: Commit**

```bash
git add docs/points-economy/reason-codes.md
git commit -m "docs: define DOUDO point reason codes"
```

## Task 2: Budgeted Reward Issuer Contract

**Files:**
- Create: `contracts/DoudoPointsBudgetIssuer.sol`
- Create: `test/doudo-points-budget-issuer.test.js`

- [ ] **Step 1: Write failing budget tests**

Create `test/doudo-points-budget-issuer.test.js`:

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DoudoPointsBudgetIssuer", function () {
  async function deployFixture() {
    const [admin, operator, user] = await ethers.getSigners();
    const Points = await ethers.getContractFactory("contracts/DDOUDOCOIN.sol:DOUDOCOIN");
    const points = await Points.deploy(admin.address, admin.address);
    await points.waitForDeployment();

    const Issuer = await ethers.getContractFactory("contracts/DoudoPointsBudgetIssuer.sol:DoudoPointsBudgetIssuer");
    const issuer = await Issuer.deploy(await points.getAddress(), admin.address);
    await issuer.waitForDeployment();
    await points.grantRole(await points.MINTER_ROLE(), await issuer.getAddress());
    await issuer.grantRole(await issuer.OPERATOR_ROLE(), operator.address);
    return { admin, operator, user, points, issuer };
  }

  it("issues rewards within a source budget and rejects over-issuance", async function () {
    const { operator, user, points, issuer } = await deployFixture();
    const source = ethers.id("REFERRAL_REWARD");
    await issuer.setBudget(source, ethers.parseEther("1000"));

    await issuer.connect(operator).issue(user.address, ethers.parseEther("100"), source);

    expect(await points.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
    await expect(
      issuer.connect(operator).issue(user.address, ethers.parseEther("1001"), source)
    ).to.be.revertedWithCustomError(issuer, "BudgetExceeded");
  });
});
```

- [ ] **Step 2: Create budget issuer contract**

Create `contracts/DoudoPointsBudgetIssuer.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IDoudoPoints.sol";

contract DoudoPointsBudgetIssuer is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IDoudoPoints public immutable doudoPoints;
    mapping(bytes32 => uint256) public budget;
    mapping(bytes32 => uint256) public issued;

    error BudgetExceeded();
    error InvalidIssue();

    event BudgetSet(bytes32 indexed source, uint256 amount);
    event BudgetedPointsIssued(address indexed to, uint256 amount, bytes32 indexed source, address indexed operator);

    constructor(address doudoPointsAddress, address admin) {
        doudoPoints = IDoudoPoints(doudoPointsAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    function setBudget(bytes32 source, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount < issued[source]) revert BudgetExceeded();
        budget[source] = amount;
        emit BudgetSet(source, amount);
    }

    function issue(address to, uint256 amount, bytes32 source) external onlyRole(OPERATOR_ROLE) {
        if (to == address(0) || amount == 0 || source == bytes32(0)) revert InvalidIssue();
        uint256 nextIssued = issued[source] + amount;
        if (nextIssued > budget[source]) revert BudgetExceeded();
        issued[source] = nextIssued;
        doudoPoints.mintWithReason(to, amount, source);
        emit BudgetedPointsIssued(to, amount, source, msg.sender);
    }
}
```

- [ ] **Step 3: Run tests**

Run: `npx hardhat test test/doudo-points-budget-issuer.test.js`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add contracts/DoudoPointsBudgetIssuer.sol test/doudo-points-budget-issuer.test.js
git commit -m "feat: add budgeted points issuer"
```

## Task 3: Fiat Issuance Operator Script

**Files:**
- Create: `scripts/issueFiatPoints.ts`

- [ ] **Step 1: Create manual issuance script**

Create `scripts/issueFiatPoints.ts`:

```typescript
import { ethers } from "hardhat";

const POINTS_ADDRESS = process.env.DOUDO_POINTS_ADDRESS || "";
const RECIPIENT = process.env.DOUDO_POINTS_RECIPIENT || "";
const AMOUNT = process.env.DOUDO_POINTS_AMOUNT || "";
const ORDER_ID = process.env.DOUDO_ORDER_ID || "";

async function main() {
  if (!POINTS_ADDRESS || !RECIPIENT || !AMOUNT || !ORDER_ID) {
    throw new Error("Set DOUDO_POINTS_ADDRESS, DOUDO_POINTS_RECIPIENT, DOUDO_POINTS_AMOUNT, and DOUDO_ORDER_ID");
  }

  const points = await ethers.getContractAt(
    [
      "function mintWithReason(address to, uint256 amount, bytes32 reason) external returns (bool)",
      "function balanceOf(address account) external view returns (uint256)",
    ],
    POINTS_ADDRESS
  );

  const amount = ethers.parseEther(AMOUNT);
  const reason = ethers.id("PURCHASE");
  const tx = await points.mintWithReason(RECIPIENT, amount, reason);

  console.log("orderId:", ORDER_ID);
  console.log("recipient:", RECIPIENT);
  console.log("amount:", AMOUNT);
  console.log("mintTx:", tx.hash);
  await tx.wait();
  console.log("balanceAfter:", ethers.formatEther(await points.balanceOf(RECIPIENT)));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run local dry-run**

Run with a locally deployed token address:

```bash
DOUDO_POINTS_ADDRESS=0x0000000000000000000000000000000000000001 \
DOUDO_POINTS_RECIPIENT=0x0000000000000000000000000000000000000002 \
DOUDO_POINTS_AMOUNT=100 \
DOUDO_ORDER_ID=test-order-1 \
npx hardhat run scripts/issueFiatPoints.ts
```

Expected: FAIL with an invalid local token address. This proves env validation passes and the script reaches contract access.

- [ ] **Step 3: Commit**

```bash
git add scripts/issueFiatPoints.ts
git commit -m "chore: add fiat point issuance script"
```

## Task 4: Fiat Issuance And Reconciliation Runbook

**Files:**
- Create: `docs/points-economy/fiat-issuance-runbook.md`

- [ ] **Step 1: Write the runbook**

Create:

```markdown
# Fiat To DOUDO Points Issuance Runbook

## Settlement-Only Rule

Mint `PURCHASE` points only after the payment processor marks the charge as settled or captured according to the processor contract.

## Required Order Record

Each order record must include:

- `orderId`
- `processorPaymentId`
- `walletAddress`
- `fiatCurrency`
- `fiatAmount`
- `pointsAmount`
- `settlementStatus`
- `mintTxHash`
- `mintedAt`

## Issuance Steps

1. Receive payment processor settlement webhook.
2. Verify webhook signature.
3. Check `orderId` has not been minted before.
4. Mint points using `mintWithReason(wallet, pointsAmount, keccak256("PURCHASE"))`.
5. Store `mintTxHash`.
6. Reconcile after the transaction is mined.

## Reconciliation Checks

For each settled order:

- The wallet in the order equals the `PointsMinted.to` event.
- The points amount equals the `PointsMinted.amount` event.
- The reason equals `PURCHASE`.
- Exactly one mint transaction exists for the order.

## Chargeback Policy For Launch

If points are unspent, burn the remaining disputed amount with reason `CHARGEBACK_CLAWBACK`.
If points are already spent, mark the amount as a business loss and flag the wallet for manual review before future issuance.
This is the accepted launch policy: do not try to create negative point balances or automatic debt collection in V2.

## Operational Alerts

Alert when:

- A settled order has no mint transaction after 10 minutes.
- A mint transaction exists for an unsettled order.
- Minted amount differs from order amount.
- One wallet has more than 3 chargebacks in 30 days.
```

- [ ] **Step 2: Commit**

```bash
git add docs/points-economy/fiat-issuance-runbook.md
git commit -m "docs: add fiat issuance runbook"
```

## Task 5: Referral Policy

**Files:**
- Create: `docs/points-economy/referral-policy.md`

- [ ] **Step 1: Write referral anti-sybil policy**

Create:

```markdown
# DOUDO Referral Policy

## Binding Rule

`referrerOf[user]` is bound on the user's first paid activity. It cannot be changed after binding. A wallet cannot refer itself.

## Qualifying Activity

Referral rewards are based only on `PURCHASE` points minted from settled fiat payments. Reward points from bundles, promotions, collection books, or refunds do not qualify.

## Reward Rule

Default launch reward:

- Referrer receives 5% of the referred wallet's qualifying paid point volume.
- Reward is paid in soulbound DOUDO points with reason `REFERRAL_REWARD`.
- Reward is claimable after the referred payment clears chargeback risk according to the payment processor window.

## Caps

- Per referred wallet: maximum 500 DOUDO points of referral reward.
- Per referrer per 30 days: maximum 5,000 DOUDO points.
- Wallets with chargeback flags cannot generate or claim referral rewards.

## Anti-Abuse Review Triggers

Manual review is required when:

- More than 5 referred wallets share the same payment instrument fingerprint.
- More than 5 referred wallets share the same device fingerprint.
- Referral rewards exceed 20% of the referrer's paid purchase volume in 30 days.
```

- [ ] **Step 2: Commit**

```bash
git add docs/points-economy/referral-policy.md
git commit -m "docs: define referral anti-abuse policy"
```

## Task 6: Economy Verification Dashboard Inputs

**Files:**
- Create: `docs/points-economy/analytics-checklist.md`

- [ ] **Step 1: Write analytics checklist**

Create:

```markdown
# DOUDO Points Economy Analytics Checklist

## Daily Metrics

- Total `PURCHASE` points minted.
- Total reward points minted by reason.
- Total points burned by reason.
- Net point supply change.
- Refund points minted.
- Chargeback clawback points burned.

## Weekly Metrics

- Reward issuance as percentage of paid issuance.
- Bundle rebate redemption rate.
- Consolation draw redemption rate.
- Referral rewards per referrer.
- Wallets with purchase volume but no burn activity.

## Launch Thresholds

- Reward issuance should remain below 15% of paid issuance.
- Referral rewards should remain below 5% of paid issuance.
- Chargebacks above 2% of paid issuance trigger manual issuance review.
```

- [ ] **Step 2: Commit**

```bash
git add docs/points-economy/analytics-checklist.md
git commit -m "docs: add points economy analytics checklist"
```

## Verification Checklist

- `npx hardhat test test/doudo-points-budget-issuer.test.js` passes.
- `docs/points-economy/reason-codes.md` contains every reason emitted by DOUDOCOIN, DOUDOCHAIN V2, and Collection Book.
- The runbook clearly separates settled fiat purchase issuance from reward issuance.
- Referral rewards are based only on paid activity and capped below margin.
- Chargeback handling has a launch policy for unspent and already-spent points.
