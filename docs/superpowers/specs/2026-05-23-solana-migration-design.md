# Solana Migration Design

## Status

Approved direction from product owner:

- Migrate the existing functionality in `contracts/DDOUDOCOIN.sol`, `contracts/DOUDOCHAIN.sol`, and `contracts/DOUDOCOINNFT.sol` to Solana.
- Build the Solana version as a single Anchor program with business modules.
- Use formal wallet-recognized NFTs with the highest practical ecosystem support.
- Use Switchboard randomness in production and a mock randomness provider in tests.
- Ticket minting is paid primarily with non-transferable DOUDO points, with USDT SPL token as the secondary payment option.
- Redesign DOUDO as non-transferable reward points with 18 decimals because of Taiwan regulatory concerns and continuity with existing EVM reward accounting.
- Ticket NFTs and membership NFTs remain freely transferable as standard Metaplex `NonFungible` NFTs.
- Each series chooses whether tickets reveal immediately after mint or whether users trigger reveal themselves.
- Write tests from the existing Solidity behavior before implementation.

This document is a technical product spec, not a legal opinion. The DOUDO points design reduces transferability and market-circulation risk, but Taiwan legal classification still depends on the actual business model, marketing, redemption terms, cash-out policy, merchant scope, and regulatory advice.

## Source Contracts

### `contracts/DDOUDOCOIN.sol`

Current behavior:

- ERC20 named `DOUDOCOIN`, symbol `DOUDO`.
- Uses OpenZeppelin `AccessControl`.
- `DEFAULT_ADMIN_ROLE` grants administrative role management.
- `MINTER_ROLE` can call `mint(to, amount)`.
- Token is currently transferable because it inherits standard ERC20 behavior.

Solana target:

- Replace ERC20 with a Token-2022 mint using the `NonTransferable` mint extension.
- Token name in metadata should avoid asset/investment language. Use wording like `DOUDO Points`.
- The program authority PDA is mint authority.
- User balances live in Token-2022 associated token accounts.
- Users cannot transfer points wallet-to-wallet.
- Users can burn/redeem points only through approved program instructions.

### `contracts/DOUDOCHAIN.sol`

Current behavior:

- ERC721A ticket NFT contract named `DOUDOCHAIN`, symbol `DOUDO`.
- Uses `AccessControl`, `ReentrancyGuard`, Chainlink VRF, Chainlink price feeds, and ERC20 payment tokens.
- Defines `OPERATION_ROLE` and `ADMINMINT_ROLE`.
- Operators create and update series.
- Operators configure sub-prizes before goods arrive.
- Users mint tickets by native coin or configured ERC20 currency.
- Admins can mint tickets without payment.
- Goods arrival opens reveal and sets exchange expiry.
- Reveal requests randomness and assigns unrevealed prizes by remaining prize quantity.
- Last prize winner is chosen after sell-out.
- Non-preorder series awards the last prize to the owner of the last minted ticket.
- Preorder series uses randomness for last prize winners.
- Users exchange revealed prizes, which changes token URI behavior.
- Operators can refund a series before goods arrive.
- Native and ERC20 funds can be withdrawn by owner.

Required changes:

- On every paid or admin ticket mint, set a per-series mint lock:
  - `mint_lock_owner = minter`
  - `mint_lock_until = current_unix_timestamp + 600`
  - while the lock is active, only `mint_lock_owner` can mint that series
  - after expiry, the next successful minter becomes the new lock owner
- Series information remains editable after `goods_arrived`.
- `series_metadata_uri`, `unreveal_token_uri`, `reveal_token_uri`, and `exchange_token_uri` remain editable after `goods_arrived`.
- Sub-prize data remains editable after `goods_arrived`, subject to reveal accounting safety.
- Series information and metadata remain editable after refund so operations can correct indexer/display content.
- Series creation includes `reveal_mode`:
  - `UserTriggered`: preserves the current flow where users call reveal after goods arrive.
  - `ImmediateOnMint`: minting automatically opens a reveal request for the newly minted tickets. With production Switchboard, fulfillment is still asynchronous; with mock randomness in tests, assignment can be deterministic.

### `contracts/DOUDOCOINNFT.sol`

Current behavior:

- ERC721 voucher and membership NFT contract named `DOUDOCOINNFT`, symbol `DOUDO`.
- Uses `AccessControl`, `ERC721Enumerable`, and `ERC721Burnable`.
- Has voucher types with amount, max per user, and URI.
- Minter can mint vouchers.
- Minter can mint membership NFTs.
- Burning vouchers mints DOUDO reward token to the user.
- Membership levels have threshold, URI, and reward basis points.
- User redemption totals can upgrade membership.
- Membership expires after a configurable period.
- Membership NFT transfer updates user membership state and may burn lower-level membership NFTs.

Solana target:

- Voucher NFTs and membership NFTs are formal Metaplex NFTs.
- Voucher and membership business state is stored in program-owned PDAs.
- Voucher burn redeems non-transferable DOUDO points.
- Membership NFTs remain freely transferable. Membership benefits are resolved by current NFT ownership plus program state synchronization.

## Architecture

Use one Anchor program named `doudou_program` with these internal modules:

- `config`: global settings, roles, authorities, treasury, providers.
- `points`: DOUDO non-transferable Token-2022 point mint and redemption.
- `chain`: DOUDOCHAIN series, ticket NFTs, minting, reveal, last prize, exchange, refund.
- `voucher`: voucher NFT and membership NFT logic.
- `nft`: CPI helpers for SPL Token mint creation and Metaplex Token Metadata creation/update.
- `randomness`: production Switchboard adapter and local mock adapter.
- `payment`: DOUDO point burn payment, USDT SPL token payment, and USDT withdrawal.

