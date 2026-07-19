# DOUDOCHAIN V2 Upgradeable Handoff

Last updated: 2026-07-19

This document is the current handoff for the upgraded Arbitrum Sepolia V2 split-module deployment. Use proxy addresses for app/subgraph calls and implementation addresses only for verification and upgrade records.

## Network

| Item | Value |
| --- | --- |
| Network | Arbitrum Sepolia |
| Chain ID | `421614` |
| Official ops / deployer wallet | `0x226f0197D502e7AC87d1A76D6526945DFa9E4209` |
| Block explorer | `https://sepolia.arbiscan.io` |

## Current Deployment

Proxy app addresses are unchanged by this upgrade. Core and Redraw currently use
separate non-proxy `DoudoVRFRouter` deployments; both point at the same Chainlink
coordinator and authorize their respective requester.

| Contract | App address | Implementation | Verification |
| --- | --- | --- | --- |
| `DOUDOCOIN` | `0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E` | Non-proxy | Verified |
| `DoudoVRFRouter` (Core) | `0x48A1205c9b6BF1Da1a3D1bE651A9e237AC349Eb5` | Non-proxy | Chain read confirmed |
| `DoudoVRFRouter` (Redraw) | `0x5A59D45437559C7CE0A012630a456321180C21e1` | Non-proxy | Verified |
| `DOUDOCHAINV2CoreUpgradeable` | `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` | `0x69Cba537C085BA7D9242C71c434F4cD0F81d4311` | Verified |
| `DoudoSeriesOpsModuleUpgradeable` | `0x2FF7521dEF3903fc5c6f2877252cdf5019380070` | `0x5409aa1Fbdd2e28fb47457F7ee50af1f73dD966D` | Verified and proxy-linked |
| `DoudoBundleModuleUpgradeable` | `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` | `0x331818ea2401847823A5dc5C76358db04707F74e` | Verified and proxy-linked |
| `DoudoRefundModuleUpgradeable` | `0x8ee19238DAa466B7792BE33569c6E4f6993CCf20` | `0xC6cad8c6A27170848CF295fd1A290A143d3Ea4a3` | Verified and proxy-linked |
| `DoudoRedrawModuleUpgradeable` | `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` | `0xAC4A0DF12704eFE73ca8D20eC4965C69105AF2b8` | Verified and proxy-linked |
| `DoudoCollectionRewardModuleUpgradeable` | `0x680618a6933DD68fF84Ff9F64760120d27400B3C` | `0x2cE5a89cBA7F79a6de97E6d798522f66310a6d83` | Verified and proxy-linked |
| `CollectionBookUpgradeable` | `0x4284be399cA9591fBd98248969fCcb969E21B2C6` | `0x65910b3d16cD79c82B9FDC5f1c62C712Fe18F88C` | Verified and proxy-linked |
| `MerchantSeriesRegistry` | `0x03dBEE1f231A29b06032aa24D2CFb96a1321C1A6` | `0x59B2869C51cc555734845DF9eb3bDFb5Fc6f1E81` | Verified and proxy-linked |
| `MerchantSeriesPublisher` | `0xB0EC5ca70a9AeCaeb260FdCDF238a64Ad37F5515` | `0xC76F735c59CAa54B2a3bea79010Fc934E206b393` | Verified |

Explorer links:

- DOUDOCOIN: `https://sepolia.arbiscan.io/address/0xFFCD533609e0e9E810C4C5D8Cb7a69D7a537C17E#code`
- Core DoudoVRFRouter: `https://sepolia.arbiscan.io/address/0x48A1205c9b6BF1Da1a3D1bE651A9e237AC349Eb5#code`
- Redraw DoudoVRFRouter: `https://sepolia.arbiscan.io/address/0x5A59D45437559C7CE0A012630a456321180C21e1#code`
- Core proxy: `https://sepolia.arbiscan.io/address/0xf75395A8cd753f47135cfcaE00D2706252c3E0F5#code`
- Core implementation: `https://sepolia.arbiscan.io/address/0x69Cba537C085BA7D9242C71c434F4cD0F81d4311#code`
- SeriesOps proxy: `https://sepolia.arbiscan.io/address/0x2FF7521dEF3903fc5c6f2877252cdf5019380070#code`
- SeriesOps implementation: `https://sepolia.arbiscan.io/address/0x5409aa1Fbdd2e28fb47457F7ee50af1f73dD966D#code`
- Bundle proxy: `https://sepolia.arbiscan.io/address/0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6#code`
- Bundle implementation: `https://sepolia.arbiscan.io/address/0x331818ea2401847823A5dc5C76358db04707F74e#code`
- Refund proxy: `https://sepolia.arbiscan.io/address/0x8ee19238DAa466B7792BE33569c6E4f6993CCf20#code`
- Refund implementation: `https://sepolia.arbiscan.io/address/0xC6cad8c6A27170848CF295fd1A290A143d3Ea4a3#code`
- Redraw proxy: `https://sepolia.arbiscan.io/address/0xE75461828f41C890fbc811e7cABFe2143B3F4afE#code`
- Redraw implementation: `https://sepolia.arbiscan.io/address/0xAC4A0DF12704eFE73ca8D20eC4965C69105AF2b8#code`
- Collection reward proxy: `https://sepolia.arbiscan.io/address/0x680618a6933DD68fF84Ff9F64760120d27400B3C#code`
- CollectionBook proxy: `https://sepolia.arbiscan.io/address/0x4284be399cA9591fBd98248969fCcb969E21B2C6#code`
- CollectionBook implementation: `https://sepolia.arbiscan.io/address/0x65910b3d16cD79c82B9FDC5f1c62C712Fe18F88C#code`
- MerchantSeriesRegistry proxy: `https://sepolia.arbiscan.io/address/0x03dBEE1f231A29b06032aa24D2CFb96a1321C1A6#code`
- MerchantSeriesRegistry implementation: `https://sepolia.arbiscan.io/address/0x59B2869C51cc555734845DF9eb3bDFb5Fc6f1E81#code`
- MerchantSeriesPublisher proxy: `https://sepolia.arbiscan.io/address/0xB0EC5ca70a9AeCaeb260FdCDF238a64Ad37F5515#code`
- MerchantSeriesPublisher implementation: `https://sepolia.arbiscan.io/address/0xC76F735c59CAa54B2a3bea79010Fc934E206b393#code`

## ABI Paths

Use implementation ABIs for proxy calls.

| Contract | ABI JSON path |
| --- | --- |
| `DOUDOCOIN` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/DDOUDOCOIN.sol/DOUDOCOIN.json` |
| `DoudoVRFRouter` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/DoudoVRFRouter.sol/DoudoVRFRouter.json` |
| `DOUDOCHAINV2CoreUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/DOUDOCHAINV2CoreUpgradeable.sol/DOUDOCHAINV2CoreUpgradeable.json` |
| `DoudoSeriesOpsModuleUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/modules/DoudoSeriesOpsModuleUpgradeable.sol/DoudoSeriesOpsModuleUpgradeable.json` |
| `DoudoBundleModuleUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/modules/DoudoBundleModuleUpgradeable.sol/DoudoBundleModuleUpgradeable.json` |
| `DoudoRefundModuleUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/modules/DoudoRefundModuleUpgradeable.sol/DoudoRefundModuleUpgradeable.json` |
| `DoudoRedrawModuleUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/modules/DoudoRedrawModuleUpgradeable.sol/DoudoRedrawModuleUpgradeable.json` |
| `DoudoCollectionRewardModuleUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/modules/DoudoCollectionRewardModuleUpgradeable.sol/DoudoCollectionRewardModuleUpgradeable.json` |
| `CollectionBookUpgradeable` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/CollectionBookUpgradeable.sol/CollectionBookUpgradeable.json` |
| `MerchantSeriesRegistry` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/MerchantSeriesRegistry.sol/MerchantSeriesRegistry.json` |
| `MerchantSeriesPublisher` | `/Users/angustsai/ICHICHAIN_CONTRACT/artifacts/contracts/MerchantSeriesPublisher.sol/MerchantSeriesPublisher.json` |

