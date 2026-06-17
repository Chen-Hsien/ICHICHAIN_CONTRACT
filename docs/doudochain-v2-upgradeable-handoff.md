# DOUDOCHAIN V2 Upgradeable Handoff

Last updated: 2026-06-15

This document is the current handoff for the upgraded Arbitrum Sepolia V2 split-module deployment. Use proxy addresses for app/subgraph calls and implementation addresses only for verification and upgrade records.

## Network

| Item | Value |
| --- | --- |
| Network | Arbitrum Sepolia |
| Chain ID | `421614` |
| Official ops / deployer wallet | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| Block explorer | `https://sepolia.arbiscan.io` |

## Current Deployment

Proxy app addresses are unchanged by this upgrade. `DoudoVRFRouter` is non-proxy and was redeployed for the latest Chainlink-router fixes.

| Contract | App address | Implementation | Verification |
| --- | --- | --- | --- |
| `DOUDOCOIN` | `0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E` | Non-proxy | Verified |
| `DoudoVRFRouter` | `0x5A59D45437559C7CE0A012630a456321180C21e1` | Non-proxy | Verified |
| `DOUDOCHAINV2CoreUpgradeable` | `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` | `0x676187E363F66aCa7d8D6e75714FF989105106bf` | Verified and proxy-linked |
| `DoudoBundleModuleUpgradeable` | `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` | `0xB67506b80F84ff2551c7Db3670F73b06f0F24c2B` | Verified and proxy-linked |
| `DoudoRefundModuleUpgradeable` | `0x8ee19238DAa466B7792BE33569c6E4f6993CCf20` | `0xC6cad8c6A27170848CF295fd1A290A143d3Ea4a3` | Verified and proxy-linked |
| `DoudoRedrawModuleUpgradeable` | `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` | `0xaa02Ee36a3CC7cc66e69cD8b25Cba39071101B92` | Verified and proxy-linked |
| `DoudoCollectionRewardModuleUpgradeable` | `0x680618a6933DD68fF84Ff9F64760120d27400B3C` | `0x2cE5a89cBA7F79a6de97E6d798522f66310a6d83` | Verified and proxy-linked |
| `CollectionBookUpgradeable` | `0x4284be399cA9591fBd98248969fCcb969E21B2C6` | `0x8084993A227F9dc060407F568B95c5201b55259f` | Verified and proxy-linked |
| `MerchantSeriesRegistry` | `0x03dBEE1f231A29b06032aa24D2CFb96a1321C1A6` | `0x59B2869C51cc555734845DF9eb3bDFb5Fc6f1E81` | Verified and proxy-linked |
| `MerchantSeriesPublisher` | `0x259FB223A10D0116e5802d30FF5f441353C8972d` | Non-proxy | Verified |

Explorer links:

- DOUDOCOIN: `https://sepolia.arbiscan.io/address/0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E#code`
- DoudoVRFRouter: `https://sepolia.arbiscan.io/address/0x5A59D45437559C7CE0A012630a456321180C21e1#code`
- Core proxy: `https://sepolia.arbiscan.io/address/0xf75395A8cd753f47135cfcaE00D2706252c3E0F5#code`
- Core implementation: `https://sepolia.arbiscan.io/address/0x676187E363F66aCa7d8D6e75714FF989105106bf#code`
- Bundle proxy: `https://sepolia.arbiscan.io/address/0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6#code`
- Bundle implementation: `https://sepolia.arbiscan.io/address/0xB67506b80F84ff2551c7Db3670F73b06f0F24c2B#code`
- Refund proxy: `https://sepolia.arbiscan.io/address/0x8ee19238DAa466B7792BE33569c6E4f6993CCf20#code`
- Refund implementation: `https://sepolia.arbiscan.io/address/0xC6cad8c6A27170848CF295fd1A290A143d3Ea4a3#code`
- Redraw proxy: `https://sepolia.arbiscan.io/address/0xE75461828f41C890fbc811e7cABFe2143B3F4afE#code`
- Redraw implementation: `https://sepolia.arbiscan.io/address/0xaa02Ee36a3CC7cc66e69cD8b25Cba39071101B92#code`
- Collection reward proxy: `https://sepolia.arbiscan.io/address/0x680618a6933DD68fF84Ff9F64760120d27400B3C#code`
- CollectionBook proxy: `https://sepolia.arbiscan.io/address/0x4284be399cA9591fBd98248969fCcb969E21B2C6#code`
- MerchantSeriesRegistry proxy: `https://sepolia.arbiscan.io/address/0x03dBEE1f231A29b06032aa24D2CFb96a1321C1A6#code`
- MerchantSeriesRegistry implementation: `https://sepolia.arbiscan.io/address/0x59B2869C51cc555734845DF9eb3bDFb5Fc6f1E81#code`
- MerchantSeriesPublisher: `https://sepolia.arbiscan.io/address/0x259FB223A10D0116e5802d30FF5f441353C8972d#code`