External programs:

- System Program for account creation and rent funding.
- Token-2022 Program for DOUDO non-transferable points.
- SPL Token Program for standard NFT mints and USDT token accounts.
- Associated Token Program for ATAs.
- Metaplex Token Metadata Program for formal NFT metadata.
- Switchboard program for production randomness.

Standards rationale:

- Metaplex Token Metadata is the most widely supported route for wallet-visible Solana NFTs. Each ticket, last prize, voucher, and membership NFT should be a standard transferable supply-one, decimals-zero `NonFungible` mint with a Metaplex metadata account and master edition.
- DOUDO fungible points should use Token-2022 `NonTransferable` because the extension makes token transfers fail at the token-program level. This is stronger than only checking transfers inside the business program.
- Switchboard randomness gives production oracle-backed randomness; mock randomness makes tests deterministic.
- Programmable NFTs are reserved for a later version if transfer restrictions become necessary. The first version uses standard `NonFungible` assets because wallet and marketplace support is broader, and the current product requirement is free transferability.

References:

- Solana Metaplex metadata: https://solana.com/docs/tokens/metaplex
- Metaplex Token Metadata overview: https://www.metaplex.com/docs/smart-contracts/token-metadata
- Metaplex programmable NFTs: https://www.metaplex.com/docs/token-metadata/pnfts
- Solana Token-2022 non-transferable tokens: https://solana.com/docs/tokens/extensions/non-transferrable-tokens
- Switchboard Solana randomness: https://docs.switchboard.xyz/docs-by-chain/solana-svm/randomness
- Anchor account constraints: https://www.anchor-lang.com/docs/references/account-constraints

## Account Model

### `Config`

PDA seeds:

```text
["config"]
```

Fields:

- `admin: Pubkey`
- `treasury: Pubkey`
- `program_authority_bump: u8`
- `doudo_mint: Pubkey`
- `doudo_mint_authority_bump: u8`
- `randomness_provider: Pubkey`
- `randomness_mode: RandomnessMode`
- `series_counter: u64`
- `voucher_type_counter: u64`
- `membership_level_counter: u16`
- `paused: bool`

Responsibilities:

- Global authority source.
- Stores the DOUDO point mint.
- Stores counters used to create deterministic business IDs.
- Stores production or test randomness mode.

### `RoleAccount`

PDA seeds:

```text
["role", role_name_bytes, wallet]
```

Fields:

- `role: Role`
- `wallet: Pubkey`
- `granted_by: Pubkey`
- `created_at: i64`

Roles:

- `Admin`
- `Operation`
- `AdminMint`
- `Minter`

Responsibilities:

- Replaces Solidity `AccessControl`.
- Role checks require the signer wallet to match an initialized role PDA.

### `Series`

PDA seeds:

```text
["series", series_id_le_bytes]
```

Fields:

- `series_id: u64`
- `series_name: String`
- `total_ticket_numbers: u32`
- `remaining_ticket_numbers: u32`
- `price_in_usdt_base_units: u64`
- `price_in_twd: u64`
- `is_goods_arrived: bool`
- `estimate_deliver_time: i64`
- `exchange_expire_time: i64`
- `is_refund: bool`
- `is_pre_order: bool`
- `reveal_mode: RevealMode`
- `exchange_token_uri: String`
- `unreveal_token_uri: String`
- `reveal_token_uri: String`
- `series_metadata_uri: String`
- `tickets_minted: u32`
- `tickets_revealed: u32`
- `last_prize_chosen: bool`
- `last_prize_owner_count: u32`
- `mint_lock_owner: Pubkey`
- `mint_lock_until: i64`
- `bump: u8`

Responsibilities:

- Stores mutable series configuration.
- Tracks supply and lock state.
- Tracks reveal and last prize status.
- Controls whether tickets use user-triggered reveal or automatic reveal request creation after mint.

`RevealMode` values:

- `UserTriggered`
- `ImmediateOnMint`

URI limits:

- Each URI should be capped at 200 bytes to match common Metaplex metadata constraints.
- The program should reject oversized names and URIs before CPI.

### `SubPrize`

PDA seeds:

```text
["sub_prize", series.key(), sub_prize_id_le_bytes]
```

Fields:

- `series: Pubkey`
- `sub_prize_id: u32`
- `prize_group: String`
- `sub_prize_name: String`
- `initial_quantity: u32`
- `remaining_quantity: u32`
- `revealed_quantity: u32`
- `is_active: bool`
- `bump: u8`

Responsibilities:

- Replaces `Series.subPrizes`.
- Supports post-arrival updates without reallocating a large `Series` vector.
- Reveal decrements `remaining_quantity` and increments `revealed_quantity`.

Accounting rule:

- For a series, sum of all active `remaining_quantity` must equal unrevealed tickets remaining.
- A sub-prize update cannot reduce a prize below its already revealed quantity.
- A full sub-prize reset after tickets are revealed is not allowed.
- Operators can add, deactivate, rename, and adjust future remaining quantities if total unrevealed prize quantity remains valid.

### `TicketStatus`

PDA seeds:

```text
["ticket_status", ticket_mint]
```

Fields:

- `series: Pubkey`
- `ticket_mint: Pubkey`
- `ticket_index: u32`
- `owner: Pubkey`
- `token_revealed_prize: u32`
- `token_exchange: bool`
- `token_revealed: bool`
- `is_last_prize: bool`
- `metadata: Pubkey`
- `bump: u8`

Responsibilities:

- Replaces `ticketStatusDetail`.
- Stores reveal/exchange state independent of NFT metadata.
- Current owner is refreshed in program-controlled flows. For user-initiated reveal/exchange, ownership is verified from the NFT token account.

### `SeriesTicket`

PDA seeds:

```text
["series_ticket", series.key(), ticket_index_le_bytes]
```

Fields:

- `series: Pubkey`
- `ticket_mint: Pubkey`
- `ticket_index: u32`
- `original_minter: Pubkey`
- `minted_at: i64`
- `bump: u8`

Responsibilities:

- Replaces `seriesTokens[seriesID]`.
- Supports last minted ticket lookup for non-preorder last prize.
- Supports random index lookup for preorder last prize.

### `LastPrizeOwner`

PDA seeds:

```text
["last_prize_owner", series.key(), winner_index_le_bytes]
```

Fields:

- `series: Pubkey`
- `winner_index: u32`
- `owner: Pubkey`
- `last_prize_ticket_mint: Pubkey`
- `source_ticket_mint: Pubkey`
- `bump: u8`

Responsibilities:

- Replaces `Series.lastPrizeOwner`.
- Avoids an unbounded vector inside `Series`.

### `UsdtPaymentConfig`

PDA seeds:

```text
["payment", "usdt"]
```

Fields:

- `mint: Pubkey`
- `treasury_token_account: Pubkey`
- `decimals: u8`
- `is_active: bool`
- `bump: u8`

Responsibilities:

- Replaces the broad Solidity `currencyList` for the first Solana release.
- Supports USDT-denominated ticket prices directly.
- Keeps the payment surface narrow: DOUDO points or USDT only.
- Additional SPL currencies can be added later with a generalized currency config if the product needs them.

### `RandomnessRequest`

PDA seeds:

```text
["randomness_request", request_id_le_bytes]
```

Fields:

- `request_id: u64`
- `request_type: RandomnessRequestType`
- `series: Pubkey`
- `requester: Pubkey`
- `token_count: u16`
- `fulfilled: bool`
- `created_at_slot: u64`
- `created_at: i64`
- `switchboard_account: Pubkey`
- `bump: u8`

Associated request item accounts:

```text
["randomness_request_item", randomness_request.key(), item_index_le_bytes]
```

Fields:

- `request: Pubkey`
- `item_index: u16`
- `ticket_mint: Pubkey`

Responsibilities:

- Replaces `requestToRevealToken`, `requestToLastPrizeToken`, and `requests`.
- Keeps request state bounded and testable.

### `VoucherType`

PDA seeds:

```text
["voucher_type", voucher_type_id_le_bytes]
```

Fields:

- `voucher_type_id: u64`
- `amount: u64`
- `max_per_user: u32`
- `token_uri: String`
- `is_active: bool`
- `bump: u8`

Responsibilities:

- Replaces `voucherTypes`.

### `VoucherStatus`

PDA seeds:

```text
["voucher_status", voucher_mint]
```

Fields:

- `voucher_mint: Pubkey`
- `voucher_type: Pubkey`
- `owner: Pubkey`
- `redeemed: bool`
- `metadata: Pubkey`
- `bump: u8`

Responsibilities:

- Replaces `voucherTypeIds` for voucher NFTs.
- Tracks burn/redeem status.

### `UserVoucherCount`

PDA seeds:

```text
["user_voucher_count", user, voucher_type.key()]
```

Fields:

- `user: Pubkey`
- `voucher_type: Pubkey`
- `count: u32`
- `bump: u8`

Responsibilities:

- Replaces `userVoucherCounts`.
- Enforces `max_per_user`.

### `UserInfo`

PDA seeds:

```text
["user_info", user]
```

Fields:

- `user: Pubkey`
- `total_redeemed: u64`
- `current_round_redeemed: u64`
- `membership_level: u16`
- `membership_nft_mint: Pubkey`
- `last_active_timestamp: i64`
- `bump: u8`

Responsibilities:

- Replaces `userInfo`.
- Stores membership and reward redemption state.

### `MembershipLevel`

PDA seeds:

```text
["membership_level", level_index_le_bytes]
```

Fields:

- `level_index: u16`
- `name: String`
- `threshold: u64`
- `membership_token_uri: String`
- `reward_basis_points: u16`
- `is_active: bool`
- `bump: u8`

Responsibilities:

- Replaces `membershipLevels`.

### `MembershipStatus`

PDA seeds:

```text
["membership_status", membership_mint]
```

Fields:

- `membership_mint: Pubkey`
- `owner: Pubkey`
- `level_index: u16`
- `metadata: Pubkey`
- `burned: bool`
- `bump: u8`

Responsibilities:

- Replaces `isMembershipNFT[tokenId]`.
- Allows the program to recognize membership NFTs.

## Instruction Design

### Initialization and Roles

#### `initialize_config(admin, treasury, randomness_mode)`

Accounts:

- `payer`
- `config`
- `program_authority`
- `system_program`

Behavior:

- Initializes global `Config`.
- Sets `admin` and `treasury`.
- Initializes counters to zero.
- Grants `Admin` role to `admin`.

Tests:

- Initializes config once.
- Rejects duplicate initialization.
- Admin role account exists after initialization.

#### `grant_role(role, wallet)`

Accounts:

- `admin_signer`
- `admin_role`
- `role_account`
- `system_program`

Behavior:

- Requires `Admin`.
- Creates or overwrites a role PDA for `wallet`.

Tests:

- Admin can grant roles.
- Non-admin cannot grant roles.
- Granted operation signer can call operation-only instructions.

#### `revoke_role(role, wallet)`

Behavior:

- Requires `Admin`.
- Closes or deactivates the role PDA.

Tests:

- Revoked wallet loses access.
- Non-admin cannot revoke roles.

### DOUDO Points

#### `create_doudo_points_mint(name, symbol, uri)`

Accounts:

- `admin_signer`
- `admin_role`
- `config`
- `doudo_mint`
- `program_authority`
- Token-2022 program
- metadata accounts if metadata is attached

Behavior:

- Requires `Admin`.
- Creates a Token-2022 mint with `NonTransferable`.
- Uses 18 decimals to preserve continuity with the existing EVM reward amounts and membership thresholds.
- Sets mint authority to program authority PDA.
- Stores mint in `Config`.

Tests:

- Mint has Token-2022 `NonTransferable`.
- Direct token transfer fails with token-program error.
- Program can mint points to user ATA.

#### `mint_doudo_points(to, amount)`

Behavior:

- Requires `Minter` role or internal program call from voucher redemption.
- Mints non-transferable DOUDO points to `to`.

Tests:

- Minter can mint.
- Non-minter cannot mint.
- Minted points cannot be transferred.

#### `redeem_doudo_points(amount, redemption_reference)`

Behavior:

- Burns DOUDO points from the user ATA.
- Emits a redemption event.
- Does not transfer points to another wallet.

Tests:

- User can burn own points through program.
- User cannot redeem more than balance.
- Another wallet cannot burn user points.

### Series Management

#### `create_series(args)`

Args:

- `series_name`
- `price_in_usdt_base_units`
- `price_in_twd`
- `estimate_deliver_time`
- `total_prize_quantity`
- `is_pre_order`
- `exchange_token_uri`
- `unreveal_token_uri`
- `reveal_token_uri`
- `series_metadata_uri`
- `reveal_mode`

Behavior:

- Requires `Operation`.
- Creates `Series` with `remaining_ticket_numbers = total_prize_quantity`.
- Sets `exchange_expire_time = estimate_deliver_time + 60 days`.
- Sets `is_goods_arrived = false`.
- Sets `is_refund = false`.
- Stores `reveal_mode`.
- Initializes mint lock as inactive with `mint_lock_until = 0`.

Tests:

- Operation signer can create series.
- Non-operation signer cannot create series.
- Fields match input.
- Series counter increments.

#### `update_series_info(args)`

Args:

- `series_id`
- `series_name`
- `price_in_usdt_base_units`
- `price_in_twd`
- `estimate_deliver_time`
- `exchange_expire_time`
- `exchange_token_uri`
- `unreveal_token_uri`
- `reveal_token_uri`
- `series_metadata_uri`
- `is_pre_order`
- `reveal_mode`

Behavior:

- Requires `Operation`.
- Allowed before and after goods arrived.
- Allowed after refund so operations can correct metadata and display details.
- Refunded series still rejects mint, reveal, last prize, and exchange flows that would create new user-facing obligations.
- Does not reset reveal state.

Tests:

- Can update before goods arrived.
- Can update after goods arrived.
- Metadata URI update affects future metadata update calls.
- Non-operation signer cannot update.
- Refunded series can still update series information and metadata.

#### `upsert_sub_prize(args)`

Args:

- `series_id`
- `sub_prize_id`
- `prize_group`
- `sub_prize_name`
- `target_remaining_quantity`
- `is_active`

Behavior:

- Requires `Operation`.
- Allowed before and after goods arrived.
- If tickets have been revealed, cannot set `remaining_quantity` below zero or violate total unrevealed quantity.
- Emits sub-prize update event.

Tests:

- Creates sub-prize.
- Updates name/group/remaining before goods arrived.
- Updates after goods arrived.
- Rejects total remaining mismatch before any reveal when finalizing prize table.
- Rejects unsafe decrease after reveals.

#### `finalize_sub_prize_table(series_id)`

Behavior:

- Requires `Operation`.
- Verifies active sub-prize remaining quantity sum equals `Series.remaining_ticket_numbers`.
- Marks the table as valid for mint/reveal.

Tests:

- Valid table passes.
- Mismatched table fails.

#### `mark_goods_arrived(series_id)`

Behavior:

- Requires `Operation`.
- Rejects refunded series.
- Rejects already arrived series.
- Sets `is_goods_arrived = true`.
- Sets `estimate_deliver_time = now`.
- Sets `exchange_expire_time = now + 60 days`.

Tests:

- Operation can mark arrived.
- Cannot mark refunded series arrived.
- Cannot mark arrived twice.
- Reveal becomes allowed after arrival.

#### `set_series_refund(series_id)`

Behavior:

- Requires `Operation`.
- Rejects already refunded series.
- Rejects goods-arrived series.
- Sets `is_refund = true`.

Tests:

- Operation can refund before goods arrived.
- Cannot refund after goods arrived.
- Cannot refund twice.
- Refunded series rejects mint/reveal.

### Payment

#### `set_usdt_payment_config(args)`

Args:

- `mint`
- `treasury_token_account`
- `decimals`
- `is_active`

Behavior:

- Requires `Operation`.
- Creates or updates `UsdtPaymentConfig`.
- USDT prices use `Series.price_in_usdt_base_units` directly.

