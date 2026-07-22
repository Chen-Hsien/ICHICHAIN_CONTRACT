# DOUDOCHAIN V2 Merchant Attribution Design

## Status

Design approved for documentation on 2026-06-15.

This document specifies how DOUDOCHAIN V2 supports multiple merchants without
growing the `DOUDOCHAINV2CoreUpgradeable` bytecode. Merchant attribution is
moved out of Core into a dedicated `MerchantSeriesRegistry`, and a thin
`MerchantSeriesPublisher` keeps series creation and merchant linking atomic in a
single transaction. Detailed merchant records (name, contact, branding, KYC,
payout config) stay in the off-chain backend database. Only an opaque
`merchantRef` is recorded on-chain.

This design supersedes the in-progress attempt to embed
`mapping(uint256 => bytes32) public seriesMerchantRefs;` directly inside Core.
That change is still in the working tree (uncommitted, not deployed) and must be
reverted as part of implementation; see `Migration Notes`.

## Goals

- Support a many-to-one merchant model: one series belongs to exactly one
  merchant, one merchant may own many series.
- Keep merchant data minimal on-chain: store only an opaque `merchantRef`; keep
  all descriptive merchant data in the off-chain database.
- Keep `DOUDOCHAINV2CoreUpgradeable` bytecode below the EIP-170 24KB limit by not
  adding merchant storage, setters, or events to Core.
- Make publishing atomic: a series and its merchant link are created in the same
  transaction, so the chain never holds a series that is "created but not yet
  attributed".
- Make merchant attribution independently verifiable on-chain and from The Graph.
- Keep the user-facing hot path (`mint`, `mintAndReveal`, `reveal`,
  `exchangePrize`) completely untouched: no added storage reads, gas, or failure
  modes during purchase.
- Keep the attribution ledger upgradeable enough to grow (merchant status,
  metadata commitments) without migrating historical links.

## Non-Goals

- Do not store descriptive merchant data on-chain (names, contacts, branding).
- Do not add merchant storage or merchant events to Core.
- Do not build an on-chain reverse index (merchant to series list). The reverse
  lookup is an off-chain/subgraph concern; an unbounded on-chain array is a gas
  and DoS hazard.
- Do not make `merchantRef` an on-chain actor/principal in this version. It is an
  attribution label, not an address or a role. Merchant-controlled on-chain
  actions are a separate future design (see `Extensibility And Future Forks`).
- Do not hard-enforce "every series must have a merchant" inside Core. Enforcing
  it on-chain would require Core to call the Registry, re-coupling what this
  design separates. The invariant is enforced operationally (Publisher + roles)
  and verified off-chain; see `Orphan Series Policy`.
- Do not route user mint/reveal/exchange through the Registry or Publisher.

## Problem Context

`DOUDOCHAINV2CoreUpgradeable` is already near the EIP-170 24KB contract size
limit. The build is compiled with `optimizer.runs = 1` and `viaIR = true`, which
are the most aggressive size-reduction settings available; the compiler can no
longer absorb new surface. Adding merchant storage, setters, validation, and
events to Core is therefore not viable.

Merchant attribution is also an orthogonal concern to the lottery lifecycle. It
is written once at publish time and never touched during the user hot path. This
makes it a clean candidate to extract into its own contract, applying single
responsibility at the contract boundary.

## Architecture Overview

```text
Admin Backend
  -> MerchantSeriesPublisher.publishSeriesWithMerchant(core, input, subPrizes, markGoodsArrived, merchantRef)
       -> DOUDOCHAINV2CoreUpgradeable.createSeriesWithSubPrizes(input, subPrizes, markGoodsArrived)  // returns seriesID
       -> MerchantSeriesRegistry.linkSeries(core, seriesID, merchantRef)
  (single transaction: both succeed or both revert)
```

User flow is unchanged and never involves the Registry or Publisher:

```text
User
  -> DOUDOCHAINV2CoreUpgradeable.mint(...)
  -> DOUDOCHAINV2CoreUpgradeable.mintAndReveal(...)
  -> DOUDOCHAINV2CoreUpgradeable.reveal(...)
  -> DOUDOCHAINV2CoreUpgradeable.exchangePrize(...)
```

## Contract Set

### DOUDOCHAINV2CoreUpgradeable

Core keeps its current responsibilities and stays behind its UUPS proxy. It does
not gain any merchant knowledge.

Responsibilities (unchanged):

- `mint`, `mintAndReveal`, `reveal`, `exchangePrize`.
- `createSeriesWithSubPrizes` and series inventory/lifecycle.
- Sub-prize inventory and prize draw lifecycle.
- `tokenURI` and canonical series/ticket events.

Changes required for this design:

- Remove the uncommitted `mapping(uint256 => bytes32) public seriesMerchantRefs;`
  and restore the storage `__gap` (see `Migration Notes`).
- Keep `createSeriesWithSubPrizes` returning `seriesID`. The Publisher relies on
  this return value to link the merchant in the same transaction. (Current
  signature already returns it.)
- Move the `SeriesInput` and `SubPrize` struct definitions into a shared
  interface so the Publisher can pass them through without redeclaring them; see
  `Shared Interface`.

Core must not gain a merchant setter, merchant mapping, or merchant event. The
`NewSeries` event keeps its current shape; the existing `address` field in
`NewSeries` is `lastPrizeOwner` and is unrelated to merchants.

### MerchantSeriesRegistry

The Registry is the canonical on-chain attribution ledger. It is the long-lived
source of truth for "which merchant owns which series".

Recommendation: deploy the Registry as a UUPS proxy with intentionally minimal
logic. It is the ledger, and future growth (merchant status flags, off-chain
metadata commitments, merchant-level events) is far cheaper as an in-place
upgrade than as a migration of all historical links. The alternative, a plain
immutable contract, gives stronger tamper-resistance (no upgrade key) and is a
defensible choice if the schema is guaranteed to stay frozen; this design
defaults to UUPS because the product is actively evolving.

Storage:

```solidity
// seriesContract => seriesID => merchantRef
mapping(address => mapping(uint256 => bytes32)) public seriesMerchantRefs;
```

The composite key `(address seriesContract, uint256 seriesID)` is deliberate: it
prevents `seriesID` collisions across different or future Core contracts and
across Core upgrades.

Responsibilities:

- `linkSeries(...)`: record the merchant for a series, once.
- `relinkSeries(...)`: admin-only correction path with an audit event.
- `merchantOf(...)`: read the merchant for a series.
- Emit `SeriesMerchantLinked` and `SeriesMerchantRelinked`.
- Hold no lottery, mint, reveal, or exchange state.

Interface:

```solidity
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
    ) external view returns (bytes32 merchantRef);
}
```

`linkSeries` rules:

- `merchantRef` must not be `bytes32(0)`, else revert.
- `seriesMerchantRefs[seriesContract][seriesID]` must currently be `bytes32(0)`
  (not yet linked), else revert. A series can be linked once.
- Caller must hold `LINKER_ROLE`. `LINKER_ROLE` is granted to the Publisher.

`relinkSeries` rules:

- Caller must hold `DEFAULT_ADMIN_ROLE` (a higher, human-governed role, distinct
  from `LINKER_ROLE`).
- `newMerchantRef` must not be `bytes32(0)`.
- The series must already be linked.
- Emits `SeriesMerchantRelinked` with both the previous and new `merchantRef` so
  every correction leaves an audit trail. This exists because the off-chain
  database can be corrected but an immutable on-chain ledger cannot; a guarded,
  audited correction path is cheap insurance against a publish-time fat-finger.

`merchantRef` is `bytes32` (not a narrower integer) to preserve room for a future
keccak commitment to off-chain merchant data, not just an opaque ID.

### MerchantSeriesPublisher