## Chainlink VRF

Configured on both `DoudoVRFRouter` deployments. Keep both Router addresses as
Chainlink subscription consumers while Core and Redraw use separate routers.

| Field | Value |
| --- | --- |
| Core VRF consumer | `0x48A1205c9b6BF1Da1a3D1bE651A9e237AC349Eb5` |
| Redraw VRF consumer | `0x5A59D45437559C7CE0A012630a456321180C21e1` |
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
| SeriesOps five-minute-lock implementation deployment (block `289143188`) | `0xe4b1cd1180589eaba234b2f02c47252bb8ddfebd3d47cc4fa53f885b4bf40edf` |
| SeriesOps five-minute-lock proxy upgrade (block `289143220`) | `0xfcd2039a763b37a00296eb1f26b40aecb14a99b8d085851cf8786a88dc4aeaa1` |
| SeriesOps set default lock to 300 seconds (block `289143242`) | `0x2609bdf62837becaa5ae2812646aba527acb91aec4bc2fe8bec1447b3c9ea34a` |
| Redraw atomic batch implementation deployment (block `289143470`) | `0x46976bcd8547ffe52b70b19d7c026686ac35c568691128f28303e556f8819d04` |
| Redraw atomic batch proxy upgrade (block `289143498`) | `0x03b07d393a70835d8d08df08b1a71ebb7a624e3b7c04c5b5ba8960c2336b10b8` |
| Security-hardening Core implementation deployment (block `286422420`) | `0x6e453135384cf9c4fe5eccb73842f3d778f7c695684dbdf8ada6c7088a82d9d6` |
| Security-hardening Core proxy upgrade (block `286422442`) | `0xd79ab03359616e5abaa35a7442454704b9007e78c710f499e74274acb14bdce1` |
| Security-hardening CollectionBook implementation deployment (block `286422474`) | `0xeb66b856a11e9d43f85f0c22860d0d5dcb80f76abfe245af9254729452bc82de` |
| Security-hardening CollectionBook proxy upgrade (block `286422500`) | `0x34c13533e2351fc14e03e9d3f24a786971157a8de7a0d5c29db10674233dec34` |
| Core pause before security upgrade | `0x0e9cf694028312a448ef3a67623fda64dcc2715c3077d60808bf8cbfa28df9a2` |
| Core unpause after security upgrade | `0x3574265e48be5c99d3e8493795fc260b22be9ec6ea546f16bfc87ec795fa7efc` |
| Core source-tag implementation deployment (block `282585997`) | `0x41ab85295e8a0e2f3a3236b96c819fa34c4ca2ce6b66f0bd54b37b903b9bb5b6` |
| Core source-tag proxy upgrade (block `282586025`) | `0x4ffd0a9c1887fe72be3a9ab5a5a22247e40a291ee56076e34c01984e3bcb413f` |
| MerchantSeriesPublisher source-tag deployment (block `282586258`) | `0x1b52d302305e6734cabaa2bdadea15db99b35f2d0d45052b55ba5df85a1090cb` |
| Grant Core `OPERATION_ROLE` to source-tag Publisher (block `282586283`) | `0x6414137388d76051395bf4db1106162242a6c5f482d5eadbcd388bd3b280f224` |
| Grant Registry `LINKER_ROLE` to source-tag Publisher (block `282586298`) | `0x90d0ae3bb376b911d3b915a576e137b5acf0d5756f899502c9bbefb494e7ca54` |
| MerchantSeriesPublisher UUPS implementation deployment (block `282588572`) | `0x767be07c18d617f5e95f79a4ea5f9e0fa0024cfb23cc3d28f129342cfd0ffa82` |
| MerchantSeriesPublisher UUPS proxy deployment (block `282588588`) | `0x28f13e410378eaab365a8b08d96a12a7631c8e96cad3b8c06762ce338ed7137d` |
| Grant Core `OPERATION_ROLE` to UUPS Publisher (block `282588613`) | `0xfcad3f98673349668c4a6c6e7fe22b03299cd688a311b37f2029c265c6d8d13c` |
| Grant Registry `LINKER_ROLE` to UUPS Publisher (block `282588630`) | `0x45513c4107c1edda922feab5fc427cbf1a33b28a41d6a7c66f9f7b8e84a5e2fa` |
| Revoke Core `OPERATION_ROLE` from legacy Publisher `0x259F...972d` (block `282588654`) | `0x5f6a7444357cbac0e5b7a1b33a14556fcba75814157161e5dfbc04bfad6f6a37` |
| Revoke Registry `LINKER_ROLE` from legacy Publisher `0x259F...972d` (block `282588673`) | `0x2ca37dc352757f532888f795aefd42cdc2e5e35a1ddecdcfa97a6f9f166b69d9` |
| Revoke Core `OPERATION_ROLE` from plain source-tag Publisher `0x7E78...1C0a` (block `282588882`) | `0xd54423be8f3f71ce2dbb0d7e537c78154829f93dfa8663771392fd1932f7c875` |
| Revoke Registry `LINKER_ROLE` from plain source-tag Publisher `0x7E78...1C0a` (block `282588918`) | `0x4b63d42875c7dbbe0012e99cea29c5e94df0aed1bd360b764bee4ec077a8603a` |
| Core implementation deployment (block `281555036`) | `0x7be06d283b7127060dfac892800a6dd2e139d2479bc13dad03293164e46b59cc` |
| Core proxy upgrade (block `281555065`) | `0x1a7e8b88c202d807b10478109a08480db29a01dd883cfce2d32ce3e81243b576` |
| Bundle implementation deployment (block `281555179`) | `0xb9c755f58991a5186d8522f58d0341e75e85ce47d48762dbc5bd40db597ffeac` |
| Bundle proxy upgrade (block `281555204`) | `0x5a506ec3d5e175c6102c7349f3ed98c7b37878561f131e2a3b2f302fd215fc49` |
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
| Core VRF Router | `0x48A1205c9b6BF1Da1a3D1bE651A9e237AC349Eb5` | Core reveal request and fulfillment status |
| Redraw VRF Router | `0x5A59D45437559C7CE0A012630a456321180C21e1` | Redraw request and fulfillment status |
| Bundle Module | `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` | Ticket quantity mints and floor-tier rebates |
| Refund Module | `0x8ee19238DAa466B7792BE33569c6E4f6993CCf20` | Refund config and claims |
| Redraw Module | `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` | Redraw config, synchronous redraw mints, consolation requests |
| Collection Reward Module | `0x680618a6933DD68fF84Ff9F64760120d27400B3C` | Collection reward config, reward mints, unlock events |
| CollectionBook | `0x4284be399cA9591fBd98248969fCcb969E21B2C6` | Book definitions, deposits, withdrawals, claims |
| MerchantSeriesRegistry | `0x03dBEE1f231A29b06032aa24D2CFb96a1321C1A6` | Merchant attribution link/relink events; start block `277513499` |

