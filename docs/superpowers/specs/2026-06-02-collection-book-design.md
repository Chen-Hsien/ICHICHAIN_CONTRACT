# Collection Book — Design

## Status

Draft for review. Part of the **DOUDOCHAIN V2 (Arbitrum) redesign**. Sibling specs: DOUDOCOIN Soulbound Points · DOUDOCHAIN V2 Core · DOUDO Points Economy.

A **separate contract** (not part of DOUDOCHAIN V2), inspired by Hunter × Hunter's Greed Island card book: users place specific prize NFTs into a book; completing the required set unlocks a reward.

## Context

Strong retention/sink mechanic: it drives users to chase *specific* prizes, creates secondary-market demand for missing pieces, and absorbs duplicate prize NFTs. Kept separate to avoid bloating the core lottery contract, to allow **cross-series** (and future cross-contract) books, and to isolate escrow/reward logic.

## Decisions Locked

- **Separate contract.**
- **Lock (escrow) deposited NFTs into the book contract** (not burn) — enables progress display and avoids ERC721A burn costs on this path.
- **Cross-series** (and cross-contract-capable) slots.
- **Rewards**: special prize NFT, and/or DOUDO points, and/or unlocking a hidden series — composable.
- **Emit rich events** for The Graph so the frontend can render books, progress, and claims.

## Goals

- Define books as sets of required prize slots spanning one or more series.
- Let users deposit (lock) matching prize NFTs, tracked as progress.
- Let users claim a configurable reward once a book is complete, with no double-claim.

## Architecture

- Contract `CollectionBook` is `AccessControl`, `ReentrancyGuard`, `IERC721Receiver`.
- Holds escrowed ERC721A tokens (implements `onERC721Received`).
- Reads prize identity from DOUDOCHAIN V2 via an interface (`ticketStatusDetail(tokenId)` → seriesID, revealedPrize).
- For point rewards: holds `MINTER_ROLE` on DOUDOCOIN. For "unlock hidden series": holds a mint/enable role on DOUDOCHAIN V2 (e.g., `ADMINMINT_ROLE`) or calls a dedicated `unlockSeriesFor(user, seriesID)`.

## Data Model

```
struct Slot { address sourceContract; uint256 seriesID; uint256 prizeId; uint32 quantity; }
enum RewardKind { NftPrize, Points, UnlockSeries }
struct Book {
    string name;
    Slot[] slots;
    RewardKind rewardKind;
    uint256 rewardData;     // points amount, or seriesID to unlock, or special prize id
    bool active;
}
mapping(uint256 => Book) public books;                 // bookId → Book
mapping(address => mapping(uint256 => uint32)) public filledCount;     // user → bookId → slots filled
mapping(address => mapping(uint256 => mapping(uint256 => uint32))) filledPerSlot; // user→book→slotIndex→count
mapping(address => mapping(uint256 => bool)) public claimed;           // user → bookId → claimed
mapping(uint256 => uint256) public depositedToken;     // tokenId → bookId (escrow registry)
```

## Flows

### Operator: create / manage books (`OPERATION_ROLE`)
- `createBook(name, slots, rewardKind, rewardData)` → emits `BookCreated(bookId, name, rewardKind, rewardData)` and `BookSlotDefined(bookId, slotIndex, sourceContract, seriesID, prizeId, quantity)`.
- `setBookActive(bookId, bool)`.

### User: deposit (lock) prizes
- `depositToBook(uint256 bookId, uint256[] calldata tokenIds)` (`nonReentrant`):
  - Book active, not yet `claimed`.
  - For each token: caller owns it; it is revealed + unexchanged in its source contract; it matches an unfilled slot (by `seriesID` + `prizeId`); `safeTransferFrom(user, this, tokenId)` to escrow; record `depositedToken[tokenId] = bookId`, increment `filledPerSlot`/`filledCount`.
  - Emit `SlotFilled(user, bookId, slotIndex, tokenId, newFilledCount)`.

### User: claim reward
- `claimBook(uint256 bookId)` (`nonReentrant`):
  - Require `filledCount == totalRequired` and `!claimed`; set `claimed = true` (before external calls).
  - Dispatch reward: `Points` → `DOUDOCOIN.mint(user, rewardData)`; `NftPrize` → mint special NFT; `UnlockSeries` → enable/mint on DOUDOCHAIN V2.
  - Escrowed NFTs stay locked in the book (collected). Emit `BookClaimed(user, bookId, rewardKind, rewardData)`.

### Optional: withdraw before claim
- `withdrawDeposited(bookId, tokenIds)` to return locked NFTs while a book is incomplete (if we allow disassembly). Decreases progress; emits `SlotEmptied`. (Default: allowed before claim; forbidden after.)

## The Graph / Indexing

Events: `BookCreated`, `BookSlotDefined`, `SlotFilled`, `SlotEmptied`, `BookClaimed`. These let the frontend render: book definitions, each user's progress per slot, completion %, and claim history — without a DB.

## Anti-Double-Claim & Safety

- `claimed[user][bookId]` flag set before reward dispatch; reward functions are idempotent per book per user.
- Escrow means the contract owns deposited NFTs; a user cannot re-deposit tokens they no longer hold.
- A token can be escrowed in only one book at a time (`depositedToken` registry).
- ReentrancyGuard on deposit/claim/withdraw.

## Testing Strategy

- Deposit matching/non-matching prizes (wrong series/prize rejected; unrevealed/exchanged rejected; non-owner rejected).
- Progress tracking across multiple slots and cross-series books.
- Claim only when complete; double-claim reverts; reward dispatch for each `RewardKind`.
- Withdraw-before-claim returns NFTs and decrements progress; withdraw-after-claim forbidden.
- Indexing events emitted with correct args.

## Deployment & Migration Notes

- Deploy after DOUDOCHAIN V2 + DOUDOCOIN. Grant this contract `MINTER_ROLE` on DOUDOCOIN (for point rewards) and the chosen role on DOUDOCHAIN V2 (for NFT/series-unlock rewards).

## Open Questions

1. Special-prize NFT rewards: mint from DOUDOCHAIN V2 (one collection) or from a dedicated rewards NFT contract? (Default: DOUDOCHAIN V2 via granted role, to keep one collection.)
2. Allow disassembly (`withdrawDeposited`) before claim? (Default: yes, for user comfort.)
3. Should some books **burn** instead of lock for a "permanent" prestige variant? (Default: lock only for now; burn variant later.)
4. Per-book deadlines / seasons?