Tests:

- Operation can configure USDT payment.
- Non-operation cannot configure USDT payment.
- Inactive USDT config rejects USDT minting.

#### `withdraw_usdt(amount)`

Behavior:

- Requires `Admin`.
- Transfers USDT from treasury token account to configured treasury destination.

Tests:

- Admin can withdraw.
- Non-admin cannot withdraw.
- Cannot withdraw more than USDT treasury balance.

### Ticket Minting

Common mint rules:

- Series must not be refunded.
- Quantity must be greater than zero.
- Quantity cannot exceed `remaining_ticket_numbers`.
- Prize table must be finalized.
- Mint lock rule:
  - if `now <= mint_lock_until` and `mint_lock_owner != signer`, reject
  - otherwise allow mint
  - after successful mint, set `mint_lock_owner = signer` and `mint_lock_until = now + 600`
- Mint each ticket as formal Metaplex `NonFungible`.
- Ticket metadata URI starts as `series.unreveal_token_uri`.
- Create `TicketStatus` and `SeriesTicket` for every minted NFT.
- Decrement `remaining_ticket_numbers`.
- If `Series.reveal_mode == ImmediateOnMint`, automatically create a reveal request for the newly minted tickets after mint succeeds.
- If `Series.reveal_mode == UserTriggered`, do not create a reveal request; the user calls `request_reveal` later.
- `ImmediateOnMint` does not require goods arrived for reveal assignment; goods arrival still controls physical prize exchange readiness.

#### `mint_ticket_by_doudo_points(series_id, quantity)`

Behavior:

- User pays by burning non-transferable DOUDO points.
- Required amount is `series.price_in_usdt_base_units * quantity`, using the same 18-decimal base-unit convention as DOUDO points.
- The points are burned from the user's Token-2022 account through the program.
- No points are transferred to another wallet.

Tests:

- User can mint with enough DOUDO points.
- Insufficient DOUDO points fails.
- Direct point transfer remains impossible.
- Refunded series fails.
- Remaining quantity decreases.
- TicketStatus and SeriesTicket are created.
- Mint lock owner and expiry are set.
- Immediate reveal mode creates a reveal request during mint.
- User-triggered reveal mode does not create a reveal request during mint.

#### `mint_ticket_by_usdt(series_id, quantity)`

Behavior:

- User pays configured USDT SPL token.
- Required amount is `series.price_in_usdt_base_units * quantity`, adjusted to the configured USDT mint decimals.
- Transfers USDT into the configured treasury token account.

Tests:

- User can mint with enough USDT.
- Insufficient USDT balance fails.
- Missing user token account fails.
- Inactive USDT config fails.
- Remaining quantity decreases.
- Immediate reveal mode creates a reveal request during mint.

#### `admin_mint_ticket(to, series_id, quantity)`

Behavior:

- Requires `AdminMint`.
- No payment.
- Applies remaining quantity checks.
- Applies mint lock to the `to` address because the user receives the reserved mint window.

Tests:

- AdminMint role can mint.
- Non-adminMint cannot mint.
- Remaining quantity decreases.
- Mint lock owner is `to`.

### Reveal

#### `request_reveal(series_id, ticket_mints)`

Behavior:

- Requires `Series.reveal_mode == UserTriggered`.
- Requires goods arrived.
- Rejects refunded series.
- Verifies every ticket is owned by signer.
- Verifies every ticket belongs to the series.
- Verifies no ticket is already revealed.
- Creates `RandomnessRequest` and request item PDAs.
- In production, commits/request randomness through Switchboard adapter.
- In tests, prepares request for mock fulfillment.

Tests:

- Immediate-on-mint series rejects manual reveal requests.
- Goods-not-arrived reveal fails.
- Refunded reveal fails.
- Non-owner reveal fails.
- Wrong-series ticket fails.
- Already revealed ticket fails.
- Valid request creates request accounts.

#### `fulfill_reveal(request_id, random_words)`

Behavior:

- Requires valid randomness provider:
  - production: Switchboard account proof/authority
  - test: configured mock authority
- For each ticket:
  - calculate total remaining prize quantity
  - choose prize by `random_word % total_remaining`
  - decrement selected `SubPrize.remaining_quantity`
  - increment selected `SubPrize.revealed_quantity`
  - mark `TicketStatus.token_revealed = true`
  - set `TicketStatus.token_revealed_prize`
  - update NFT metadata URI to `series.reveal_token_uri + prize_id`
- Marks request fulfilled.

Tests:

- Mock random words deterministically assign prizes.
- Prize remaining quantities decrease correctly.
- Ticket status is revealed.
- Duplicate fulfill fails.
- Random word count mismatch fails.

### Last Prize

#### `choose_last_prize_winner(series_id, quantity)`

Behavior:

- Requires `Operation`.
- Requires `remaining_ticket_numbers == 0`.
- Requires last prize not already chosen.
- Rejects refunded series.
- If `is_pre_order == false`:
  - use the last minted ticket index `tickets_minted - 1`
  - verify current owner from the NFT token account passed by caller
  - mint last prize NFT to that owner
  - mark `token_revealed_prize = 999`
  - mark `token_revealed = true`
  - create `LastPrizeOwner`
- If `is_pre_order == true`:
  - create randomness request for `quantity`

Tests:

- Non-operation cannot choose.
- Not sold out fails.
- Already chosen fails.
- Non-preorder awards owner of last minted ticket.
- Last prize NFT has revealed prize 999.

