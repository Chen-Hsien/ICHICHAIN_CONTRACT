# Solana Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Solana/Anchor implementation of the approved DOUDO migration spec, with tests covering the externally meaningful behavior of `DDOUDOCOIN.sol`, `DOUDOCHAIN.sol`, and `DOUDOCOINNFT.sol`.

**Architecture:** Add an isolated Anchor workspace under `solana/` so the existing Hardhat project remains untouched. Implement one Anchor program, `doudou_program`, split into modules for config/roles, non-transferable DOUDO points, ticket series, payment, NFT CPI helpers, randomness, last prize, exchange, voucher, and membership flows. Tests are TypeScript integration tests using a deterministic local validator path and mock randomness.

**Tech Stack:** Anchor 0.31.x, Rust 2021, TypeScript, Mocha/Chai, `@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, Token-2022, Metaplex Token Metadata, Switchboard adapter boundary, local mock randomness.

---

## File Structure

Create a new Solana workspace without moving the Solidity code:

- Create `solana/Anchor.toml`: Anchor workspace config.
- Create `solana/Cargo.toml`: Rust workspace manifest.
- Create `solana/package.json`: test/build scripts and TypeScript dependencies.
- Create `solana/tsconfig.json`: TypeScript test compiler config.
- Create `solana/programs/doudou_program/Cargo.toml`: Anchor program crate manifest.
- Create `solana/programs/doudou_program/src/lib.rs`: program entrypoint and instruction dispatch.
- Create `solana/programs/doudou_program/src/constants.rs`: PDA seed constants, URI limits, decimals.
- Create `solana/programs/doudou_program/src/errors.rs`: Anchor error enum.
- Create `solana/programs/doudou_program/src/events.rs`: Anchor events matching the spec.
- Create `solana/programs/doudou_program/src/state.rs`: account structs and enums.
- Create `solana/programs/doudou_program/src/instructions/config.rs`: config and role instructions.
- Create `solana/programs/doudou_program/src/instructions/points.rs`: Token-2022 DOUDO points instructions.
- Create `solana/programs/doudou_program/src/instructions/series.rs`: series and sub-prize management.
- Create `solana/programs/doudou_program/src/instructions/payment.rs`: USDT payment config and withdrawal.
- Create `solana/programs/doudou_program/src/instructions/ticket.rs`: ticket minting and mint lock.
- Create `solana/programs/doudou_program/src/instructions/randomness.rs`: mock randomness and Switchboard boundary.
- Create `solana/programs/doudou_program/src/instructions/reveal.rs`: reveal request and fulfill.
- Create `solana/programs/doudou_program/src/instructions/last_prize.rs`: last prize selection and fulfill.
- Create `solana/programs/doudou_program/src/instructions/exchange.rs`: physical prize exchange state and metadata updates.
- Create `solana/programs/doudou_program/src/instructions/voucher.rs`: voucher type, mint, burn, reward.
- Create `solana/programs/doudou_program/src/instructions/membership.rs`: membership levels, mint, expiry, transfer sync.
- Create `solana/programs/doudou_program/src/utils/mod.rs`: utility module exports.
- Create `solana/programs/doudou_program/src/utils/math.rs`: checked math helpers.
- Create `solana/programs/doudou_program/src/utils/nft.rs`: NFT ownership and Metaplex CPI helpers.
- Create `solana/programs/doudou_program/src/utils/roles.rs`: shared role checks.
- Create `solana/tests/helpers/pdas.ts`: PDA derivation helpers.
- Create `solana/tests/helpers/setup.ts`: local test setup, wallets, mints.
- Create `solana/tests/helpers/assertions.ts`: shared assertion helpers.
- Create `solana/tests/00_config_roles.spec.ts`: config/role tests.
- Create `solana/tests/01_points.spec.ts`: non-transferable points tests.
- Create `solana/tests/02_series.spec.ts`: series/sub-prize/refund tests.
- Create `solana/tests/03_payments_tickets.spec.ts`: DOUDO/USDT payment, NFT ticket, mint lock tests.
- Create `solana/tests/04_reveal_exchange.spec.ts`: reveal modes, mock randomness, exchange tests.
- Create `solana/tests/05_last_prize.spec.ts`: last prize tests.
- Create `solana/tests/06_voucher_membership.spec.ts`: voucher and membership tests.
- Create `solana/tests/07_end_to_end.spec.ts`: one full happy path across points, tickets, reveal, exchange, vouchers, and membership.

## Task 1: Scaffold the Anchor Workspace

**Files:**
- Create: `solana/Anchor.toml`
- Create: `solana/Cargo.toml`
- Create: `solana/package.json`
- Create: `solana/tsconfig.json`
- Create: `solana/programs/doudou_program/Cargo.toml`
- Create: `solana/programs/doudou_program/src/lib.rs`

- [ ] **Step 1: Write the initial workspace files**

Create `solana/Anchor.toml`:

```toml
[features]
seeds = false
skip-lint = false