## ABI Paths

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
| `MerchantSeriesRegistry` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/MerchantSeriesRegistry.sol/MerchantSeriesRegistry.json` |
| `MerchantSeriesPublisher` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/MerchantSeriesPublisher.sol/MerchantSeriesPublisher.json` |

## Chainlink VRF

Configured on `DoudoVRFRouter`. In Chainlink dashboard, add this Router address as the VRF subscription consumer.

| Field | Value |
| --- | --- |
| VRF consumer | `0x5A59D45437559C7CE0A012630a456321180C21e1` |
| VRF coordinator | `0x5CE8D5A2BC84beb22a398CCA51996F7930313D61` |
| Key hash | `0x1770bdc7eec7771f7ba4ffd640f34260d7f095b79c92d34a5b2551d6f6cfd2be` |
| Subscription ID | `106016056432422253373974444299096295296684744368940754254159766683809634643463` |
| Request confirmations | `0` |
| Callback gas limit | `2500000` |
| Native payment | `false`, LINK subscription payment |
| Consumer add tx | `0x7017ce80aa8923646b02749a7a223bc8355da3991c04c06ecc7a46632ada3e8c` |

VRF behavior:

- Router inherits Chainlink `VRFConsumerBaseV2Plus`, so `rawFulfillRandomWords` keeps the official coordinator-only guard.
- Core reveal and pre-order last-prize requests call `DoudoVRFRouter.requestRandomWords(...)`.
- Redraw consolation requests call `DoudoRedrawModuleUpgradeable -> DoudoVRFRouter`.
- Router tracks `pendingRequests` and blocks coordinator-address changes while pending requests exist.
- Prize settlement remains inside the Chainlink fulfill transaction for reveal and consolation draw.

Latest upgrade/wiring txs:

| Action | Tx |
| --- | --- |
| Core set Router | `0x4aced3292f8b3b6d6c0ebc59cdd2056a81977ebd50e7cc5e7fffc3e671ff68b2` |
| Router allow Core requester | `0x607c76fe3ccd1c70a3c8412c87ea697ccdf07fc6c0a45604a3b3023f7a0fd865` |
| Router allow Redraw requester | `0x58d82b241f6105696179395878629427cc15f93672e1845ae0211afaffe56843` |
| Redraw set Router | `0x5c1e99b910e4b38b7df1a00d279f5d24595977a86f449d944af42b0fb7eafd20` |
| VRF add consumer | `0x7017ce80aa8923646b02749a7a223bc8355da3991c04c06ecc7a46632ada3e8c` |

## Subgraph Data Sources

Index these addresses. For UUPS contracts, index the proxy address.

| Data source | Address | Purpose |
| --- | --- | --- |
| Core | `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` | Series, tickets, reveal, main prizes, last prize, canonical events |
| VRF Router | `0x5A59D45437559C7CE0A012630a456321180C21e1` | VRF config, request target, fulfillment status |
| Bundle Module | `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` | Bundle configs and bundle mint history |
| Refund Module | `0x8ee19238DAa466B7792BE33569c6E4f6993CCf20` | Refund config and claims |
| Redraw Module | `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` | Redraw config, synchronous redraw mints, consolation requests |
| Collection Reward Module | `0x680618a6933DD68fF84Ff9F64760120d27400B3C` | Collection reward config, reward mints, unlock events |
| CollectionBook | `0x4284be399cA9591fBd98248969fCcb969E21B2C6` | Book definitions, deposits, withdrawals, claims |
| MerchantSeriesRegistry | `0x03dBEE1f231A29b06032aa24D2CFb96a1321C1A6` | Merchant attribution link/relink events; start block `277513499` |

Core keeps the legacy-compatible event names: `NewSeries`, `NewSubPrize`, `NewTicketStatus`, `RevealDrawSent`, `RevealDrawFulfilled`, `UpdatePrize`, `UpdateTicketStatus`, `UpdateSeriesInformation`, `UpdateSeriesRemainingTicketNumbers`, `LastPrizeDraw`, `LastPrizeWinner`, `UpdateSeriesLastPrizeOwner`, and `AdminMinted`. `NewTicketStatus` now includes `uint16 luckyNumber` as the seventh parameter.

