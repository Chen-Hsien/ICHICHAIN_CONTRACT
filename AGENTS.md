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

## Feature 開工與合併

- 收到明確的新功能實作要求時，先在 DoudoChain 相關 repo 查重。沿用符合需求的未結案 GitHub Issue，或建立新票；讀回確認票號、網址和 open 狀態後，才建功能分支或改程式。只有討論或估工時可先做唯讀調查。若無開票權限，先回報阻礙。
- 跨 repo 的同一功能共用一張主票，其他需要修改的 repo 各自建立或沿用工作票，以 GitHub 原生 sub-issue 掛回主票。票面用繁中寫交付目標、驗收條件及涉及 repo，以獨立行寫「狀態：」與「下一步：」。有明確行動者或日期才填「下一步負責人：@登入名」或「回報日：YYYY-MM-DD」。團隊現有的 Slack 交付看板會從 GitHub 同步。
- 功能分支帶本 repo 票號，功能 PR 標題用 `feat: …`。PR 說明獨立一行寫 `Ticket: Chen-Hsien/ICHICHAIN_CONTRACT#NUMBER`，替換成該 repo 的有效未結案工作票。主票承接本 repo 實作時可直接填主票。草稿、修改說明和後續推送都沿用此格式。
- 未分類的 PR 預設須綁票。純修正、文件、維護等可用 Conventional Commit 類型如 `fix:`、`docs:`、`chore:`。含新功能的混合 PR 一律按 feature 處理。關票或重新開票後 GitHub 會重驗涉及的未合併 PR。