The Publisher is the single supported entry point for publishing a series. It
orchestrates Core and Registry in one transaction and holds no core business
state.

Recommendation: deploy the Publisher as a plain, replaceable contract (not UUPS).
The publish workflow is the cheapest layer to evolve: to change it, deploy a new
Publisher, grant it the required roles on Core and Registry, and revoke the old
Publisher.

Interface and core method:

```solidity
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
}
```

If `linkSeries` reverts (zero ref, already linked, etc.), the whole transaction
reverts and the Core `createSeriesWithSubPrizes` is rolled back with it. There is
no partial publish.

The Publisher takes `core` as a parameter so a single Publisher can serve current
and future Core contracts. The Registry address is configured at deploy time (or
behind an admin setter).

### Shared Interface

The `SeriesInput` and `SubPrize` structs currently live as contract-level structs
inside Core, and `IDoudoCore` is a module-facing interface that does not declare
them. To let the Publisher pass these structs through without redeclaring them
(and drifting from Core), introduce a shared interface:

```solidity
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

The interface's struct field order and types must mirror the deployed Core
exactly. Solidity derives the call selector and calldata encoding from struct
field types, not struct names, so a mirrored interface produces byte-identical
calls to the already-deployed Core. This means the Publisher can call the live
Core without any Core redeploy.

Core adopting `IDoudoSeriesPublishing.SeriesInput` / `SubPrize` as its own struct
definitions is an optional, bytecode-neutral cleanup (one shared definition), not
a requirement for this feature. It is deferred to avoid re-touching a contract
near the EIP-170 limit. The publish integration test calls the real Core through
`IDoudoSeriesPublishing`, so any future Core struct change that is not mirrored in
the interface breaks that test; the test is the drift guard. This interface lives
in `contracts/interfaces/`.

## Data Model And Invariants

- One series belongs to exactly one merchant. The single-value mapping
  `seriesMerchantRefs[core][seriesID]` enforces this naturally.
- One merchant may own many series. Many keys can map to the same `merchantRef`;
  nothing prevents it.
- A series is linked at most once via `linkSeries`. Corrections go through the
  admin-only `relinkSeries`.
- The reverse mapping (merchant to its series) is intentionally not stored
  on-chain. It is derived in the subgraph/backend from `SeriesMerchantLinked`.
- `merchantRef == bytes32(0)` is reserved to mean "unlinked" and is rejected by
  `linkSeries` and `relinkSeries`.

## Roles And Permissions

| Role | Holder | Purpose |
| --- | --- | --- |
| `Core.OPERATION_ROLE` | `MerchantSeriesPublisher` only | Call `createSeriesWithSubPrizes`. |
| `Registry.LINKER_ROLE` | `MerchantSeriesPublisher` | Call `linkSeries`. |
| `Registry.DEFAULT_ADMIN_ROLE` | Ops/admin wallet | Call `relinkSeries`; grant/revoke roles; authorize Registry upgrades. |
| `Publisher.PUBLISHER_OPERATION_ROLE` | Backend operator/admin wallets | Call `publishSeriesWithMerchant`. |

Critical invariant: `Core.OPERATION_ROLE` must be revoked from all human/back-end
wallets and granted only to the Publisher. This is the linchpin of atomicity. If
any human wallet keeps `Core.OPERATION_ROLE`, it can call
`createSeriesWithSubPrizes` directly and produce an unlinked ("orphan") series,
trivially bypassing the Publisher. Note that `OPERATION_ROLE` also gates other
Core operational setters; review whether those should move to a separate role
before stripping `OPERATION_ROLE` from operators, or whether the Publisher should
expose pass-throughs for them.

## Atomicity And Failure Semantics

- `publishSeriesWithMerchant` performs `createSeriesWithSubPrizes` then
  `linkSeries` in one transaction. EVM call semantics guarantee that a revert in
  `linkSeries` rolls back the Core series creation in the same transaction.
- Failure cases that revert the whole publish: zero `merchantRef`, a series that
  is somehow already linked, missing roles, or any Core-side validation failure
  in `createSeriesWithSubPrizes`.
- Because both effects are in one transaction, an indexer observes either both
  `NewSeries` and `SeriesMerchantLinked`, or neither.

## Orphan Series Policy

It is not possible to hard-enforce "every series has a merchant" purely on-chain
without making Core call the Registry, which would re-couple the contracts this
design separates. The chosen enforcement model is layered:

- Front door: `Core.OPERATION_ROLE` is held only by the Publisher, so the normal
  path always links a merchant.
- Back door monitoring: the subgraph flags any `NewSeries(core, seriesID)` that
  lacks a matching `SeriesMerchantLinked(core, seriesID, ...)`. Such a series is
  an orphan and should raise an operational alert for backfill via `relinkSeries`
  (or a dedicated admin link path) or investigation of how it was created.

Treat orphan series as an operational exception to detect and reconcile, not as a
state the contracts can make unrepresentable.

## The Graph Compatibility

The subgraph indexes two data sources for attribution:

- `DOUDOCHAINV2CoreUpgradeable` proxy: `NewSeries`.
- `MerchantSeriesRegistry`: `SeriesMerchantLinked`, `SeriesMerchantRelinked`.

Read model:

- The `NewSeries` handler creates the `Series` entity (it is emitted first within
  the Publisher transaction).
- The `SeriesMerchantLinked` handler patches `merchantRef` onto the existing
  `Series` entity, keyed by `(seriesContract, seriesID)`.
- The `SeriesMerchantRelinked` handler updates `merchantRef` and may keep a
  correction history entity.
- A `Series` with a null `merchantRef` is an orphan and should be surfaced for
  reconciliation.

Backend publish verification should confirm that one publish transaction (or
publish workflow) produced both:

```text
NewSeries(seriesID)
SeriesMerchantLinked(coreAddress, seriesID, merchantRef)
```

## Events

```solidity
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
```

Core emits its existing `NewSeries` and `NewSubPrize` events unchanged.

## Deployment And Wiring

This is an additive deployment. Core is not redeployed; the Publisher calls the
existing deployed Core proxy through `IDoudoSeriesPublishing`.

Deployment order:

1. Add the `IDoudoSeriesPublishing` interface (mirrors the deployed Core ABI) and
   revert the uncommitted `seriesMerchantRefs` mapping in Core source (working-tree
   hygiene; see `Migration Notes`). No Core redeploy is required for the merchant
   feature; only deploy a Core upgrade if one is independently warranted.
2. Deploy `MerchantSeriesRegistry` (UUPS proxy, minimal logic).
3. Deploy `MerchantSeriesPublisher` (plain contract), configured with the
   Registry address.
4. Wire roles:
   - Grant `Core.OPERATION_ROLE` to the Publisher.
   - Revoke `Core.OPERATION_ROLE` from all human/back-end wallets (after
     migrating any non-publish operational setters to a separate role or
     Publisher pass-through).
   - Grant `Registry.LINKER_ROLE` to the Publisher.
   - Grant `Publisher.PUBLISHER_OPERATION_ROLE` to backend operator/admin
     wallets.
   - Keep `Registry.DEFAULT_ADMIN_ROLE` on the ops/admin wallet.
5. Verify contracts on Arbiscan.
6. Update the subgraph with the `MerchantSeriesRegistry` data source and redeploy.
7. Update the handoff document with deployed addresses and ABI paths.

To replace the Publisher later: deploy the new Publisher, grant it
`Core.OPERATION_ROLE` and `Registry.LINKER_ROLE`, point the backend at it, then
revoke both roles from the old Publisher.

## Migration Notes

The working tree currently adds, in Core:

```solidity
mapping(uint256 => uint256) public seriesLockDuration; // committed, keep
mapping(uint256 => bytes32) public seriesMerchantRefs; // uncommitted, remove
uint256[38] private __gap;                             // was 39 before the merchant mapping
```

`seriesMerchantRefs` is uncommitted and (per the deployed OZ manifest) not part
of a deployed implementation. Revert this addition: delete the
`seriesMerchantRefs` mapping and restore `uint256[39] private __gap;`. Because the
mapping was never deployed, this reclaims the gap slot cleanly with no storage
layout migration.

If, contrary to the above, an implementation containing `seriesMerchantRefs` was
ever deployed, do not delete the slot: keep it reserved (e.g. rename to a
`__deprecated_seriesMerchantRefs` placeholder) and leave `__gap` at 38 to
preserve the storage layout. Confirm against the OZ upgrades manifest before
choosing the path.

## Testing Requirements

Contract tests must cover:

- `publishSeriesWithMerchant` creates a series and links the merchant in one
  transaction, emitting both `NewSeries` and `SeriesMerchantLinked`.
- A revert in `linkSeries` (zero `merchantRef`, already linked) rolls back the
  Core series creation in the same transaction (no orphan series).
- `linkSeries` enforces: non-zero ref, link-once, `LINKER_ROLE` only.
- `relinkSeries` enforces: `DEFAULT_ADMIN_ROLE` only, series already linked,
  non-zero new ref, and emits `SeriesMerchantRelinked` with previous and new ref.
- A direct `createSeriesWithSubPrizes` call from a wallet without
  `OPERATION_ROLE` reverts (Publisher-only path).
- Composite key isolation: the same `seriesID` under two different
  `seriesContract` addresses maps to independent merchant refs.
- `merchantOf` returns the expected ref and `bytes32(0)` for unlinked series.
- Registry UUPS authorization (only `DEFAULT_ADMIN_ROLE`/`UPGRADER_ROLE` upgrades).
- Replacing the Publisher: new Publisher can publish after role grant; old
  Publisher cannot after role revoke.
- Core storage layout: `__gap` restored to 39 after removing `seriesMerchantRefs`
  (OZ upgrades storage-layout check passes).
- The user hot path (`mint`, `mintAndReveal`, `reveal`, `exchangePrize`) is
  byte-for-byte unaffected by the merchant changes.

Verification commands must include:

```text
npm test
npx hardhat size-contracts
```

`size-contracts` must confirm Core stays below the EIP-170 limit and did not grow
from this work.

## Extensibility And Future Forks

Strengths this design buys:

- Core is frozen with respect to merchants. New merchant features (merchant-level
  status, royalties/splits, merchant-scoped pause, metadata commitments) land in
  the Registry without touching or re-auditing Core.
- The Publisher is the evolution seam. New publish-time logic (merchant
  allowlist, issuing a merchant badge, registering the series with a fee router)
  ships as a new Publisher, swapped by role re-grant.
- Multiple and future Core versions are first-class because of the composite
  `(seriesContract, seriesID)` key. A V3 Core reuses the same Registry.

Known future forks to be aware of (out of scope now):

- Hard-enforcing "every series has a merchant" on-chain. This design cannot make
  it a Core invariant without re-coupling Core to the Registry. If it becomes a
  hard business rule, revisit whether Core should call the Registry, accepting
  the coupling and gas cost.
- Merchant as an on-chain actor. `merchantRef` is a label, not an address or a
  role. If merchants later need to call contracts themselves, manage their own
  series, or receive funds to a merchant-controlled address, that requires a
  merchant identity registry (merchant to address, roles, possibly per-merchant
  payout config), which is a substantially larger contract than this attribution
  ledger.

## Implementation Plan Boundary

This design is ready for a separate implementation plan after review. The
implementation should be split into: the shared `IDoudoSeriesPublishing`
interface and Core struct refactor, the Core implementation upgrade that removes
the in-progress `seriesMerchantRefs` mapping, the `MerchantSeriesRegistry` (UUPS)
contract, the `MerchantSeriesPublisher` (plain) contract, role-wiring deploy
scripts with post-deploy assertions, tests, and subgraph updates.