Heavy on-chain aggregate readers are intentionally absent from the split Core: `doudoSeries`, `seriesURIs`, `getSubPrizesDetail`, old token-list pagination, and owner-list pagination should come from The Graph/events. Direct single-ticket reads remain available through `ticketStatusDetail(tokenID)`, `pointsPaid(tokenID)`, `ownerOf(tokenID)`, and `tokenURI(tokenID)`.

See `/Users/angustsai/ICHICHAIN_CONTRACT/docs/subgraph-v2-upgradeable-query-mapping.md` for schema/query mapping.

## Role Wiring

| Contract | Permission | Holder |
| --- | --- | --- |
| `DOUDOCOIN` | `BURNER_ROLE` | Core proxy `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` |
| `DOUDOCOIN` | `BURNER_ROLE` | Bundle proxy `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` |
| `DOUDOCOIN` | `MINTER_ROLE` | Bundle proxy `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` |
| `DOUDOCOIN` | `MINTER_ROLE` | Refund proxy `0x8ee19238DAa466B7792BE33569c6E4f6993CCf20` |
| `DOUDOCOIN` | `MINTER_ROLE` | Collection reward proxy `0x680618a6933DD68fF84Ff9F64760120d27400B3C` |
| `DOUDOCOIN` | `MINTER_ROLE` | CollectionBook proxy `0x4284be399cA9591fBd98248969fCcb969E21B2C6` |
| Core | `MODULE_ROLE` | Bundle, Refund, Redraw, CollectionReward proxies |
| Router | requester | Core proxy `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` |
| Router | requester | Redraw proxy `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` |
| Bundle | redraw module | `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` |
| Redraw | bundle module | `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` |
| CollectionReward | collection book | `0x4284be399cA9591fBd98248969fCcb969E21B2C6` |
| CollectionBook | reward target | `0x680618a6933DD68fF84Ff9F64760120d27400B3C` |
| Core | `OPERATION_ROLE` | MerchantSeriesPublisher `0x259FB223A10D0116e5802d30FF5f441353C8972d` |
| MerchantSeriesRegistry | `LINKER_ROLE` | MerchantSeriesPublisher `0x259FB223A10D0116e5802d30FF5f441353C8972d` |
| MerchantSeriesPublisher | `PUBLISHER_OPERATION_ROLE` | Backend/admin operator wallet `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |

Core no longer uses a separate `VRF_ROUTER_ROLE`; fulfillment is guarded by `msg.sender == vrfRouter`.

## Implemented Business Functions

| Area | Status | Notes |
| --- | --- | --- |
| Points-only payment | Done | Paid mint burns `DOUDOCOIN`; no external currency list in V2. |
| DOUDOCOIN non-transferable | Done | Wallet transfers revert; role mint/burn remains. |
| UUPS split architecture | Done | Core, Bundle, Refund, Redraw, CollectionReward, CollectionBook are UUPS proxies. Router is non-proxy. |
| Atomic series creation | Done | `createSeriesWithSubPrizes(...)`. |
| Batch series creation | Done | `batchCreateSeriesWithSubPrizes(...)`. |
| Metadata editable after goods arrived | Done | `setSeriesMetadata(...)` has no goods-arrived lock. |
| Goods arrived operation | Done | `setGoodsArrived(...)`; reveal requires goods arrived. |
| Pre-order support | Done | Pre-order mint is allowed before arrival; reveal remains blocked until arrival. |
| Admin airdrop | Done | `adminMint(...)` bypasses points burn, wallet cap, and mint lock. |
| Lucky number event | Done | `NewTicketStatus(..., uint16 luckyNumber)`. |
| Mint lock and wallet cap | Done | `setDefaultLockDuration`, `setSeriesLockDuration`, `clearMintLock`, `setSeriesMaxPerWallet`. |
| Reveal through Chainlink VRF | Done | Router keeps Chainlink base module and official guard. |
| Last prize | Done | Non-preorder sold-out series picks last sold token synchronously; pre-order series uses VRF. |
| Exchange prize | Done | `exchangePrize(...)` updates ticket exchange state and tokenURI branch. |
| Token URI state | Done | Unrevealed, revealed, and exchanged states are supported. |
| Bundle mint | Done | Burns bundle price, records per-ticket paid points, supports rebate and consolation credits. |
| Refund | Done | Refunds actual `pointsPaid(tokenID)`, including bundle-discounted tickets. |
| Main redraw | Done | Synchronous burn-N, mint-N unrevealed tickets; no VRF and no returned prize inventory. |
| Consolation draw | Done | Separate consolation prize pool in Redraw module, VRF draw, revealed reward mint without main inventory consumption. |
| CollectionBook points reward | Done | Direct points or reward-module points flow. |
| CollectionBook NFT reward | Done | Reward module calls Core `moduleMintRevealed(...)`. |
| CollectionBook unlock-series reward | Done | Reward module calls Core `moduleUnlockSeriesFor(...)`. |
| The Graph compatibility | Done | Legacy core event names preserved; module-specific events added. |
| Old on-chain list/pagination readers | Removed intentionally | Use The Graph for lists and aggregate views. |

## Primary Write Methods

Core:

```solidity
createSeriesWithSubPrizes(SeriesInput input, SubPrize[] subPrizes, bool markGoodsArrived)
batchCreateSeriesWithSubPrizes(SeriesInput[] inputs, SubPrize[][] subPrizesList, bool[] markGoodsArrivedList)
setSeriesMetadata(uint256 seriesID, string exchangeTokenURI, string unrevealTokenURI, string revealTokenURI, string seriesMetaDataURI)
setGoodsArrived(uint256 seriesID)
setDefaultLockDuration(uint256 duration)
setSeriesLockDuration(uint256 seriesID, uint256 duration)
clearMintLock(uint256 seriesID)
setSeriesMaxPerWallet(uint256 seriesID, uint256 cap)
mint(uint256 seriesID, uint16[] luckyNumbers)
adminMint(address to, uint256 seriesID, uint16[] luckyNumbers)
reveal(uint256 seriesID, uint256[] tokenIDs)
chooseLastPrizeWinner(uint256 seriesID, uint32 quantity)
exchangePrize(uint256[] tokenIDs)
pause()
unpause()
```

Router:

```solidity
setRequester(address requester, bool allowed)
setVrfConfig(address vrfCoordinator, uint256 subscriptionId, bytes32 keyHash, uint32 callbackGasLimit, uint16 requestConfirmations)
```

Modules:

```solidity
setSeriesBundles(uint256 seriesID, BundleInput[] bundles)
mintBundle(uint256 seriesID, uint256 bundleID, uint256 quantity)
setSeriesRefund(uint256 seriesID, bool isRefund, uint256 refundPointsPerTicket)
claimRefund(uint256[] tokenIDs)
setRouter(address routerAddress)
setRedrawConfig(uint256 seriesID, uint16 mainBurnCount, uint16 consolationBurnCount)
setRedrawEnabled(uint256 seriesID, bool enabled)
redrawMain(uint256 seriesID, uint256[] tokenIDs)
setConsolationPrizes(uint256 seriesID, SubPrize[] prizes)
drawConsolation(uint256 seriesID)
setCollectionRewardConfig(uint256 collectionBookID, RewardConfig config)
mintCollectionReward(address to, uint256 rewardData)
```

CollectionBook:

```solidity
createBook(string name, Slot[] slots, RewardKind rewardKind, uint256 rewardData, bool active)
setBookActive(uint256 bookId, bool active)
setDoudochainV2RewardTarget(address doudochainV2RewardTarget)
depositToBook(uint256 bookId, uint256[] tokenIds)
withdrawDeposited(uint256 bookId, address sourceContract, uint256[] tokenIds)
claimBook(uint256 bookId)
```

Merchant attribution:

```solidity
publishSeriesWithMerchant(address core, SeriesInput input, SubPrize[] subPrizes, bool markGoodsArrived, bytes32 merchantRef)
linkSeries(address seriesContract, uint256 seriesID, bytes32 merchantRef)
relinkSeries(address seriesContract, uint256 seriesID, bytes32 newMerchantRef)
merchantOf(address seriesContract, uint256 seriesID)
```

## Event Signatures For Subgraph

Core:

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
VrfRouterUpdated(address,address)
MintLockUpdated(uint256,address,uint256)
SeriesUnlockedFor(uint256,address,uint256)
```

