# Domain Docs

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** entries that touch the area of work.

If these files do not exist, proceed silently. `/domain-modeling` creates them when terms or decisions are resolved.

## File structure

This is a single-context repository: root `CONTEXT.md` plus `docs/adr/`.

## Cross-repository ownership

- This repository owns final chain state, access control, accounting, events, and callable behavior.
- Backend (`/Users/angustsai/doudochain-backend`) owns orchestration.
- Admin (`/Users/angustsai/doudo-admin`) owns operations UI.
- The Graph (`/Users/angustsai/thegraph/doudochain_amoy`) owns indexing.
- Frontend (`/Users/angustsai/ichichain`) owns buyer presentation.

For cross-layer defects, trace the relevant flow across those owners and fix the source invariant.

## Use the glossary's vocabulary

Use terms defined in `CONTEXT.md` in issue titles, refactor proposals, hypotheses, and tests. Flag ADR conflicts explicitly rather than silently overriding them.