Core keeps the legacy-compatible event names: `NewSeries`, `NewSubPrize`, `NewTicketStatus`, `RevealDrawSent`, `RevealDrawFulfilled`, `UpdatePrize`, `UpdateTicketStatus`, `UpdateSeriesInformation`, `UpdateSeriesRemainingTicketNumbers`, `LastPrizeDraw`, `LastPrizeWinner`, `UpdateSeriesLastPrizeOwner`, and `AdminMinted`. `NewTicketStatus` now includes `uint16 luckyNumber` as the seventh parameter.

Heavy on-chain aggregate readers are intentionally absent from the split Core: `doudoSeries`, `seriesURIs`, `getSubPrizesDetail`, old token-list pagination, and owner-list pagination should come from The Graph/events. Direct single-ticket reads remain available through `ticketStatusDetail(tokenID)`, `pointsPaid(tokenID)`, `ownerOf(tokenID)`, and `tokenURI(tokenID)`.

See `/Users/angustsai/ICHICHAIN_CONTRACT/docs/subgraph-v2-upgradeable-query-mapping.md` for schema/query mapping.

Current Studio version: `rebate-tiers-20260627`

```text
https://api.studio.thegraph.com/query/79631/doudochain-arb-v-2/rebate-tiers-20260627
```

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
| Core Router `0x48A1...9Eb5` | requester | Core proxy `0xf75395A8cd753f47135cfcaE00D2706252c3E0F5` |
| Redraw Router `0x5A59...21e1` | requester | Redraw proxy `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` |
| Bundle | redraw module | `0xE75461828f41C890fbc811e7cABFe2143B3F4afE` |
| Redraw | bundle module | `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6` |
| CollectionReward | collection book | `0x4284be399cA9591fBd98248969fCcb969E21B2C6` |
| CollectionBook | reward target | `0x680618a6933DD68fF84Ff9F64760120d27400B3C` |
| Core | `OPERATION_ROLE` | MerchantSeriesPublisher `0xB0EC5ca70a9AeCaeb260FdCDF238a64Ad37F5515` |
| MerchantSeriesRegistry | `LINKER_ROLE` | MerchantSeriesPublisher `0xB0EC5ca70a9AeCaeb260FdCDF238a64Ad37F5515` |
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
setSeriesRebateTiers(uint256 seriesID, RebateTierInput[] tiers)
mintTickets(uint256 seriesID, uint16[] luckyNumbers, bool revealImmediately)
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
BundleRebateTierConfigured(uint256,uint256,uint256,uint256)
BundleRebateTiersCleared(uint256)
TicketPurchaseMinted(uint256,address,uint256,uint256,bool,uint256)
TicketPurchaseRebatePaid(uint256,address,uint256,uint256)
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
DRY_RUN=true npx hardhat run scripts/upgradeCoreAndBundleArbSepolia.ts --network arbitrumSepolia
npx hardhat run scripts/upgradeCoreAndBundleArbSepolia.ts --network arbitrumSepolia
```

The script validates and upgrades Core, Bundle, and Redraw together. A real run pauses all three proxies before the first upgrade and only unpauses proxies that it paused after every wiring assertion passes.

Verification script:

```bash
npx hardhat run scripts/verifySplitModuleArbSepolia.ts --network arbitrumSepolia
```

Merchant attribution deploy + role wiring:

```bash
npx hardhat run scripts/deployMerchantAttributionArbSepolia.ts --network arbitrumSepolia
```

After deployment:

1. Monitor Studio version `rebate-tiers-20260627` until it reaches the Core and
   Bundle upgrade blocks without indexing errors.
2. After a Publisher publish succeeds and indexes, revoke Core
   `OPERATION_ROLE` from direct human/backend publish wallets so series creation
   must go through the Publisher.

## Verification Snapshot

Latest local verification after this upgrade:

```text
npx hardhat compile
OK

npm test
128 passing
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
DOUDOCHAINV2CoreUpgradeable: 24,201 bytes
DoudoBundleModuleUpgradeable: 6,919 bytes
DoudoRefundModuleUpgradeable: 5,660 bytes
DoudoRedrawModuleUpgradeable: 9,459 bytes
DoudoCollectionRewardModuleUpgradeable: 6,205 bytes
CollectionBookUpgradeable: 10,837 bytes
DoudoVRFRouter: 2,999 bytes
```

TypeScript note: `npx tsc --noEmit --pretty false` still reports pre-existing Hardhat/TypeChain inference errors in older deploy scripts. The latest upgrade script has no reported TypeScript error in that run.

Explorer verification note: the security-hardening Core implementation
`0x69Cba537C085BA7D9242C71c434F4cD0F81d4311` and CollectionBook implementation
`0x65910b3d16cD79c82B9FDC5f1c62C712Fe18F88C` are verified on Arbiscan. The
split-module wiring check passed after both upgrades, and Core was unpaused.
