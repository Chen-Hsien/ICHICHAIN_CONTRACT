# ICHICHAIN Contracts Agent Guide

## Sync and ownership

- Before implementation, refactoring, conflict resolution, or commit, run `git fetch origin main` and merge `origin/main`. Use an explicitly requested base when provided; if sync fails, stop before code changes unless the user waives it.
- Contracts own final chain state, access control, accounting, events, and callable behavior. Backend owns orchestration, Admin owns operations UI, The Graph owns indexing, and frontend owns buyer presentation.
- Known roots: backend `/Users/angustsai/doudochain-backend`, admin `/Users/angustsai/doudo-admin`, frontend `/Users/angustsai/ichichain`, subgraph `/Users/angustsai/thegraph/doudochain_amoy`.

## Discovery and safety

- Start from known contracts, tests, and deployment scripts; use scoped `rg` only when a symbol is unknown. Do not search broadly across the home directory.
- Never print secrets or private keys. Write new specifications in Chinese unless requested otherwise.
- Do not deploy, upgrade, change roles, or submit chain transactions without explicit user authorization.

## Contract changes

- For security or financial behavior, map caller, storage, external calls, events, and downstream backend/subgraph consumers before editing. Check nonexistent IDs, zero/default values, access control, CEI/reentrancy, supply/accounting invariants, ERC721 callbacks, upgrade storage layout, and bytecode size where applicable.
- Fix the source invariant rather than frontend or backend symptoms. Preserve compatibility for existing series, mint orders, reveal history, and events.
- Any mint, reveal, refund, exchange, price, wallet-limit, reward, or delivery change requires matching backend workflow arguments, Admin validation, ABI/artifact consumers, and Graph event/indexing expectations.
- `isPreOrder` controls reveal policy: preorder sales use non-reveal minting until explicit enablement; non-preorder may reveal only when contract state supports it.

## Verification

- Add focused regression tests that assert full event/argument or generated-artifact shape and the previous bad path is rejected. Run relevant compile/tests, `git diff --check`, and targeted searches for legacy names or paths.
- For async or deployed-flow verification, identify the runtime/deployment actually under test. Report verification performed and any deployment/runtime step not performed.

## Agent skills

### Issue tracker

Work is tracked in GitHub Issues for `Chen-Hsien/ICHICHAIN_CONTRACT`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses single-context contract documentation with explicit cross-repository ownership boundaries. See `docs/agents/domain.md`.
