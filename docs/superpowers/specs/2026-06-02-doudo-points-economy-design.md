# DOUDO Points Economy & Fiat Issuance — Design

## Status

**Early design / strategy doc.** Part of the **DOUDOCHAIN V2 (Arbitrum) redesign**. Sibling specs: DOUDOCOIN Soulbound Points · DOUDOCHAIN V2 Core · Collection Book.

This is the "bigger scope" piece flagged by the product owner. It is intentionally less implementation-ready than the others: it depends on payment-processor integration and Taiwan regulatory advice. It captures the economic model and the decisions needed before building.

## Context

DOUDO is non-transferable points (see DOUDOCOIN spec). Real revenue is **fiat (credit card)**, handled off-chain; on-chain points represent paid-for draw credits and rewards. The economy must control issuance (anti-inflation), keep points framed as closed-loop credits (not a tradable asset), and make every reward path un-gameable.

## Goals

- Define faucets (point sources) and sinks (point uses) and keep them balanced.
- Specify issuance control so points can't be inflated or farmed for net gain.
- Specify the fiat → points issuance flow and reconciliation.
- Specify an anti-sybil referral mechanism.

## The Loop

**Faucets (mint points):**
- **Fiat purchase** — backend mints points after a settled credit-card payment.
- **Bundle rebate** — atomic in `mintBundle` (e.g., 100 back on a 1600 bundle).
- **Consolation / punch-card** — points redeemable for consolation-pool draws (low threshold, frequent).
- **Referral** — points to the referrer on referred paid activity.
- **Promotions / airdrops** — operator-controlled campaigns.

**Sinks (burn points):**
- **Draws** — `priceInPoints` per draw (primary sink).
- **Consolation-draw redemption** — `consolationDrawCostPoints`.
- **Burn-to-redraw** — consumes prize NFTs (NFT sink) and, optionally, a small points fee.
- **Collection Book** — point-priced unlocks (if any).

## Issuance Control (anti-inflation)

- **Two issuance models**, choose per source:
  - **Pre-funded budget** (preferred for rewards): a fixed points budget is allocated; rewards draw it down; hard cap, no surprise inflation.
  - **Capped minting**: `MINTER_ROLE` mints, but with per-source rate limits / daily caps enforced in the issuer or a thin on-chain limiter.
- **Fiat-backed issuance** (purchases) is 1:1 with settled payments and reconciled (below); it is the only uncapped faucet and is backed by real revenue.
- Track issuance vs. sink volume via the subgraph (using DOUDOCOIN `reason` events) to monitor net inflation.

## Fiat → Points Issuance Flow

1. User pays by credit card via a licensed processor (off-chain).
2. On settlement webhook, the backend (holding `MINTER_ROLE`) mints the corresponding points to the user's wallet, with a `reason = PURCHASE` event and an off-chain order reference.
3. Reconciliation job matches settled payments ↔ on-chain mints (amount, wallet, order id); alerts on mismatch.
4. Chargebacks/refunds: define whether points are clawed back (only possible if unspent — soulbound points can be burned by `BURNER_ROLE` if still held) or written off. Needs a policy.

## Referral (anti-sybil)

- Bind `referrerOf[user]` on the user's **first paid activity**; immutable; `referrer != user`.
- Reward = a fraction of the referred wallet's **paid** volume, **denominated in points**, **≤ your margin** so self-referral via a second wallet only returns part of money actually spent (a discount, never net profit).
- **Pull-based** `claimReferralRewards()`; per-referrer cap and/or time-window cap.
- Because rewards are points (a sink-only credit, soulbound), even farmed rewards just drive more draws rather than extracting cash.

## Regulatory Posture (not legal advice)

- Soulbound + closed-loop + no cash-out reduces classification risk as e-money/virtual currency, but the final classification depends on business model, redemption terms, marketing, merchant scope, and **Taiwan legal advice**. Keep marketing language as "points / credits," avoid investment/asset framing.

## Open Questions (decide before implementation)

1. Issuance: which sources use pre-funded budget vs capped minting? What caps/rates?
2. Points peg: fixed `points-per-draw` per series only, or a global display peg to TWD for marketing? (On-chain charging is points; TWD is display.)
3. Chargeback / refund clawback policy for points.
4. Referral rate, caps, and qualifying actions.
5. KYC/AML and per-wallet purchase limits required by the payment processor / regulator.
6. Reconciliation ownership and alerting (backend service scope).

## Dependencies

- DOUDOCOIN Soulbound Points (roles: `MINTER_ROLE` issuer, `BURNER_ROLE` spenders).
- DOUDOCHAIN V2 Core (sinks: draws, consolation, redraw; faucets: bundle rebate, consolation, referral hooks).
- Off-chain: payment processor, issuer service, reconciliation job, subgraph analytics.