Merchant registry:

```solidity
SeriesMerchantLinked(address,uint256,bytes32,address)
SeriesMerchantRelinked(address,uint256,bytes32,bytes32,address)
```

Router and modules:

```solidity
RequesterUpdated(address,bool)
VrfConfigUpdated(address,uint256,bytes32,uint32,uint16,address)
VrfRandomWordsRequested(uint256,address,address,uint32)
VrfRandomWordsFulfilled(uint256,address)
BundleConfigured(uint256,uint256,uint256,uint256,uint256,uint256,bool)
BundleMinted(uint256,uint256,address,uint256,uint256)
RefundSeries(uint256,bool,uint256)
RefundClaimed(uint256,address,uint256[],uint256)
RouterUpdated(address)
RedrawConfigUpdated(uint256,uint16,uint16)
RedrawEnabledUpdated(uint256,bool)
RedrawRequested(uint256,uint256,address,bool)
RedrawFulfilled(uint256,uint256,address,uint256,bool)
RedrawMinted(uint256,address,uint256,uint256)
ConsolationDrawBalanceUpdated(uint256,address,uint256)
NewConsolationPrize(uint256,uint256,string,string,uint256)
UpdateConsolationPrize(uint256,uint256,uint256)
CollectionRewardConfigSet(uint256,uint8,uint256,uint256,uint256,bool)
CollectionRewardMinted(uint256,address,uint8,uint256,uint256)
CollectionBookCreated(uint256,string,uint8,uint256,bool)
CollectionBookSlotDefined(uint256,uint256,address,uint256,uint256,uint32)
CollectionBookStatusUpdated(uint256,bool)
CollectionBookRewardTargetUpdated(address)
CollectionBookSlotFilled(address,uint256,uint256,address,uint256,uint32)
CollectionBookSlotEmptied(address,uint256,uint256,address,uint256,uint32)
CollectionBookClaimed(address,uint256,uint8,uint256)
```

