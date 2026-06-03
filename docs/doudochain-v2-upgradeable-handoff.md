# DOUDOCHAIN V2 Upgradeable Handoff

Last updated: 2026-06-03

This document describes the implemented and deployed Arbitrum Sepolia contracts, ABI locations, frontend/backend integration notes, and business-function coverage.

## Network

| Item | Value |
| --- | --- |
| Network | Arbitrum Sepolia |
| Chain ID | `421614` |
| Official ops / deployer wallet | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| Block explorer | `https://sepolia.arbiscan.io` |

## Current Split-Module Deployment

This is the current full V2 business-spec deployment. Use these addresses for new frontend, backend, and subgraph integration.

Deployment mode: **new deploy**, not upgrade of the previous partial Core proxy.

| Contract | App address | Implementation | Verification |
| --- | --- | --- | --- |
| `DOUDOCOIN` | `0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E` | Non-proxy | Verified |
| `DoudoVRFRouter` | `0x9C81E6af84243a8bd7a2C7EdD4Ee77d12405Fb75` | Non-proxy | Verified |
| `DOUDOCHAINV2CoreUpgradeable` | `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` | `0xF0C1d82bbB463Eec35Fc0109e1ec7cFdAC681150` | Verified and proxy-linked |
| `DoudoBundleModuleUpgradeable` | `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` | `0xcaF407e22958bA800aECb184FAa306873ee88527` | Verified and proxy-linked |
| `DoudoRefundModuleUpgradeable` | `0x8ee19238DAa466B7792BE33569c6E4f6993CCf20` | `0x7c9100e67022d49aBf351B714aB22EfCC7D91d0E` | Verified and proxy-linked |
| `DoudoRedrawModuleUpgradeable` | `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` | `0x181b336Ab930A25e73d08b21730D19e7950B535D` | Verified and proxy-linked |
| `DoudoCollectionRewardModuleUpgradeable` | `0x680618a6933DD68fF84Ff9F64760120d27400B3C` | `0x2cE5a89cBA7F79a6de97E6d798522f66310a6d83` | Verified and proxy-linked |
| `CollectionBookUpgradeable` | `0x4284be399cA9591fBd98248969fCcb969E21B2C6` | `0x8084993A227F9dc060407F568B95c5201b55259f` | Verified and proxy-linked |

Explorer links:

- DOUDOCOIN: `https://sepolia.arbiscan.io/address/0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E#code`
- DoudoVRFRouter: `https://sepolia.arbiscan.io/address/0x9C81E6af84243a8bd7a2C7EdD4Ee77d12405Fb75#code`
- Core proxy: `https://sepolia.arbiscan.io/address/0xf75395A8cd753f47135cfcaE00D2706252c3E0F5#code`
- Core implementation: `https://sepolia.arbiscan.io/address/0xF0C1d82bbB463Eec35Fc0109e1ec7cFdAC681150#code`
- Bundle proxy: `https://sepolia.arbiscan.io/address/0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6#code`
- Refund proxy: `https://sepolia.arbiscan.io/address/0x8ee19238DAa466B7792BE33569c6E4f6993CCf20#code`
- Redraw proxy: `https://sepolia.arbiscan.io/address/0xE75461828f41C890fbc811e7cABFe2143B3F4afE#code`
- Collection reward proxy: `https://sepolia.arbiscan.io/address/0x680618a6933DD68fF84Ff9F64760120d27400B3C#code`
- CollectionBook proxy: `https://sepolia.arbiscan.io/address/0x4284be399cA9591fBd98248969fCcb969E21B2C6#code`

## Current ABI Paths

Use implementation ABIs for proxy calls.

| Contract | ABI JSON path |
| --- | --- |
| `DOUDOCOIN` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/DDOUDOCOIN.sol/DOUDOCOIN.json` |
| `DoudoVRFRouter` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/DoudoVRFRouter.sol/DoudoVRFRouter.json` |
| `DOUDOCHAINV2CoreUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/DOUDOCHAINV2CoreUpgradeable.sol/DOUDOCHAINV2CoreUpgradeable.json` |
| `DoudoBundleModuleUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/modules/DoudoBundleModuleUpgradeable.sol/DoudoBundleModuleUpgradeable.json` |
| `DoudoRefundModuleUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/modules/DoudoRefundModuleUpgradeable.sol/DoudoRefundModuleUpgradeable.json` |
| `DoudoRedrawModuleUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/modules/DoudoRedrawModuleUpgradeable.sol/DoudoRedrawModuleUpgradeable.json` |
| `DoudoCollectionRewardModuleUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol/DoudoCollectionRewardModuleUpgradeable.json` |
| `CollectionBookUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/CollectionBookUpgradeable.sol/CollectionBookUpgradeable.json` |