[programs.localnet]
doudou_program = "DouDo111111111111111111111111111111111111111"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "npm run test"
```

Create `solana/Cargo.toml`:

```toml
[workspace]
members = [
  "programs/doudou_program"
]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
```

Create `solana/package.json`:

```json
{
  "name": "doudou-solana",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "anchor build",
    "test": "anchor test --skip-local-validator false",
    "test:local": "anchor test --skip-local-validator false",
    "lint": "tsc --noEmit"
  },
  "devDependencies": {
    "@coral-xyz/anchor": "^0.31.1",
    "@metaplex-foundation/mpl-token-metadata": "^3.4.0",
    "@solana/spl-token": "^0.4.13",
    "@solana/web3.js": "^1.98.0",
    "chai": "^5.1.2",
    "mocha": "^10.8.2",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.3"
  }
}
```

Create `solana/tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["mocha", "node"],
    "typeRoots": ["./node_modules/@types"],
    "lib": ["es2021"],
    "module": "commonjs",
    "target": "es2021",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["tests/**/*.ts"]
}
```

Create `solana/programs/doudou_program/Cargo.toml`:

```toml
[package]
name = "doudou_program"
version = "0.1.0"
description = "DOUDO Solana migration program"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "doudou_program"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = { version = "0.31.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.31.1", features = ["metadata"] }
mpl-token-metadata = "5.1.0"
```

Create `solana/programs/doudou_program/src/lib.rs`:

```rust
use anchor_lang::prelude::*;

declare_id!("DouDo111111111111111111111111111111111111111");

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

#[program]
pub mod doudou_program {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
        instructions::config::initialize_config(ctx, args)
    }
}
```

- [ ] **Step 2: Run build to verify the first failure is only missing modules**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm install
npm run build
```

Expected: `npm install` succeeds. `npm run build` fails because `constants`, `errors`, `events`, `instructions`, `state`, and `utils` modules do not exist yet.

- [ ] **Step 3: Commit scaffold**

```bash
git add solana
git commit -m "chore: scaffold anchor workspace"
```

## Task 2: Define State, Errors, Events, and Constants

**Files:**
- Create: `solana/programs/doudou_program/src/constants.rs`
- Create: `solana/programs/doudou_program/src/errors.rs`
- Create: `solana/programs/doudou_program/src/events.rs`
- Create: `solana/programs/doudou_program/src/state.rs`
- Create: `solana/programs/doudou_program/src/instructions/mod.rs`
- Create: `solana/programs/doudou_program/src/instructions/config.rs`
- Create: `solana/programs/doudou_program/src/utils/mod.rs`
- Create: `solana/programs/doudou_program/src/utils/math.rs`
- Create: `solana/programs/doudou_program/src/utils/roles.rs`

- [ ] **Step 1: Add core constants**

Create `constants.rs`:

```rust
pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_ROLE: &[u8] = b"role";
pub const SEED_SERIES: &[u8] = b"series";
pub const SEED_SUB_PRIZE: &[u8] = b"sub_prize";
pub const SEED_TICKET_STATUS: &[u8] = b"ticket_status";
pub const SEED_SERIES_TICKET: &[u8] = b"series_ticket";
pub const SEED_LAST_PRIZE_OWNER: &[u8] = b"last_prize_owner";
pub const SEED_USDT_PAYMENT: &[u8] = b"payment";
pub const SEED_RANDOMNESS_REQUEST: &[u8] = b"randomness_request";
pub const SEED_RANDOMNESS_REQUEST_ITEM: &[u8] = b"randomness_request_item";
pub const SEED_VOUCHER_TYPE: &[u8] = b"voucher_type";
pub const SEED_VOUCHER_STATUS: &[u8] = b"voucher_status";
pub const SEED_USER_VOUCHER_COUNT: &[u8] = b"user_voucher_count";
pub const SEED_USER_INFO: &[u8] = b"user_info";
pub const SEED_MEMBERSHIP_LEVEL: &[u8] = b"membership_level";
pub const SEED_MEMBERSHIP_STATUS: &[u8] = b"membership_status";

pub const DOUDO_DECIMALS: u8 = 18;
pub const MINT_LOCK_SECONDS: i64 = 600;
pub const EXCHANGE_PERIOD_SECONDS: i64 = 60 * 24 * 60 * 60;
pub const MAX_NAME_BYTES: usize = 32;
pub const MAX_SYMBOL_BYTES: usize = 10;
pub const MAX_URI_BYTES: usize = 200;
pub const LAST_PRIZE_ID: u32 = 999;
```