#### `fulfill_last_prize(request_id, random_words)`

Behavior:

- Requires valid randomness provider.
- For each random word:
  - select random ticket index.
  - verify current owner from passed NFT token account.
  - mint last prize NFT to owner.
  - create `LastPrizeOwner`.
- Marks series last prize chosen.

Tests:

- Mock random word selects expected winner.
- Multiple winners supported by quantity.
- Duplicate fulfill fails.

### Exchange

#### `exchange_prize(ticket_mints)`

Behavior:

- Requires goods arrived so physical prize exchange cannot begin before operations marks the goods ready, even for `ImmediateOnMint` series where reveal assignment may happen earlier.
- For each ticket:
  - verify signer owns ticket NFT.
  - require revealed.
  - require not already exchanged.
  - set `token_exchange = true`.
  - update NFT metadata URI to `series.exchange_token_uri + prize_id`.

Tests:

- Non-owner fails.
- Unrevealed ticket fails.
- Already exchanged ticket fails.
- Successful exchange changes status and metadata URI.

### Voucher and Membership

#### `initialize_default_membership_levels()`

Behavior:

- Requires `Admin`.
- Creates default levels equivalent to Solidity constructor:
  - `NonMembership`, threshold `0`, reward `0`
  - `Common`, threshold `1`, reward `0`
  - `Silver`, threshold `15000 * 10^decimals`, reward `100`
  - `Gold`, threshold `80000 * 10^decimals`, reward `150`
  - `Platinum`, threshold `150000 * 10^decimals`, reward `300`

Tests:

- Default levels match expected thresholds and rewards.
- Cannot initialize twice.

#### `create_voucher_type(amount, max_per_user, token_uri)`

Behavior:

- Requires `Admin`.
- Creates `VoucherType`.

Tests:

- Admin can create.
- Non-admin cannot create.
- Counter increments.

#### `update_voucher_type(voucher_type_id, amount, max_per_user, token_uri)`

Behavior:

- Requires `Admin`.
- Updates voucher type.

Tests:

- Admin can update.
- Non-admin cannot update.

#### `mint_vouchers(to, voucher_type_ids, quantities)`

Behavior:

- Requires `Minter`.
- Lengths must match.
- Each voucher type must exist and be active.
- Enforces `UserVoucherCount + quantity <= max_per_user`.
- Mints each voucher as formal Metaplex NFT.
- Creates `VoucherStatus`.
- Updates `UserVoucherCount`.

Tests:

- Minter can mint multiple voucher types.
- Mismatched arrays fail.
- Invalid voucher type fails.
- Exceeding max per user fails.
- Non-minter fails.

#### `mint_membership_nft(to, membership_level)`

Behavior:

- Requires `Minter`.
- User must not already own active membership.
- Membership level must exist.
- Sets user totals to level threshold.
- Mints membership NFT as formal Metaplex NFT.
- Creates `MembershipStatus`.

Tests:

- Minter can mint membership.
- Duplicate membership fails.
- Invalid level fails.
- Non-minter fails.

#### `burn_vouchers_batch(token_mints)`

Behavior:

- Checks membership expiration.
- Verifies signer owns every voucher NFT.
- Rejects membership NFTs.
- Burns voucher NFTs.
- Sums voucher amounts.
- Adds membership bonus basis points.
- Mints non-transferable DOUDO points to user.
- Updates `UserInfo.total_redeemed`, `current_round_redeemed`, and `last_active_timestamp`.
- Calls membership level update.

Tests:

- Burns vouchers and mints DOUDO points.
- Additional membership reward is applied.
- Non-owner voucher fails.
- Membership NFT burn through voucher path fails.
- User upgrades when threshold is reached.

#### `set_membership_expiration_period(new_period)`

Behavior:

- Requires `Admin`.
- Updates global expiration period in `Config` or a dedicated membership config account.

Tests:

- Admin can set period.
- Non-admin cannot set period.

#### `add_membership_level(name, threshold, uri, reward_basis_points)`

Behavior:

- Requires `Admin`.
- Creates a new `MembershipLevel`.

Tests:

- Admin can add level.
- Non-admin cannot add level.

#### `update_membership_level(level_index, threshold, uri, reward_basis_points)`

Behavior:

- Requires `Admin`.
- Updates threshold, URI, and reward basis points.

Tests:

- Admin can update all mutable fields.
- Invalid level fails.

#### `sync_membership_transfer(from, to, membership_mint)`

Behavior:

- Membership NFTs are standard transferable Metaplex `NonFungible` NFTs. This is the common high-support path for Solana wallet and marketplace compatibility.
- Because standard `NonFungible` NFTs can be transferred outside this program, the program cannot automatically intercept every wallet transfer. Membership benefits are based on `UserInfo`, and membership state must be synchronized through this instruction before the recipient receives membership benefits.
- Verifies current NFT owner is `to`.
- Moves membership state from `from` to `to`.
- If `to` already has a lower-level membership, burns or deactivates the lower-level membership according to the Solidity behavior.
- Resets sender membership state.
- Updates recipient totals and level.

Tests:

- Sync transfers membership state after NFT transfer.
- Higher-level membership replaces lower-level membership.
- Lower-level incoming membership is burned/deactivated.
- Invalid owner fails.

Open design note:

- A stricter future version can use Programmable NFT transfer rules for membership NFTs so transfers must pass through program logic. This spec intentionally does not use pNFT transfer restrictions in the first version because the product requirement is transferable membership NFTs and standard `NonFungible` support is broader.