## Current Chainlink VRF Config

Configured on `DoudoVRFRouter`.

| Field | Value |
| --- | --- |
| VRF consumer | `0x9C81E6af84243a8bd7a2C7EdD4Ee77d12405Fb75` |
| VRF coordinator | `0x5CE8D5A2BC84beb22a398CCA51996F7930313D61` |
| Key hash | `0x1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be` |
| Subscription ID | `106016056432422253373974444299096295296684744368940754254159766683809634643463` |
| Request confirmations | `0` |
| Callback gas limit | `2500000` |
| Native payment | `false`, LINK subscription payment |
| Consumer add tx | `0xfdca4bd21c82a27f43d422a9a3e9ec2d9434bc31153cfd76fd33a388b62ae29c` |

VRF behavior:

- Core reveal and last-prize requests go through `DoudoVRFRouter`.
- Redraw requests go through `DoudoRedrawModuleUpgradeable -> DoudoVRFRouter`.
- `DoudoVRFRouter` inherits Chainlink `VRFConsumerBaseV2Plus`, so `rawFulfillRandomWords` uses Chainlink's official coordinator-only guard.
- Prize settlement still occurs inside the same Chainlink fulfill transaction.
- Chainlink dashboard consumer must be the Router address, not the Core proxy address.

## Current Subgraph Data Sources

Index these data sources for the split deployment:

| Data source | Address | Purpose |
| --- | --- | --- |
| Core | `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` | Series, sub-prizes, tickets, reveal, last prize, canonical ticket/prize events |
| VRF Router | `0x9C81E6af84243a8bd7a2C7EdD4Ee77d12405Fb75` | VRF config, request target, fulfillment status |
| Bundle Module | `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` | Bundle config and bundle mint history |
| Refund Module | `0x8ee19238DAa466B7792BE33569c6E4f6993CCf20` | Refund config and claims |
| Redraw Module | `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` | Redraw config, requests, fulfillment, consolation credits |
| Collection Reward Module | `0x680618a6933DD68fF84Ff9F64760120d27400B3C` | Collection reward config and reward mint/unlock events |
| CollectionBook | `0x4284be399cA9591fBd98248969fCcb969E21B2C6` | Collection book definitions, deposits, withdrawals, claims |

Core still emits canonical `NewSeries`, `NewSubPrize`, `NewTicketStatus`, `RevealDrawSent`, `RevealDrawFulfilled`, `UpdatePrize`, `UpdateTicketStatus`, `UpdateSeriesInformation`, `UpdateSeriesRemainingTicketNumbers`, `LastPrizeDraw`, `LastPrizeWinner`, `UpdateSeriesLastPrizeOwner`, and `AdminMinted`.

## Current Role Wiring

| Contract | Permission | Holder |
| --- | --- | --- |
| `DOUDOCOIN` | `BURNER_ROLE` | Core proxy `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` |
| `DOUDOCOIN` | `BURNER_ROLE` | Bundle proxy `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` |
| `DOUDOCOIN` | `MINTER_ROLE` | Bundle proxy `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` |
| `DOUDOCOIN` | `MINTER_ROLE` | Refund proxy `0x8ee19238DAa466B7792BE33569c6E4f6993CCf20` |
| `DOUDOCOIN` | `MINTER_ROLE` | Collection reward proxy `0x680618a6933DD68fF84Ff9F64760120d27400B3C` |
| `DOUDOCOIN` | `MINTER_ROLE` | CollectionBook proxy `0x4284be399cA9591fBd98248969fCcb969E21B2C6` |
| Core | `MODULE_ROLE` | Bundle, Refund, Redraw, CollectionReward proxies |
| Core | `VRF_ROUTER_ROLE` | Router `0x9C81E6af84243a8bd7a2C7EdD4Ee77d12405Fb75` |
| Router | requester | Core proxy `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` |
| Router | requester | Redraw proxy `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` |
| Bundle | redraw module | `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` |
| Redraw | bundle module | `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` |
| CollectionReward | collection book | `0x4284be399cA9591fBd98248969fCcb969E21B2C6` |
| CollectionBook | reward target | `0x680618a6933DD68fF84Ff9F64760120d27400B3C` |