- [ ] **Step 2: Add errors and events**

Create `errors.rs` with every error from the spec:

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum DoudoError {
    #[msg("Goods already arrived")]
    GoodsAlreadyArrived,
    #[msg("Goods have not arrived")]
    GoodsNotArrived,
    #[msg("Series is refunded")]
    SeriesIsRefund,
    #[msg("Series is already refunded")]
    AlreadyRefund,
    #[msg("Not enough NFTs remaining")]
    NotEnoughNftsRemaining,
    #[msg("Series is not sold out yet")]
    NotSoldOutYet,
    #[msg("Last prize winner already chosen")]
    AlreadyChoseWinner,
    #[msg("Sub-prize quantity does not equal unrevealed ticket count")]
    SubPrizeQuantityNotEqual,
    #[msg("Insufficient DOUDO points")]
    InsufficientDoudoPoints,
    #[msg("Insufficient USDT balance")]
    InsufficientUsdtBalance,
    #[msg("Not enough tokens to reveal")]
    NotEnoughTokensToReveal,
    #[msg("Signer is not the token owner")]
    NotTheTokenOwner,
    #[msg("Token already exchanged")]
    TokenAlreadyExchanged,
    #[msg("Token already revealed")]
    TokenAlreadyRevealed,
    #[msg("Token is not revealed")]
    TokenNotRevealed,
    #[msg("Token is not in the series")]
    TokenNotInTheSeries,
    #[msg("Token does not exist")]
    TokenDoesNotExist,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid role")]
    InvalidRole,
    #[msg("Invalid series")]
    InvalidSeries,
    #[msg("Invalid sub-prize")]
    InvalidSubPrize,
    #[msg("Invalid currency")]
    InvalidCurrency,
    #[msg("Invalid randomness provider")]
    InvalidRandomnessProvider,
    #[msg("Randomness request already fulfilled")]
    RandomnessAlreadyFulfilled,
    #[msg("Randomness word count mismatch")]
    RandomnessWordCountMismatch,
    #[msg("Mint is locked by another wallet")]
    MintLockedByAnotherWallet,
    #[msg("Prize accounting is invalid")]
    PrizeAccountingInvalid,
    #[msg("Invalid reveal mode")]
    InvalidRevealMode,
    #[msg("URI is too long")]
    UriTooLong,
    #[msg("Name is too long")]
    NameTooLong,
    #[msg("Invalid voucher type")]
    InvalidVoucherType,
    #[msg("Exceeds max vouchers per user")]
    ExceedsMaxVouchersPerUser,
    #[msg("Cannot burn membership NFT as voucher")]
    CannotBurnMembershipAsVoucher,
    #[msg("User already owns membership")]
    UserAlreadyOwnsMembership,
    #[msg("Invalid membership level")]
    InvalidMembershipLevel,
    #[msg("Membership transfer not synced")]
    MembershipTransferNotSynced,
    #[msg("DOUDO points mint must be non-transferable Token-2022")]
    NonTransferablePointsRequired,
}
```

Create `events.rs` with the first emitted events used by the config and ticket tasks:

```rust
use anchor_lang::prelude::*;

#[event]
pub struct NewSeries {
    pub series_id: u64,
    pub series_name: String,
    pub total_ticket_numbers: u32,
    pub remaining_ticket_numbers: u32,
    pub price_in_usdt_base_units: u64,
    pub price_in_twd: u64,
    pub is_goods_arrived: bool,
    pub estimate_deliver_time: i64,
    pub exchange_expire_time: i64,
    pub is_pre_order: bool,
}