## Event Design

Anchor events should mirror the Solidity event surface:

- `NewSeries`
- `UpdateSeriesInformation`
- `RefundSeries`
- `UpdateSeriesLastPrizeOwner`
- `UpdateSeriesRemainingTicketNumbers`
- `NewSubPrize`
- `ResetSubPrize`
- `UpdatePrize`
- `NewTicketStatus`
- `UpdateTicketStatus`
- `LastPrizeDraw`
- `LastPrizeWinner`
- `RevealDrawSent`
- `RevealDrawFulfilled`
- `CurrencyTokenAdded`
- `VoucherTypeCreated`
- `VoucherTypeUpdated`
- `VoucherMinted`
- `VoucherTotalRedeemed`
- `VoucherTransferredSynced`
- `MembershipLevelCreated`
- `MembershipLevelUpdated`
- `MembershipUpgraded`
- `MembershipNFTBurned`
- `MembershipExpired`
- `MembershipTransferredSynced`
- `VouchersIssuedFromSubscription`
- `DoudoPointsMinted`
- `DoudoPointsRedeemed`
- `MintLockUpdated`

Events should include public keys instead of EVM addresses and should include deterministic IDs for indexers.

## Error Design

Errors should cover the Solidity custom errors plus Solana-specific account and provider failures:

- `GoodsAlreadyArrived`
- `GoodsNotArrived`
- `SeriesIsRefund`
- `AlreadyRefund`
- `NotEnoughNftsRemaining`
- `NotSoldOutYet`
- `AlreadyChoseWinner`
- `SubPrizeQuantityNotEqual`
- `InsufficientDoudoPoints`
- `InsufficientUsdtBalance`
- `NotEnoughTokensToReveal`
- `NotTheTokenOwner`
- `TokenAlreadyExchanged`
- `TokenAlreadyRevealed`
- `TokenNotRevealed`
- `TokenNotInTheSeries`
- `TokenDoesNotExist`
- `Unauthorized`
- `InvalidRole`
- `InvalidSeries`
- `InvalidSubPrize`
- `InvalidCurrency`
- `InvalidRandomnessProvider`
- `RandomnessAlreadyFulfilled`
- `RandomnessWordCountMismatch`
- `MintLockedByAnotherWallet`
- `PrizeAccountingInvalid`
- `InvalidRevealMode`
- `UriTooLong`
- `NameTooLong`
- `InvalidVoucherType`
- `ExceedsMaxVouchersPerUser`
- `CannotBurnMembershipAsVoucher`
- `UserAlreadyOwnsMembership`
- `InvalidMembershipLevel`
- `MembershipTransferNotSynced`
- `NonTransferablePointsRequired`

## Test Matrix

### Project Setup Tests

- `initialize_config` creates config and admin role.
- Duplicate config initialization fails.
- Role grant/revoke behavior matches AccessControl intent.

### DOUDO Points Tests

- Admin creates Token-2022 non-transferable DOUDO point mint.
- DOUDO points mint uses 18 decimals.
- Minter mints points to a user.
- Non-minter cannot mint points.
- User-to-user transfer fails at Token-2022 program level.
- User can redeem/burn points through program.
- User cannot redeem more points than balance.

### Series Tests

- Operation role creates a series with correct fields.
- Non-operation signer cannot create a series.
- Series counter increments.
- Operation role updates series before goods arrived.
- Operation role updates series after goods arrived.
- Operation role updates series after refund.
- Create series supports `UserTriggered` reveal mode.
- Create series supports `ImmediateOnMint` reveal mode.
- Operation role marks goods arrived.
- Goods arrived cannot be called twice.
- Refunded series cannot be marked arrived.
- Series can be refunded before goods arrived.
- Goods-arrived series cannot be refunded.

### Sub-Prize Tests

- Operation creates sub-prize accounts.
- Prize table finalization passes when total equals ticket total.
- Prize table finalization fails when total mismatches.
- Operation updates sub-prize before goods arrived.
- Operation updates sub-prize after goods arrived.
- Update after reveal fails if accounting would become invalid.
- Revealed quantities cannot be erased by reset.

### Payment Tests

- Operation configures USDT payment.
- Non-operation cannot configure USDT payment.
- User mints ticket by DOUDO points with enough balance.
- User mint by DOUDO points fails with insufficient balance.
- User mints ticket by USDT with enough balance.
- User mint by USDT fails with insufficient token balance.
- Inactive or missing USDT config fails.
- Admin withdraws USDT.
- Non-admin withdraw USDT fails.

### Mint Lock Tests

- First successful mint sets `mint_lock_owner` and `mint_lock_until`.
- Same wallet can mint again within 10 minutes.
- Different wallet cannot mint while lock is active.
- After clock advances beyond 600 seconds, different wallet can mint.
- New successful wallet becomes new lock owner.
- Admin mint sets lock owner to recipient.

### Ticket NFT Tests

- Minted ticket is a formal Metaplex NFT.
- Ticket NFT can transfer before reveal.
- Ticket NFT can transfer after reveal.
- Ticket NFT can transfer after exchange.
- Ticket metadata starts at unrevealed URI.
- TicketStatus is created with unrevealed and unexchanged status.
- SeriesTicket maps series index to mint.
- Remaining ticket count decreases.
- Mint fails if quantity exceeds remaining tickets.
- Mint fails for refunded series.

### Reveal Tests