## Frontend And Backend Notes

- Use proxy app addresses with implementation ABIs for UUPS contracts.
- Do not use implementation addresses for reads/writes.
- Display `DOUDOCOIN` as points, not a transferable ERC20.
- Treat V2 `NewSeries.priceInUSDTWei` compatibility field as `priceInPoints` in UI copy.
- Update ticket models to include `luckyNumber`.
- Use The Graph for series lists, sub-prize lists, user ticket lists, and owner-based list views.
- Direct contract read paths are intentionally narrow to keep Core below the EIP-170 limit.

## Ops Commands

Wiring check:

```bash
npx hardhat run scripts/checkSplitModuleArbSepolia.ts --network arbitrumSepolia
```

Upgrade script for the next implementation upgrade:

```bash
npx hardhat run scripts/upgradeDoudochainV2ArbSepolia.ts --network arbitrumSepolia
```

Verification script:

```bash
npx hardhat run scripts/verifySplitModuleArbSepolia.ts --network arbitrumSepolia
```

Merchant attribution deploy + role wiring:

```bash
npx hardhat run scripts/deployMerchantAttributionArbSepolia.ts --network arbitrumSepolia
```

After deployment:

1. Deploy the updated subgraph from
   `/Users/angustsai/thegraph/doudochain_amoy`.
2. After a Publisher publish succeeds and indexes, revoke Core
   `OPERATION_ROLE` from direct human/backend publish wallets so series creation
   must go through the Publisher.

## Verification Snapshot

Latest local verification after this upgrade:

```text
npx hardhat compile
OK

npm test
61 passing
24 pending

npx hardhat run scripts/checkSplitModuleArbSepolia.ts --network arbitrumSepolia
Split module wiring checks passed.
```

Storage upgrade coverage:

```text
Core: deployProxy(previous split-layout harness) -> upgradeProxy(current Core) -> state preserved
Redraw: deployProxy(previous split-layout harness) -> upgradeProxy(current Redraw) -> state preserved
```

Bytecode size snapshot:

```text
DOUDOCHAINV2CoreUpgradeable: 24,146 bytes
DoudoBundleModuleUpgradeable: 6,282 bytes
DoudoRefundModuleUpgradeable: 5,660 bytes
DoudoRedrawModuleUpgradeable: 9,376 bytes
DoudoCollectionRewardModuleUpgradeable: 6,205 bytes
CollectionBookUpgradeable: 10,519 bytes
DoudoVRFRouter: 2,999 bytes
```

TypeScript note: `npx tsc --noEmit --pretty false` still reports pre-existing Hardhat/TypeChain inference errors in older deploy scripts. The latest upgrade script has no reported TypeScript error in that run.