#[event]
pub struct MintLockUpdated {
    pub series: Pubkey,
    pub owner: Pubkey,
    pub lock_until: i64,
}
```

When a later task implements an instruction that emits an event, add that event in the same task before running the task tests. Keep event names exactly as listed in the spec so indexers can rely on stable names.

- [ ] **Step 3: Add account structs and enums**

Create `state.rs` with all account names from the spec. Start with `Config`, `RoleAccount`, `Role`, `RandomnessMode`, `RevealMode`, and `Series`; add the remaining account structs in this same file before moving to instruction tasks:

```rust
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Admin,
    Operation,
    AdminMint,
    Minter,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RandomnessMode {
    Switchboard,
    Mock,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RevealMode {
    UserTriggered,
    ImmediateOnMint,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub program_authority_bump: u8,
    pub doudo_mint: Pubkey,
    pub doudo_mint_authority_bump: u8,
    pub randomness_provider: Pubkey,
    pub randomness_mode: RandomnessMode,
    pub series_counter: u64,
    pub voucher_type_counter: u64,
    pub membership_level_counter: u16,
    pub paused: bool,
}

#[account]
pub struct RoleAccount {
    pub role: Role,
    pub wallet: Pubkey,
    pub granted_by: Pubkey,
    pub created_at: i64,
}

#[account]
pub struct Series {
    pub series_id: u64,
    pub series_name: String,
    pub total_ticket_numbers: u32,
    pub remaining_ticket_numbers: u32,
    pub price_in_usdt_base_units: u64,
    pub price_in_twd: u64,
    pub is_goods_arrived: bool,
    pub estimate_deliver_time: i64,
    pub exchange_expire_time: i64,
    pub is_refund: bool,
    pub is_pre_order: bool,
    pub reveal_mode: RevealMode,
    pub exchange_token_uri: String,
    pub unreveal_token_uri: String,
    pub reveal_token_uri: String,
    pub series_metadata_uri: String,
    pub tickets_minted: u32,
    pub tickets_revealed: u32,
    pub last_prize_chosen: bool,
    pub last_prize_owner_count: u32,
    pub mint_lock_owner: Pubkey,
    pub mint_lock_until: i64,
    pub bump: u8,
}
```

- [ ] **Step 4: Run build**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run build
```

Expected: build progresses past module-not-found errors. It may fail on `InitializeConfig` not being implemented; that failure is expected until Task 3.

- [ ] **Step 5: Commit state foundation**

```bash
git add solana/programs/doudou_program/src
git commit -m "feat: define doudou program state"
```

## Task 3: Implement Config and Role Access Control

**Files:**
- Modify: `solana/programs/doudou_program/src/lib.rs`
- Modify: `solana/programs/doudou_program/src/instructions/config.rs`
- Modify: `solana/programs/doudou_program/src/utils/roles.rs`
- Test: `solana/tests/00_config_roles.spec.ts`
- Test helper: `solana/tests/helpers/pdas.ts`
- Test helper: `solana/tests/helpers/setup.ts`

- [ ] **Step 1: Write failing config/role tests**

Create `00_config_roles.spec.ts` with tests for:

```ts
it("initializes config and grants admin role", async () => {
  const { program, admin, treasury } = await freshFixture();
  await program.methods
    .initializeConfig({ admin: admin.publicKey, treasury: treasury.publicKey, randomnessMode: { mock: {} } })
    .accounts(await initializeConfigAccounts(admin.publicKey))
    .signers([admin])
    .rpc();

  const config = await program.account.config.fetch(configPda());
  expect(config.admin.toBase58()).to.equal(admin.publicKey.toBase58());
});

it("allows admin to grant and revoke operation role", async () => {
  const fx = await initializedFixture();
  await fx.program.methods.grantRole({ operation: {} }, fx.operator.publicKey).accounts(await roleAccounts(fx.admin.publicKey, fx.operator.publicKey, "operation")).signers([fx.admin]).rpc();
  const role = await fx.program.account.roleAccount.fetch(rolePda("operation", fx.operator.publicKey));
  expect(role.wallet.toBase58()).to.equal(fx.operator.publicKey.toBase58());
});

it("rejects role grant from non-admin", async () => {
  const fx = await initializedFixture();
  await expectRejected(
    fx.program.methods.grantRole({ operation: {} }, fx.user.publicKey).accounts(await roleAccounts(fx.user.publicKey, fx.user.publicKey, "operation")).signers([fx.user]).rpc(),
    "Unauthorized"
  );
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "config|role"
```

Expected: tests fail because helper functions and instructions are not implemented.

- [ ] **Step 3: Implement config and role instructions**

Implement:

- `initialize_config(ctx, args)`
- `grant_role(ctx, role, wallet)`
- `revoke_role(ctx, role, wallet)`
- `require_role(role_account, role, wallet)`

Rules:

- `initialize_config` creates `Config` and an admin `RoleAccount`.
- `grant_role` and `revoke_role` require `Role::Admin`.
- Role PDA seeds are `["role", role_name_bytes, wallet]`.

- [ ] **Step 4: Run config/role tests**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "config|role"
```

Expected: all config/role tests pass.

- [ ] **Step 5: Commit config and roles**

```bash
git add solana/programs/doudou_program/src solana/tests
git commit -m "feat: add config and role access control"
```

## Task 4: Implement Token-2022 DOUDO Points

**Files:**
- Modify: `solana/programs/doudou_program/src/instructions/points.rs`
- Modify: `solana/programs/doudou_program/src/lib.rs`
- Test: `solana/tests/01_points.spec.ts`
- Modify helper: `solana/tests/helpers/setup.ts`

- [ ] **Step 1: Write failing points tests**

Create tests:

```ts
it("creates DOUDO points mint with 18 decimals", async () => {
  const fx = await initializedFixture();
  await fx.program.methods.createDoudoPointsMint("DOUDO Points", "DOUDO", "https://example.com/doudo-points.json").accounts(await createDoudoMintAccounts(fx.admin.publicKey)).signers([fx.admin, fx.doudoMint]).rpc();
  const mint = await getMint(fx.connection, fx.doudoMint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  expect(mint.decimals).to.equal(18);
});

it("prevents wallet-to-wallet DOUDO point transfer", async () => {
  const fx = await pointsFixture();
  await mintPointsTo(fx, fx.user.publicKey, 100n * 10n ** 18n);
  await expectTransferCheckedToFailWithNonTransferable(fx);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "DOUDO points"
```

Expected: tests fail because Token-2022 mint creation and point minting do not exist.

- [ ] **Step 3: Implement points instructions**

Implement:

- `create_doudo_points_mint(name, symbol, uri)`
- `mint_doudo_points(to, amount)`
- `redeem_doudo_points(amount, redemption_reference)`

Rules:

- Mint uses Token-2022 with `NonTransferable`.
- Mint decimals are always `18`.
- Mint authority is program authority PDA.
- Direct transfer is not exposed by program.
- Redeem burns points from the user's Token-2022 account.

- [ ] **Step 4: Run points tests**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "DOUDO points"
```

Expected: points tests pass and direct transfer fails with Token-2022 non-transferable behavior.

- [ ] **Step 5: Commit DOUDO points**

```bash
git add solana/programs/doudou_program/src solana/tests
git commit -m "feat: add non-transferable doudou points"
```

## Task 5: Implement Series and Sub-Prize Management

**Files:**
- Modify: `solana/programs/doudou_program/src/instructions/series.rs`
- Modify: `solana/programs/doudou_program/src/lib.rs`
- Test: `solana/tests/02_series.spec.ts`

- [ ] **Step 1: Write failing series tests**

Create tests for:

```ts
it("creates user-triggered and immediate-on-mint series", async () => {
  const fx = await operationFixture();
  await createSeries(fx, { revealMode: { userTriggered: {} }, totalPrizeQuantity: 10 });
  await createSeries(fx, { revealMode: { immediateOnMint: {} }, totalPrizeQuantity: 10 });
  const first = await fx.program.account.series.fetch(seriesPda(0));
  const second = await fx.program.account.series.fetch(seriesPda(1));
  expect(first.revealMode.userTriggered).to.not.equal(undefined);
  expect(second.revealMode.immediateOnMint).to.not.equal(undefined);
});

it("allows update after goods arrived and after refund", async () => {
  const fx = await operationFixture();
  await createSeries(fx, { totalPrizeQuantity: 10 });
  await markGoodsArrived(fx, 0);
  await updateSeriesInfo(fx, 0, { seriesName: "Arrived Update" });
  const arrived = await fx.program.account.series.fetch(seriesPda(0));
  expect(arrived.seriesName).to.equal("Arrived Update");

  await createSeries(fx, { totalPrizeQuantity: 10 });
  await setSeriesRefund(fx, 1);
  await updateSeriesInfo(fx, 1, { seriesName: "Refund Update" });
  const refunded = await fx.program.account.series.fetch(seriesPda(1));
  expect(refunded.seriesName).to.equal("Refund Update");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "series|sub-prize"
```

Expected: tests fail because series instructions are missing.

- [ ] **Step 3: Implement series instructions**

Implement:

- `create_series(args)`
- `update_series_info(args)`
- `upsert_sub_prize(args)`
- `finalize_sub_prize_table(series_id)`
- `mark_goods_arrived(series_id)`
- `set_series_refund(series_id)`

Rules:

- `create_series` stores `RevealMode`.
- `update_series_info` is allowed after goods arrived and after refund.
- Refund blocks mint/reveal/exchange/last prize but not info updates.
- `upsert_sub_prize` enforces accounting safety.
- `finalize_sub_prize_table` verifies active remaining total equals current unrevealed ticket count.

- [ ] **Step 4: Run series tests**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "series|sub-prize"
```

Expected: series and sub-prize tests pass.

- [ ] **Step 5: Commit series management**

```bash
git add solana/programs/doudou_program/src solana/tests
git commit -m "feat: add series and sub-prize management"
```

## Task 6: Implement USDT Payment Config and Ticket Minting with Mint Lock

**Files:**
- Modify: `solana/programs/doudou_program/src/instructions/payment.rs`
- Modify: `solana/programs/doudou_program/src/instructions/ticket.rs`
- Modify: `solana/programs/doudou_program/src/utils/nft.rs`
- Modify: `solana/programs/doudou_program/src/lib.rs`
- Test: `solana/tests/03_payments_tickets.spec.ts`

- [ ] **Step 1: Write failing payment/ticket tests**

Create tests for:

```ts
it("mints ticket by burning DOUDO points and sets 10 minute lock", async () => {
  const fx = await ticketFixture({ revealMode: { userTriggered: {} } });
  await mintPointsTo(fx, fx.user.publicKey, 100n * 10n ** 18n);
  await mintTicketByDoudoPoints(fx, fx.user, 0, 1);
  const series = await fx.program.account.series.fetch(seriesPda(0));
  expect(series.remainingTicketNumbers).to.equal(9);
  expect(series.mintLockOwner.toBase58()).to.equal(fx.user.publicKey.toBase58());
  expect(Number(series.mintLockUntil)).to.be.greaterThan(0);
});

it("rejects another minter during active lock and accepts after lock expires", async () => {
  const fx = await ticketFixture({ revealMode: { userTriggered: {} } });
  await mintPointsTo(fx, fx.user.publicKey, 100n * 10n ** 18n);
  await mintPointsTo(fx, fx.other.publicKey, 100n * 10n ** 18n);
  await mintTicketByDoudoPoints(fx, fx.user, 0, 1);
  await expectRejected(mintTicketByDoudoPoints(fx, fx.other, 0, 1), "MintLockedByAnotherWallet");
  await warpForwardSeconds(fx, 601);
  await mintTicketByDoudoPoints(fx, fx.other, 0, 1);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "payment|ticket|lock"
```

Expected: tests fail because ticket minting, payment config, and NFT helpers are missing.

- [ ] **Step 3: Implement payment and ticket minting**

Implement:

- `set_usdt_payment_config(args)`
- `withdraw_usdt(amount)`
- `mint_ticket_by_doudo_points(series_id, quantity)`
- `mint_ticket_by_usdt(series_id, quantity)`
- `admin_mint_ticket(to, series_id, quantity)`

Rules:

- DOUDO payment burns points.
- USDT payment transfers to treasury token account.
- No SOL payment instruction exists.
- Mint lock rejects a different wallet for 600 seconds.
- Admin mint sets lock owner to recipient.
- Ticket NFT is standard Metaplex `NonFungible`.
- Ticket owner is verified through token account owner checks in later reveal/exchange flows.

- [ ] **Step 4: Run payment/ticket tests**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "payment|ticket|lock"
```

Expected: payment/ticket/mint-lock tests pass.

- [ ] **Step 5: Commit ticket minting**

```bash
git add solana/programs/doudou_program/src solana/tests
git commit -m "feat: add ticket minting and payment flows"
```

## Task 7: Implement Mock Randomness, Reveal Modes, and Exchange

**Files:**
- Modify: `solana/programs/doudou_program/src/instructions/randomness.rs`
- Modify: `solana/programs/doudou_program/src/instructions/reveal.rs`
- Modify: `solana/programs/doudou_program/src/instructions/exchange.rs`
- Modify: `solana/programs/doudou_program/src/utils/nft.rs`
- Test: `solana/tests/04_reveal_exchange.spec.ts`

- [ ] **Step 1: Write failing reveal/exchange tests**

Create tests:

```ts
it("creates reveal request automatically for immediate-on-mint series", async () => {
  const fx = await ticketFixture({ revealMode: { immediateOnMint: {} } });
  await mintPointsTo(fx, fx.user.publicKey, 100n * 10n ** 18n);
  await mintTicketByDoudoPoints(fx, fx.user, 0, 1);
  const request = await fx.program.account.randomnessRequest.fetch(randomnessRequestPda(0));
  expect(request.series.toBase58()).to.equal(seriesPda(0).toBase58());
});

it("assigns deterministic prize with mock randomness and blocks exchange before goods arrived", async () => {
  const fx = await ticketFixture({ revealMode: { immediateOnMint: {} } });
  await mintPointsTo(fx, fx.user.publicKey, 100n * 10n ** 18n);
  const ticketMint = await mintTicketByDoudoPoints(fx, fx.user, 0, 1);
  await fulfillRevealWithMockWords(fx, 0, [0]);
  const status = await fx.program.account.ticketStatus.fetch(ticketStatusPda(ticketMint));
  expect(status.tokenRevealed).to.equal(true);
  await expectRejected(exchangePrize(fx, fx.user, [ticketMint]), "GoodsNotArrived");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "reveal|exchange"
```

Expected: tests fail because randomness and reveal instructions are missing.

- [ ] **Step 3: Implement randomness and reveal**

Implement:

- `request_reveal(series_id, ticket_mints)`
- `fulfill_reveal(request_id, random_words)`
- `mock_fulfill_reveal(request_id, random_words)` if a separate test-only instruction is cleaner.
- `exchange_prize(ticket_mints)`

Rules:

- Manual reveal requires `RevealMode::UserTriggered` and goods arrived.
- Immediate-on-mint creates request during mint and can fulfill before goods arrived.
- Exchange requires goods arrived.
- Reveal decrements sub-prize remaining and increments revealed quantity.
- Metadata URI updates use `series.reveal_token_uri + prize_id`.
- Exchange metadata URI uses `series.exchange_token_uri + prize_id`.

- [ ] **Step 4: Run reveal/exchange tests**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "reveal|exchange"
```

Expected: reveal mode and exchange tests pass.

- [ ] **Step 5: Commit reveal and exchange**

```bash
git add solana/programs/doudou_program/src solana/tests
git commit -m "feat: add reveal modes and exchange"
```

## Task 8: Implement Last Prize

**Files:**
- Modify: `solana/programs/doudou_program/src/instructions/last_prize.rs`
- Modify: `solana/programs/doudou_program/src/utils/nft.rs`
- Modify: `solana/programs/doudou_program/src/lib.rs`
- Test: `solana/tests/05_last_prize.spec.ts`

- [ ] **Step 1: Write failing last prize tests**

Create tests:

```ts
it("awards non-preorder last prize to owner of last minted ticket", async () => {
  const fx = await soldOutSeriesFixture({ isPreOrder: false });
  const winner = fx.lastMinter;
  await chooseLastPrizeWinner(fx, 0, 1);
  const owner = await nftOwner(fx, fx.lastPrizeMint);
  expect(owner.toBase58()).to.equal(winner.publicKey.toBase58());
});

it("uses mock randomness for preorder last prize", async () => {
  const fx = await soldOutSeriesFixture({ isPreOrder: true });
  await chooseLastPrizeWinner(fx, 0, 1);
  await fulfillLastPrizeWithMockWords(fx, 0, [1]);
  const winnerRecord = await fx.program.account.lastPrizeOwner.fetch(lastPrizeOwnerPda(seriesPda(0), 0));
  expect(winnerRecord.owner.toBase58()).to.equal(fx.secondMinter.publicKey.toBase58());
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "last prize"
```

Expected: tests fail because last prize instructions are missing.

- [ ] **Step 3: Implement last prize instructions**

Implement:

- `choose_last_prize_winner(series_id, quantity)`
- `fulfill_last_prize(request_id, random_words)`

Rules:

- Series must be sold out.
- Last prize can be chosen once.
- Non-preorder uses last minted ticket owner.
- Preorder uses randomness.
- Last prize NFT has revealed prize id `999`.

- [ ] **Step 4: Run last prize tests**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "last prize"
```

Expected: last prize tests pass.

- [ ] **Step 5: Commit last prize**

```bash
git add solana/programs/doudou_program/src solana/tests
git commit -m "feat: add last prize selection"
```

## Task 9: Implement Voucher and Membership Flows

**Files:**
- Modify: `solana/programs/doudou_program/src/instructions/voucher.rs`
- Modify: `solana/programs/doudou_program/src/instructions/membership.rs`
- Modify: `solana/programs/doudou_program/src/utils/nft.rs`
- Modify: `solana/programs/doudou_program/src/lib.rs`
- Test: `solana/tests/06_voucher_membership.spec.ts`

- [ ] **Step 1: Write failing voucher/membership tests**

Create tests:

```ts
it("mints vouchers, burns them, and mints non-transferable DOUDO points", async () => {
  const fx = await voucherFixture();
  await createVoucherType(fx, { amount: 100, maxPerUser: 2, tokenUri: "https://example.com/voucher.json" });
  const vouchers = await mintVouchers(fx, fx.user, [0], [2]);
  await burnVouchersBatch(fx, fx.user, vouchers);
  const balance = await getDoudoBalance(fx, fx.user.publicKey);
  expect(balance).to.equal(200n * 10n ** 18n);
});

it("syncs transferable membership NFT ownership after transfer", async () => {
  const fx = await voucherFixture();
  const membershipMint = await mintMembershipNft(fx, fx.user, 2);
  await transferNft(fx, membershipMint, fx.user, fx.other.publicKey);
  await syncMembershipTransfer(fx, fx.user.publicKey, fx.other.publicKey, membershipMint);
  const otherInfo = await fx.program.account.userInfo.fetch(userInfoPda(fx.other.publicKey));
  expect(otherInfo.membershipLevel).to.equal(2);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "voucher|membership"
```

Expected: tests fail because voucher and membership instructions are missing.

- [ ] **Step 3: Implement voucher and membership instructions**

Implement:

- `initialize_default_membership_levels()`
- `create_voucher_type(amount, max_per_user, token_uri)`
- `update_voucher_type(voucher_type_id, amount, max_per_user, token_uri)`
- `mint_vouchers(to, voucher_type_ids, quantities)`
- `mint_membership_nft(to, membership_level)`
- `burn_vouchers_batch(token_mints)`
- `set_membership_expiration_period(new_period)`
- `add_membership_level(name, threshold, uri, reward_basis_points)`
- `update_membership_level(level_index, threshold, uri, reward_basis_points)`
- `sync_membership_transfer(from, to, membership_mint)`

Rules:

- Voucher/membership NFTs are standard transferable Metaplex `NonFungible`.
- Voucher burn mints DOUDO points.
- Membership reward basis points apply to voucher burn.
- Membership benefits are based on synchronized program state and verified NFT ownership.

- [ ] **Step 4: Run voucher/membership tests**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run test -- --grep "voucher|membership"
```

Expected: voucher and membership tests pass.

- [ ] **Step 5: Commit voucher/membership**

```bash
git add solana/programs/doudou_program/src solana/tests
git commit -m "feat: add voucher and membership flows"
```

## Task 10: Add End-to-End Test and Final Verification

**Files:**
- Create: `solana/tests/07_end_to_end.spec.ts`
- Modify: `solana/README.md`

- [ ] **Step 1: Write full happy-path test**

Create one test that executes:

```ts
it("runs the DOUDO Solana happy path", async () => {
  const fx = await fullFixture();
  await mintPointsTo(fx, fx.user.publicKey, 1000n * 10n ** 18n);
  await createSeries(fx, { revealMode: { immediateOnMint: {} }, totalPrizeQuantity: 2 });
  await upsertSubPrize(fx, 0, { subPrizeId: 1, remainingQuantity: 2, group: "A", name: "A1" });
  await finalizeSubPrizeTable(fx, 0);
  const ticketMint = await mintTicketByDoudoPoints(fx, fx.user, 0, 1);
  await fulfillRevealWithMockWords(fx, 0, [0]);
  await markGoodsArrived(fx, 0);
  await exchangePrize(fx, fx.user, [ticketMint]);
  await createVoucherType(fx, { amount: 50, maxPerUser: 1, tokenUri: "https://example.com/voucher.json" });
  const vouchers = await mintVouchers(fx, fx.user, [0], [1]);
  await burnVouchersBatch(fx, fx.user, vouchers);
  const status = await fx.program.account.ticketStatus.fetch(ticketStatusPda(ticketMint));
  expect(status.tokenExchange).to.equal(true);
});
```

- [ ] **Step 2: Add Solana README**

Create `solana/README.md`:

```markdown
# DOUDO Solana Program

This Anchor workspace implements the Solana migration of the DOUDO Solidity contracts.

## Commands

```bash
npm install
npm run build
npm run test
```

## Payment Model

Ticket minting supports DOUDO point burn and USDT SPL token transfer. SOL ticket payment is not part of this version.

## Asset Model

DOUDO points use Token-2022 `NonTransferable` with 18 decimals. Tickets, last prizes, vouchers, and memberships are standard transferable Metaplex `NonFungible` NFTs.
```

- [ ] **Step 3: Run all verification**

Run:

```bash
cd /Users/angustsai/ICHICHAIN_CONTRACT/solana
npm run lint
npm run build
npm run test
```

Expected: TypeScript compiles, Anchor builds, and the full test suite passes.

- [ ] **Step 4: Commit final verification docs**

```bash
git add solana
git commit -m "test: add solana end-to-end coverage"
```

## Spec Coverage Checklist

- DDOUDOCOIN migration: Tasks 4, 6, 9, and 10.
- Non-transferable DOUDO points with 18 decimals: Task 4.
- DOUDOCHAIN series management: Task 5.
- Post-goods-arrival and post-refund edits: Task 5.
- Sub-prize accounting safety: Task 5 and Task 7.
- DOUDO and USDT ticket payment: Task 6.
- No SOL ticket payment in first release: Task 6.
- Ten-minute mint lock: Task 6.
- Formal transferable Metaplex ticket NFTs: Task 6.
- User-triggered and immediate-on-mint reveal modes: Task 7.
- Switchboard boundary and mock randomness: Task 7 and Task 8.
- Physical exchange requires goods arrived: Task 7.
- Last prize behavior: Task 8.
- Voucher NFT behavior: Task 9.
- Membership NFT behavior and transfer sync: Task 9.
- End-to-end happy path: Task 10.

## Execution Handoff

Plan complete. Start with Task 1 and do not skip the failing-test step for any behavior task. Use a fresh branch or worktree before implementation because this repository currently contains unrelated untracked Solidity files.