## Previous Partial Deployment (Reveal-Speed Test Only)

Use proxy addresses for application calls and subgraph data sources. Use implementation addresses only for verification and upgrade records.

| Contract | App address | Implementation | Verification |
| --- | --- | --- | --- |
| `DOUDOCOIN` | `0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E` | Non-proxy | Verified |
| `DOUDOCHAINV2Upgradeable` | `0xb2E6A782CDaBB0178216BBB57B782b448B21cAf2` | `0xb4e37600904A2D9B0B71D08F8e655Df30D41FEC2` | Verified and proxy-linked |
| `CollectionBookUpgradeable` | `0x9C4a0e04e10a36bad4b9EcbdEF2d2447afe8f131` | `0xFcAf805DDffc9D084C0a11b88A6F40dF5e603B43` | Verified and proxy-linked |

Explorer links:

- DOUDOCOIN: `https://sepolia.arbiscan.io/address/0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E#code`
- DOUDOCHAIN proxy: `https://sepolia.arbiscan.io/address/0xb2E6A782CDaBB0178216BBB57B782b448B21cAf2#code`
- DOUDOCHAIN implementation: `https://sepolia.arbiscan.io/address/0xb4e37600904A2D9B0B71D08F8e655Df30D41FEC2#code`
- CollectionBook proxy: `https://sepolia.arbiscan.io/address/0x9C4a0e04e10a36bad4b9EcbdEF2d2447afe8f131#code`
- CollectionBook implementation: `https://sepolia.arbiscan.io/address/0xFcAf805DDffc9D084C0a11b88A6F40dF5e603B43#code`

## ABI And Type Paths

Use the implementation ABI for proxy calls.