- Immediate-on-mint series creates reveal request during DOUDO points mint.
- Immediate-on-mint series creates reveal request during USDT mint.
- Immediate-on-mint series can assign reveal before goods arrived.
- Immediate-on-mint series rejects manual reveal request.
- User-triggered series does not create reveal request during mint.
- Reveal request fails before goods arrived.
- Reveal request fails for refunded series.
- Reveal request fails when signer does not own a ticket.
- Reveal request fails for wrong series ticket.
- Reveal request fails for already revealed ticket.
- Valid reveal request creates request and request item accounts.
- Mock fulfill assigns expected prize for deterministic random words.
- Fulfill decrements sub-prize remaining quantity.
- Fulfill increments sub-prize revealed quantity.
- Fulfill updates ticket revealed status and prize id.
- Fulfill updates NFT metadata to reveal URI plus prize id.
- Duplicate fulfill fails.
- Random word count mismatch fails.

### Last Prize Tests

- Non-operation cannot choose last prize.
- Choosing last prize before sell-out fails.
- Choosing last prize twice fails.
- Non-preorder series awards owner of last minted ticket.
- Non-preorder last prize NFT is revealed with prize id `999`.
- Preorder series creates randomness request.
- Mock preorder fulfill selects expected winner.
- Multiple preorder winners are supported.

### Exchange Tests

- Exchange fails before goods arrived, including immediate-on-mint revealed tickets.
- Exchange fails for non-owner.
- Exchange fails for unrevealed ticket.
- Exchange fails for already exchanged ticket.
- Successful exchange sets `token_exchange = true`.
- Successful exchange updates NFT metadata to exchange URI plus prize id.

### Voucher Tests

- Admin creates voucher type.
- Admin updates voucher type.
- Non-admin cannot create or update voucher type.
- Minter mints one or more voucher NFTs.
- Non-minter cannot mint vouchers.
- Mismatched voucher type and quantity arrays fail.
- Invalid voucher type fails.
- Exceeding max per user fails.
- Voucher status maps voucher mint to voucher type.

### Membership Tests

- Admin initializes default membership levels.
- Admin adds membership level.
- Admin updates threshold, URI, and reward basis points.
- Non-admin cannot modify membership levels.
- Minter mints membership NFT.
- Duplicate membership mint fails.
- Invalid membership level fails.
- Membership expiration burns/deactivates expired membership.
- Membership state sync after NFT transfer updates recipient.
- Membership NFT can transfer as a standard Metaplex NFT.
- Higher-level received membership replaces lower-level existing membership.
- Lower-level received membership is burned/deactivated according to current Solidity behavior.

### Voucher Redemption and Reward Tests

- User burns vouchers and receives non-transferable DOUDO points.
- Voucher amount sum is correct.
- Membership reward basis points are applied.
- User totals and current round redeemed update.
- Last active timestamp updates.
- User upgrades membership after reaching threshold.
- Burning membership NFT through voucher path fails.
- Non-owner voucher burn fails.

## Implementation Notes

- Start with Anchor 0.31.x unless the local toolchain requires a newer compatible version.
- Use TypeScript tests with `anchor-bankrun` or `solana-test-validator`. The implementation plan should pick one and keep the test environment deterministic.
- Mock randomness must be available only when `Config.randomness_mode == Mock`.
- Production deployments must not initialize mock randomness authority.
- Keep all dynamically sized strings bounded.
- Avoid unbounded vectors in account data; use indexed PDA accounts.
- Use checked arithmetic for price, quantity, and reward calculations.
- Store point amounts in base units. DOUDO points use 18 decimals for continuity with the current EVM contracts.
- Formal NFT creation should set update authority to the program authority PDA so reveal/exchange metadata updates remain enforceable.
- For DOUDO points, do not implement wallet-to-wallet transfer helper instructions.
- For compliance posture, user-facing names and metadata should say `points`, `rewards`, or `credits`, not `coin`, `token investment`, or similar market language.
- Ticket and membership NFTs use standard Metaplex `NonFungible` tokens and remain freely transferable in unrevealed, revealed, exchanged, and membership states.
- The first release does not include SOL ticket payment. Supported ticket payment methods are DOUDO point burn and USDT SPL transfer.
- Refunded series still allows metadata and series information edits for operational flexibility.

## Resolved Implementation Decisions

1. DOUDO points use 18 decimals.
2. Membership NFTs use standard transferable Metaplex `NonFungible`; membership benefits require ownership verification and state synchronization.
3. Ticket NFTs are freely transferable in all states: unrevealed, revealed, and exchanged.
4. Ticket payment methods are DOUDO points and USDT. SOL payment is removed from the first Solana design.
5. Refunded series remain editable for metadata and display corrections.

## Acceptance Criteria

- The spec maps every externally meaningful behavior from the three Solidity contracts to Solana accounts, instructions, and tests.
- DOUDO is redesigned as Token-2022 non-transferable points.
- DOUDOCHAIN includes the new 10-minute mint lock.
- DOUDOCHAIN allows post-goods-arrival series and metadata edits.
- DOUDOCHAIN allows post-refund series and metadata edits.
- DOUDOCHAIN supports both immediate-on-mint reveal and user-triggered reveal series modes.
- DOUDOCHAIN post-arrival sub-prize edits are allowed without invalidating already revealed prize accounting.
- Ticket, last prize, voucher, and membership assets are formal Metaplex NFTs.
- Ticket and membership NFTs are transferable standard `NonFungible` assets.
- Production randomness uses Switchboard; tests use deterministic mock randomness.
- Tests are planned before implementation and cover both success paths and Solidity-equivalent failure paths.
