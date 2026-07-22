# DOUDOCOIN — Soulbound Points Design

## Status

Draft for review. Part of the **DOUDOCHAIN V2 (Arbitrum) redesign**. Sibling specs:

- **DOUDOCOIN — Soulbound Points (this doc).**
- DOUDOCHAIN V2 — Core lottery.
- Collection Book.
- DOUDO Points Economy & Fiat Issuance.

## Context

DOUDO is being repositioned from a transferable ERC20 "coin" to a **non-transferable points** instrument, to fit Taiwan regulatory framing (closed-loop points, not a virtual currency / e-money). Current contract: `contracts/DDOUDOCOIN.sol` — standard OpenZeppelin v4 ERC20, 18 decimals, `MINTER_ROLE`.

Confirmed environment: **OpenZeppelin v4.9.5** (so the transfer hook is `_beforeTokenTransfer`, not v5's `_update`). The `^5.0.0` comment in the current file is incorrect boilerplate and should be removed.

## Goals

- Make DOUDO points **non-transferable** (mint and burn only; no wallet-to-wallet, no transfer to contracts).
- Let authorized in-ecosystem contracts (DOUDOCHAIN V2, Collection Book) **burn** a user's points to spend them.
- Keep controlled issuance via `MINTER_ROLE` (held by the backend / payment flow after fiat purchase, plus reward sources).

## Non-Goals

- The full economy (faucets, sinks, issuance caps, fiat reconciliation, anti-inflation) lives in the **Points Economy** spec.
- No staking or yield. Points are spend credits, not an asset.

## Key Decisions

1. **Soulbound**: transfers revert unless `from == address(0)` (mint) or `to == address(0)` (burn).
2. **Spending = burning.** Because points can't be transferred to the lottery contract, spending is implemented as a privileged burn.
3. **Burn authorization via `BURNER_ROLE`** (not ERC20 allowance). Trusted contracts burn user points directly; this avoids an approve step that would be confusing on a non-transferable token. Only audited in-ecosystem contracts receive `BURNER_ROLE`.
4. Keep 18 decimals.

## Detailed Design

Modify `contracts/DDOUDOCOIN.sol`:

```
// roles
bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

error NonTransferable();

// OZ v4 hook
function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
    if (from != address(0) && to != address(0)) revert NonTransferable();
    super._beforeTokenTransfer(from, to, amount);
}

function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) returns (bool) { _mint(to, amount); return true; }
function burnFrom(address account, uint256 amount) external onlyRole(BURNER_ROLE) { _burn(account, amount); }
```

- `approve` / `allowance` remain technically callable (they don't move tokens) but are unused by the ecosystem; document that they are inert for spending.
- Standard `Transfer` events on mint (`from == 0`) and burn (`to == 0`) are sufficient for The Graph to track per-user balances and issuance/spend history. Optionally add `PointsMinted(to, amount, bytes32 reason)` / `PointsBurned(from, amount, bytes32 reason)` so the indexer can categorize faucets vs sinks without decoding callers.

## Roles at Deployment

- `DEFAULT_ADMIN_ROLE` → multisig/admin.
- `MINTER_ROLE` → backend issuer (post-fiat) + reward sources (later, per Economy spec).
- `BURNER_ROLE` → DOUDOCHAIN V2 and Collection Book contract addresses (granted after they are deployed).

## Testing Strategy

- Mint to user works; user-to-user `transfer` / `transferFrom` revert with `NonTransferable`.
- `transfer` to a contract reverts; mint (`from==0`) and burn (`to==0`) succeed.
- `burnFrom` only callable by `BURNER_ROLE`; reduces balance; reverts for non-role callers.
- `mint` only callable by `MINTER_ROLE`.
- Optional reason events emitted and indexable.

## Deployment & Migration Notes

- Fresh deploy (replaces the current DOUDOCOIN). Grant `BURNER_ROLE` to DOUDOCHAIN V2 and Collection Book after those deploy.
- Any prior DOUDOCOIN balances on testnet are discarded (test data).

## Open Questions

1. Should `approve`/`allowance` be explicitly disabled (override to revert) for clarity, or left inert? (Default: leave inert, document.)
2. Do we want the categorized `reason` events now, or rely on caller-address heuristics in the subgraph? (Default: add reason events — cheap and makes economy analytics trivial.)