| Contract | ABI JSON path | TypeChain type | TypeChain factory |
| --- | --- | --- | --- |
| `DOUDOCOIN` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/DDOUDOCOIN.sol/DOUDOCOIN.json` | `/Users/angustsai/ICHICHAIN_CONTRACT/typechain-types/contracts/DDOUDOCOIN.sol/DOUDOCOIN.ts` | `/Users/angustsai/ICHICHAIN_CONTRACT/typechain-types/factories/contracts/DDOUDOCOIN.sol/DOUDOCOIN__factory.ts` |
| `DOUDOCHAINV2Upgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/DOUDOCHAINV2Upgradeable.sol/DOUDOCHAINV2Upgradeable.json` | `/Users/angustsai/ICHICHAIN_CONTRACT/typechain-types/contracts/DOUDOCHAINV2Upgradeable.ts` | `/Users/angustsai/ICHICHAIN_CONTRACT/typechain-types/factories/contracts/DOUDOCHAINV2Upgradeable__factory.ts` |
| `CollectionBookUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/CollectionBookUpgradeable.sol/CollectionBookUpgradeable.json` | `/Users/angustsai/ICHICHAIN_CONTRACT/typechain-types/contracts/CollectionBookUpgradeable.sol/CollectionBookUpgradeable.ts` | `/Users/angustsai/ICHICHAIN_CONTRACT/typechain-types/factories/contracts/CollectionBookUpgradeable.sol/CollectionBookUpgradeable__factory.ts` |

Source files:

- `/Users/angustsai/ICHICHAIN_CONTRACT/contracts/DDOUDOCOIN.sol`
- `/Users/angustsai/ICHICHAIN_CONTRACT/contracts/DOUDOCHAINV2Upgradeable.sol`
- `/Users/angustsai/ICHICHAIN_CONTRACT/contracts/CollectionBookUpgradeable.sol`

## Chainlink VRF Config

Configured on `DOUDOCHAINV2Upgradeable`.

| Field | Value |
| --- | --- |
| VRF coordinator | `0x5CE8D5A2BC84beb22a398CCA51996F7930313D61` |
| Key hash | `0x1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be` |
| Subscription ID | `106016056432422253373974444299096295296684744368940754254159766683809634643463` |
| Request confirmations | `0` |
| Callback gas limit | `2500000` |
| Native payment | `false`, LINK subscription payment |

VRF behavior:

- `OPERATION_ROLE` can update VRF config through `setVrfConfig(...)`.
- Each request stores `requestCoordinator[requestId]`.
- `rawFulfillRandomWords(...)` accepts fulfillment only from the coordinator recorded for that request.
- Pending requests remain fulfillable by the old coordinator after config updates.

## Roles And Permissions

### DOUDOCOIN

| Role | Holder |
| --- | --- |
| `DEFAULT_ADMIN_ROLE` | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| `MINTER_ROLE` | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| `MINTER_ROLE` | `0x9C4a0e04e10a36bad4b9EcbdEF2d2447afe8f131` |
| `BURNER_ROLE` | `0xb2E6A782CDaBB0178216BBB57B782b448B21cAf2` |

### DOUDOCHAINV2Upgradeable

| Role | Holder |
| --- | --- |
| `DEFAULT_ADMIN_ROLE` | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| `UPGRADER_ROLE` | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| `OPERATION_ROLE` | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| `ADMINMINT_ROLE` | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| `COLLECTION_BOOK_ROLE` | `0x9C4a0e04e10a36bad4b9EcbdEF2d2447afe8f131` |

### CollectionBookUpgradeable

| Role | Holder |
| --- | --- |
| `DEFAULT_ADMIN_ROLE` | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| `UPGRADER_ROLE` | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| `OPERATION_ROLE` | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |

## Implemented Business Functions

### DOUDOCOIN

Implemented:

- Soulbound points token.
- `mint(...)` / `mintWithReason(...)` restricted by `MINTER_ROLE`.
- `burnFrom(...)` / `burnFromWithReason(...)` restricted by `BURNER_ROLE`.
- Wallet-to-wallet `transfer(...)` and `transferFrom(...)` revert.
- `approve(...)` may be called, but approved transfer still reverts.

Frontend/backend usage:

- Show balance with `balanceOf(address)`.
- Do not build user transfer flows for DOUDOCOIN.
- Points spending is done by `DOUDOCHAINV2Upgradeable.mint(...)`, which burns user points through `BURNER_ROLE`.

### DOUDOCHAINV2Upgradeable

Implemented:

- UUPS upgradeable ERC721A lottery ticket contract.
- Points-only paid minting with `DOUDOCOIN`.
- Atomic series creation through `createSeriesWithSubPrizes(...)`.
- Batch series creation through `batchCreateSeriesWithSubPrizes(...)`.
- Metadata remains editable after goods arrival through `setSeriesMetadata(...)`.
- Lucky-number minting and uniqueness checks.
- Wallet cap and short-lived mint lock.
- Admin airdrop minting through `adminMint(...)`.
- Reveal request and settlement inside VRF callback.
- Main redraw through `redrawMain(...)`.
- Last-prize draw through `chooseLastPrizeWinner(...)`.
- VRF config updates through `setVrfConfig(...)`.
- Focused read getters for subgraph/frontend.
- Legacy-compatible events used by the current subgraph, with `luckyNumber` added to `NewTicketStatus`.

Primary write methods:

```solidity
createSeriesWithSubPrizes(SeriesInput input, SubPrize[] subPrizes, bool markGoodsArrived)
batchCreateSeriesWithSubPrizes(SeriesInput[] inputs, SubPrize[][] subPrizesList, bool[] markGoodsArrivedList)
setSeriesMetadata(uint256 seriesID, string exchangeTokenURI, string unrevealTokenURI, string revealTokenURI, string seriesMetaDataURI)
mint(uint256 seriesID, uint16[] luckyNumbers)
adminMint(address to, uint256 seriesID, uint16[] luckyNumbers)
reveal(uint256 seriesID, uint256[] tokenIDs)
setRedrawConfig(uint256 seriesID, uint16 mainBurnCount, uint16 consolationBurnCount)
redrawMain(uint256 seriesID, uint256[] tokenIDs)
chooseLastPrizeWinner(uint256 seriesID, uint32 quantity)
setVrfConfig(address vrfCoordinator, uint256 subscriptionId, bytes32 keyHash, uint32 callbackGasLimit, uint16 requestConfirmations)
pause()
unpause()
```

Primary read methods:

```solidity
doudoSeries(uint256 seriesID)
seriesURIs(uint256 seriesID)
ticketStatusDetail(uint256 tokenID)
getSubPrizesDetail(uint256 seriesID)
lastPrizeOwners(uint256 seriesID, uint256 index)
vrfCoordinator()
subscriptionId()
keyHash()
callbackGasLimit()
requestConfirmations()
```

### CollectionBookUpgradeable

Implemented:

- UUPS upgradeable collection book contract.
- Create collection books and slots.
- Enable/disable books.
- Escrow matching revealed prize NFTs.
- Withdraw deposited NFTs before claim.
- Claim points rewards through `DOUDOCOIN.mintWithReason(...)`.
- Emit subgraph-specific CollectionBook events.

Primary write methods:

```solidity
createBook(string name, Slot[] slots, RewardKind rewardKind, uint256 rewardData, bool active)
setBookActive(uint256 bookId, bool active)
setDoudochainV2RewardTarget(address doudochainV2RewardTarget)
depositToBook(uint256 bookId, uint256[] tokenIds)
withdrawDeposited(uint256 bookId, address sourceContract, uint256[] tokenIds)
claimBook(uint256 bookId)
```

Reward kind enum:

```solidity
0 = NftPrize
1 = Points
2 = UnlockSeries
```

Current safe production use:

- `RewardKind.Points` is supported end to end.

## Business Coverage Checklist

| Requirement | Status | Notes |
| --- | --- | --- |
| Points-only V2 payment | Done | Paid mint burns `DOUDOCOIN`. |
| DOUDOCOIN non-transferable | Done | Transfer and transferFrom revert. |
| UUPS proxy for DOUDOCHAINV2 | Done | Proxy deployed and verified/linked. |
| UUPS proxy for CollectionBook | Done | Proxy deployed and verified/linked. |
| Official ops wallet admin/upgrader | Done | Deployer has admin/upgrader/operation roles. |
| Series creation is atomic | Done | `createSeriesWithSubPrizes`. |
| Batch series creation | Done | `batchCreateSeriesWithSubPrizes`. |
| Metadata editable after goods arrival | Done | `setSeriesMetadata` has no goods-arrived lock. |
| AdminMint / airdrop tickets | Done | `adminMint` bypasses points burn, wallet cap, and mint lock. |
| Lucky number in ticket event | Done | `NewTicketStatus` has 7 parameters including `uint16 luckyNumber`. |
| VRF callback settles prize in callback | Done | Reveal settlement remains in `rawFulfillRandomWords`. |
| VRF config can be updated | Done | `setVrfConfig` emits `VrfConfigUpdated`. |
| Pending request survives coordinator change | Done | Request stores its coordinator. |
| Main redraw | Done | `redrawMain`. |
| Last prize draw | Done | `chooseLastPrizeWinner`. |
| CollectionBook point reward | Done | `RewardKind.Points` works if book has `DOUDOCOIN.MINTER_ROLE`. |
| The Graph legacy core events | Done with schema update | Add `luckyNumber` field; map price points carefully. |
| Old on-chain list/pagination readers removed | Done intentionally | Use The Graph for lists. |
| Bundle mint / rebate / consolation draw credits | Not in deployed ABI | Requires future upgrade/module. |
| Refund flow | Not in deployed ABI | `setSeriesRefund` / `claimRefund` absent. |
| Redraw consolation / draw consolation | Not in deployed ABI | `redrawConsolation` / `drawConsolation` absent. |
| CollectionBook NFT prize reward to core | Not end-to-end | Book has generic call, but deployed core lacks `mintCollectionReward`. |
| CollectionBook unlock-series reward to core | Not end-to-end | Book has generic call, but deployed core lacks `unlockSeriesFor`. |
| Collection reward config in core | Not in deployed ABI | Requires future upgrade/module. |

Business conclusion:

- Current deployment satisfies the points-only mint, reveal-speed test, atomic/batch series setup, admin airdrop, main redraw, last prize, and points-based CollectionBook paths.
- Current deployment does not fully preserve every non-upgradeable V2 feature. Bundle/refund/consolation/CollectionBook NFT and unlock rewards need a follow-up upgrade.
- `DOUDOCHAINV2Upgradeable` deployed bytecode is near the EIP-170 limit. Further feature work should use split modules or a smaller implementation strategy.

## Subgraph Integration

Data sources must point to proxy addresses:

```yaml
DOUDOCHAINV2Upgradeable: 0xb2E6A782CDaBB0178216BBB57B782b448B21cAf2
CollectionBookUpgradeable: 0x9C4a0e04e10a36bad4b9EcbdEF2d2447afe8f131
```

Core event compatibility:

```solidity
NewSeries(uint256,string,uint256,uint256,uint256,uint256,bool,uint256,uint256,string,string,string,string,address,bool,bool)
NewSubPrize(uint256,uint256,string,string,uint256)
NewTicketStatus(uint256,uint256,uint256,bool,bool,address,uint16)
RevealDrawSent(uint256,uint256[])
RevealDrawFulfilled(uint256,uint256,uint256[])
UpdatePrize(uint256,uint256,uint256)
UpdateTicketStatus(uint256,uint256,uint256,bool,bool)
UpdateSeriesInformation(uint256,bool,uint256,uint256,string,string,string,string)
UpdateSeriesRemainingTicketNumbers(uint256,uint256)
LastPrizeDraw(uint256,uint256,uint256)
LastPrizeWinner(uint256,uint256[])
UpdateSeriesLastPrizeOwner(uint256,address[])
AdminMinted(address,address,uint256,uint256)
VrfConfigUpdated(address,uint256,bytes32,uint32,uint16,address)
RedrawRequested(uint256,uint256,address,bool)
```

Schema updates required:

- Add `NewTicketStatus.luckyNumber`.
- Treat `NewSeries.priceInUSDTWei` as `priceInPoints` for V2.
- Add `priceInPoints` field if frontend wants explicit naming.
- Add CollectionBook entities and handlers from `/Users/angustsai/ICHICHAIN_CONTRACT/docs/subgraph-v2-upgradeable-query-mapping.md`.

CollectionBook events:

```solidity
CollectionBookCreated(uint256,string,uint8,uint256,bool)
CollectionBookSlotDefined(uint256,uint256,address,uint256,uint256,uint32)
CollectionBookStatusUpdated(uint256,bool)
CollectionBookRewardTargetUpdated(address)
CollectionBookSlotFilled(address,uint256,uint256,address,uint256,uint32)
CollectionBookSlotEmptied(address,uint256,uint256,address,uint256,uint32)
CollectionBookClaimed(address,uint256,uint8,uint256)
```

## Frontend Integration Notes

- Use `DOUDOCHAINV2Upgradeable` proxy address with the implementation ABI.
- Use `CollectionBookUpgradeable` proxy address with the implementation ABI.
- Do not use implementation addresses for reads/writes.
- Display DOUDOCOIN as points, not a transferable token.
- Do not show DOUDOCOIN send/transfer UI.
- For V2 series prices, display `priceInPoints`; old `priceInUSDTWei` subgraph field is compatibility naming only.
- Update ticket models to include `luckyNumber`.
- Use subgraph for series lists and owner/token lists; old on-chain pagination functions are absent by design.
- Hide or disable bundle/refund/consolation/CollectionBook NFT and unlock reward flows until a follow-up upgrade adds those functions.

## Backend/Ops Notes

Deploy script:

```bash
DOUDO_POINTS_ADDRESS=0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E \
npx hardhat run scripts/deployUpgradeableArbSepolia.ts --network arbitrumSepolia
```

Upgrade script:

```bash
DOUDOCHAIN_V2_PROXY_ADDRESS=0xb2E6A782CDaBB0178216BBB57B782b448B21cAf2 \
COLLECTION_BOOK_PROXY_ADDRESS=0x9C4a0e04e10a36bad4b9EcbdEF2d2447afe8f131 \
npx hardhat run scripts/upgradeDoudochainV2ArbSepolia.ts --network arbitrumSepolia
```

Verification commands used:

```bash
npx hardhat verify --network arbitrumSepolia --contract contracts/DDOUDOCOIN.sol:DOUDOCOIN 0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E 0x226f0197D502e7AC87d1A76D6526945DFa9E4209 0x226f0197D502e7AC87d1A76D6526945DFa9E4209
npx hardhat verify --network arbitrumSepolia --contract contracts/DOUDOCHAINV2Upgradeable.sol:DOUDOCHAINV2Upgradeable 0xb4e37600904A2D9B0B71D08F8e655Df30D41FEC2
npx hardhat verify --network arbitrumSepolia --contract contracts/CollectionBookUpgradeable.sol:CollectionBookUpgradeable 0xFcAf805DDffc9D084C0a11b88A6F40dF5e603B43
```

## Verification Snapshot

Latest contract test run before this handoff:

```text
npm test
41 passing
24 pending
```

Bytecode size:

```text
DOUDOCHAINV2Upgradeable: 24,556 bytes
CollectionBookUpgradeable: 10,462 bytes
```

Note: The raw bytecode output is in bytes. `DOUDOCHAINV2Upgradeable` is `24,556` bytes, very close to the EIP-170 limit of `24,576` bytes.
