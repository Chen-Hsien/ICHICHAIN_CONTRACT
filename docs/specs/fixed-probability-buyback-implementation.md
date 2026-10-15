# 固定機率回收實作交接（2026-10-15）

本文件已依使用者最新要求改為 **UUPS 可升級版本**，取代先前一般合約的新部署方案。第 1～8 節保留部署前實作交接；最新部署結果以第 9 節為準。

本文件對應 [回收規格](/Users/angustsai/.codex/worktrees/fixed-probability-buyback/ICHICHAIN_CONTRACT/docs/specs/fixed-probability-buyback.md)。程式已在五個隔離 worktree 實作；前端與 Admin 沿用現有回收介面。這是待部署的實作，尚未發送鏈上交易、部署 subgraph、修改遠端環境或啟用回收。

## 1 程式位置與基準

所有 worktree 分支為 `codex/fixed-probability-buyback`，原始工作目錄的未提交變更未移動或覆寫。

| Repo | Worktree | 實作基準 |
| --- | --- | --- |
| Contracts | `/Users/angustsai/.codex/worktrees/fixed-probability-buyback/ICHICHAIN_CONTRACT` | origin/dev `532552840e8111d2c876992da771a115af49f21c`，另依規範同步 origin/main，merge HEAD `eba9715f117252a8797060c592ae9e9b719fbbae` |
| Backend | `/Users/angustsai/.codex/worktrees/fixed-probability-buyback/backend` | origin/develop `a81e1debeb76ce70cfe50f0e7a7de0619428126d` |
| Admin | `/Users/angustsai/.codex/worktrees/fixed-probability-buyback/admin` | origin/develop `7011abaa2cda402ffa150156cd14daf85ad6f84e` |
| Frontend | `/Users/angustsai/.codex/worktrees/fixed-probability-buyback/frontend` | origin/dev `a990b973215ab6a35f088da67a084e755dbc829d` |
| The Graph | `/Users/angustsai/.codex/worktrees/fixed-probability-buyback/graph` | origin/develop `be682ba287a9e85d96d8a10cc80fc5da18796156` |

## 2 已實作行為

- 新增 UUPS 可升級的 `FixedProbabilityLotteryV3Upgradeable`（ERC1967Proxy），原生接受既有回購 tuple／EIP-712 協議，檢查本人持有、揭曉、未兌換、批次及簽章後真正 burn。完整 `Transfer` 在 `PrizeBuybackBurned` 前發出，整批原子回滾。使用獨立 `BUYBACK_AUTHORIZER_ROLE`。
- 原始 Draw、Order、抽數、會員消費與兌換紀錄保留；回收不建立替代 NFT、不回補抽數、不新增會員消費。
- `initialize(router, signer, operator, membership, initialAdmin, upgrader)` 明確設定依賴與角色，ID 從 1 開始；implementation 鎖定初始化，Proxy 不可重複初始化。UPGRADER_ROLE 獨立於 mint signer／回購 signer，保留 storage gap。
- 固定連結三個 library：FixedProbabilityConfigValidation、FixedProbabilitySettlement、FixedProbabilityBuybackValidation。結算 library 使用 guarded 核心傳入的 storage references，保留對外呼叫與事件順序；更換 library 需換 implementation 並重新驗證。
- 核心 implementation 24,014 bytes、測試 V2 24,247 bytes，均小於 24,576。沿用 Solidity 0.8.20、viaIR、optimizer runs=0、bytecodeHash=none。大小測試針對 implementation 執行；Proxy 很小不代表 implementation 可部署。
- 新增只讀 artifact 交接命令 `npm run prepare:fixed-probability:uups`，輸出 initializer、ABI SHA256、storage layout SHA256、三個 library link references 及大小；不發送部署或升級交易。輸出已保存於 `deployments/fixed-probability-uups-artifact.json`。
- Backend 以 `(chainId, contractAddress, tokenId)` 識別 NFT，同號 Core／固定機率資產分開處理。新請求為 `assets`；舊 `tokenIds` 僅解析成 Core。整筆最多 50 張，同鏈按部署分批。
- 每個原生部署核對 RPC 鏈別、Proxy runtime hash、ERC1967 implementation slot／實作 codehash／UUID、協議版本、回購 signer 角色與時鐘；報價和簽章前以 canonical Graph snapshot 及鏈上狀態確認所有權、揭曉、掛單、商家期限與 metadata。
- `NftFundingOrigin` 將歷史固定機率購買映射到原買家的唯一 SPEND，不改寫既有 ledger。核對鏈上購買事實、已完成的 DB order、reservation、原始估值與逐 NFT 分攤。轉手後仍使用原買家的來源與匯率。
- 新購買 SPEND 寫入 `coreAddress`／`fundingTokenPrices` 相容欄位與可用的商家歸屬；保留既有欄位。分攤完全使用整數，餘數依 tokenId 遞增分配。
- 接受報價與其他兌換沿用共用 claim；先接受但 KMS 尚未完成的恢復路徑，在重新簽章前再次檢查部署、價格、權益、期限與來源計畫。
- 回收沿用既有 receipt verifier、應付保存、Points 入帳、權益移轉及庫存配置釋放。銷毀後暫時無法入帳會保留應付；重試不重複發點。入帳後另以已知 block anchor 稽核 canonical 證據，異常進 `NEEDS_REVIEW`，保留已發點紀錄。
- 前端沿用回收頁、卡片、確認、交易進度與歷史；勾選、去重與送出改用完整 AssetRef。Admin 沿用逐獎價格面板；不具能力的部署不能設定有效回收價。
- Graph 接受固定機率 burn 及 Upgraded，維持 Proxy／NFT entity 身分，另存可變的 Proxy implementation 狀態；保留歷史並從可用清單排除；可按完整部署證據加入新原生合約與市場掛單資料源。

## 3 資料與相容性

新增 migrations：

1. `20261015000000_fixed_probability_buyback`：批次來源／部署及估值計畫、item 檢查快照／來源 hash、`NftFundingOrigin`。
2. `20261015000100_buyback_canonical_review`：`reviewReason`。
3. `20261015000200_buyback_quote_snapshot`：`quoteSnapshotJson`，保存實際雜湊輸入，可由受權後端重新 canonicalize 驗證 `quoteHash`。

原有批次來源預設為 Core；舊 quote、簽章、moduleAddress 不重算。新 quote 的 schemaVersion 為 `fixed-probability-buyback-quote-v1`；完整雜湊輸入包含各組 scope、逐獎報價與期限、itemsHash、原始來源及估值計畫。整數 raw 值保存成字串，以 canonical JSON UTF-8 計算 keccak256。原始 canonical 快照含內部權益資料，不放進買家回應；買家既有權益隱私過濾保留。

實際欄位對應：規格中的來源證明保存在 `NftFundingOrigin.snapshotJson`，item 保存 `fundingOriginHash`；估值計畫及其 hash 保存在 `valuationPlanJson`，資格／期限／鏈上購買快照保存在 `inspectionSnapshotJson`。不將 caller 提供的來源分類或估值當成可信證據。

## 4 預設停用與啟用順序

`FIXED_PROBABILITY_BUYBACK_DEPLOYMENTS` 預設為 `[]`。Graph 的原生回購部署清單也為空；現有地址與起始區塊未修改。

啟用前需依序完成：

1. 先取得另外授權，才可部署三個 library、implementation、UUPS Proxy 並原子初始化。分別保存 Proxy／implementation deployment receipt、chainId、地址、startBlock、runtime hash、ABI SHA256、storage layout SHA256、library link references 與 library runtime hash。回購 signer 角色需另外授予，不因 mint signer 自動取得。
2. 依既有跨 repo 部署交接流程同步 mint／read／reveal／exchange 等固定機率部署 artifact。本次未假設新部署地址，也未將既有 V3 的部署常數改成測試地址。
3. 設定 Graph 部署證據並部署新 schema／mapping，等待重新索引完成。`burned` 是新增必要欄位，Backend 新查詢須在新 Graph schema 可用之後才上線。
4. 若該鏈有平台市場，原生部署證據須提供 `marketplace` 的地址、startBlock、transactionHash、runtimeHash，讓 manifest 從已核對的部署起點索引掛單。部署工具會核對 receipt 與 bytecode。現行基礎 manifest 沒有啟用市場，因此不能用空查詢結果宣稱「沒有掛單」。
5. 套用三個 DB migrations，更新 Prisma client；先更新 API 與所有回收恢復 worker，停用／排空舊 worker，再允許產生新固定機率批次。不要讓舊 worker 與新型批次混跑。
6. 將同一部署加入 Backend registry，填入 Proxy 的 runtimeHash／startBlock、protocolVersion=1、proxyKind=uups、implementationAddress／implementationRuntimeHash；核准的舊實作保留在 approvedImplementations。市場索引實際覆蓋且與部署證據一致後才設定 `marketplaceIndexReady=true`；有市場但尚未確認覆蓋時，能力檢查回 `BUYBACK_MARKETPLACE_INDEX_PENDING`，不產生簽章。
7. 執行實際 RPC／Graph／KMS／Privy／錢包及 worker smoke，再開啟 registry `enabled` 與逐獎政策。停用新簽章時保留舊部署紀錄；既有應付恢復不依賴新簽章啟用狀態。

上述步驟是交接要求，尚未在遠端執行。

## 5 仍須產品決策的資產

- **D-01：既有不可升級 V3 NFT。** 舊地址沒有 burn 接口，不能透過加角色或設定偽裝成支援。介面保留不支援提示，持有及實體兌換流程保留。這批資產若也要回收，必須先選定遷移或其他經審核方案。
- **D-02：零淨消費／已免單退款／來源不完整。** 簽章及銷毀前以 `BUYBACK_VALUATION_SOURCE_PENDING` 阻擋，清單回報待確認原因。尚未制定的財務規則不自行推定為零成本或現行匯率。

## 6 驗證範圍

驗證使用隔離 PostgreSQL，套用現有完整 migration 歷史與本次 migrations；RPC、Graph 及 KMS 使用測試替身。合約測試使用本地 Hardhat；不代表已通過實際部署環境驗收。

| 範圍 | 驗證 |
| --- | --- |
| Contracts | 25 項：新回收、原 V3、舊回購回歸；包含 domain、角色、重放、原子回滾、期限、50 張、大小library 行為對照、初始化、權限、Proxy 升級、storage layout、舊 ABI 形狀及未到期簽章延續 |
| Backend 單元／協議 | 125 項通過；另 1 項真實 Redis runtime 測試未執行。資產隔離、registry／runtime／角色／時鐘／市場覆蓋、cursor 綁定、canonical／EIP-712 規格向量、來源投影與既有回購／估值回歸 |
| PostgreSQL 回收 | 15 項：新固定機率與舊 Core；含轉手來源、免單阻擋、接受後簽章恢復、精確快照 hash、未知 implementation 阻擋與核准升級後關閉簽章仍可恢復、入帳失敗重試、庫存與權益、入帳後 reorg 待核 |
| PostgreSQL 原購買 | 44 項：原固定機率購買、折扣、退款、恢復與估值回歸；另驗證新增 funding metadata 完整形狀 |
| Frontend／Admin | 29／18 項；沿用現有介面，同 tokenId 跨合約的勾選及送出隔離、不支援部署提示與價格阻擋 |
| The Graph | 固定機率 23 項、掛單 1 項、部署安全 23 項；test／prod codegen 與 build |

已執行 TypeScript 檢查、Backend 本次變更檔 lint 與各 repo `git diff --check`。未進行前端／Admin production build、瀏覽器視覺驗收、真實 Redis 多程序重啟、真實 RPC／Graph／KMS／Privy smoke 或任何鏈上部署。規格 T-01～T-35 仍須在實際新部署完成最後整合驗收；不能把本地測試標為全量上線通過。

## 7 重跑驗證

在各自 worktree 執行；DB 測試必須指向隔離資料庫，不能使用正式資料庫。先建立測試用 DB、套用 migrations 並 generate Prisma client。部署清單維持空值即可執行單元測試，不需要真實私鑰。

Contracts：

```sh
npx hardhat compile
npx hardhat test --network hardhat test/fixed-probability-buyback.test.js test/fixed-probability-v3.test.js test/prize-buyback.test.js
```

Backend：

```sh
npx tsc --noEmit
npx jest --runInBand --no-watchman apps/api/src/buyback apps/worker/src/fixed-probability packages/db/src/prize-buyback-origins.spec.ts packages/config/src/buyback-deployment.spec.ts packages/contracts/src/prize-buyback.spec.ts packages/graph/src/fixed-probability/client.spec.ts packages/shared/src/points-valuation.spec.ts
```

設定 `BUYBACK_TEST_DATABASE_URL` 為隔離的本機 `buyback_test` 資料庫後，執行：

```sh
npx jest --runInBand --no-watchman packages/db/src/fixed-probability-buyback-postgres.spec.ts packages/db/src/prize-buyback-settlement.spec.ts
```

設定 `TEST_FIXED_PROBABILITY_DATABASE_URL` 為隔離測試 DB 後，執行原購買回歸測試；此 suite 自行建立、移除隨機 schema：

```sh
npx jest --runInBand --no-watchman apps/api/src/fixed-probability/repository.postgres.spec.ts
```

Frontend：

```sh
npx tsc --noEmit
npx jest --runInBand --no-watchman app/hooks/buybackTypes.test.ts app/components/exchange/BuybackPanel.test.tsx app/lib/fixed-probability/content.test.ts
```

Admin：

```sh
npx tsc --noEmit
npx vitest run src/features/admin-console/buyback-series-detail.test.tsx src/features/admin-console/buyback-roundtrip.test.tsx src/lib/doudo-admin-api-fixed-probability.test.ts
```

The Graph：

```sh
npm run test:deployment
npm test -- fixed-probability
npm test -- buyback-marketplace
npm run build:test
npm run build:prod
```

## 8 後續 Proxy 升級交接

每次升級先以同一編譯條件產生新 artifact，執行 `upgrades.validateUpgrade`，重新核對全部 library、ABI／storage layout 與 code size。部署及實際 upgradeTo／upgradeToAndCall 仍需另外明確授權。

所有買家與 Graph 操作維持 Proxy 地址；Backend registry 的 runtimeHash 指 Proxy，implementationAddress／implementationRuntimeHash 指當前核准實作。舊未簽 quote 若遇版本變動需重新報價；已簽的授權使用同一 Proxy domain，可在相容升級後於原 deadline 內執行。Recovery 讀取 receipt block 的實作，可接受保存快照或當前／歷史核准實作；未核准實作進 NEEDS_REVIEW，核准與恢復需營運審核，不能因地址相同就直接入帳。

`unsafeAllowLinkedLibraries` 僅針對固定連結 library 的人工驗證要求；不使用 unsafeSkipStorageCheck。測試故意插入錯誤 storage 的 implementation 會被 OpenZeppelin 拒絕。測試 V2 僅作本地驗收，不作正式部署目標。

既有 constructor V3 的部署與資產未更動，也不能透過本次 Proxy 方案原地升級。未進行真實鏈上部署、角色設定、Proxy 升級、遠端 Graph 發布或正式環境驗收。

## 9 staging 實際部署結果（2026-10-15）

- Chain：Arbitrum Sepolia，421614。Proxy：`0x51a9f7f467498fee72eFBe37043897A3c225F235`；部署區塊 `319353178`，交易 `0x22ec35535f7e054ce484f5dfb17524e9974ce61d2b122eabce89cd6ebe629aea`。
- Implementation：`0x0213973159DC44e9AfDB04eeD6a9e4f8F42d8975`，runtime 24,014 bytes。三個 library、全部 receipt／runtime hash、角色設定交易與驗證結果保存在 `deployments/fixed-probability-uups-arbitrum-sepolia.json`；OpenZeppelin manifest 已登記新 Proxy。
- 原子初始化的 admin／UPGRADER_ROLE 為既有部署帳戶 `0x226f0197D502e7AC87d1A76D6526945DFa9E4209`；operator、authorizationSigner、membership、router 沿用舊 V3 已驗證設定。獨立 BUYBACK_AUTHORIZER_ROLE 已授予目前後端 Points signer。舊 V3 requester／會員角色與 5 個系列不修改。
- 已在真實 RPC 檢查 Proxy／implementation slot／UUID／runtime／角色、mint EIP-712 domain；buyback digest 與離線 EIP-712 計算一致，protocolVersion=1、MAX_BATCH=50、未消耗測試 batch。這些探測均為唯讀，沒有建立測試系列或銷毀 NFT。
- Proxy 與 implementation 在 explorer 均已驗證並完成 proxy 連結。
- Graph PR：https://github.com/Chen-Hsien/DOUDOCHAIN_SUBGRAPH/pull/12，已合併 develop，CI 通過。發布版本 `3.0.0-uups.20261015`，Deployment ID `QmeDYe4ioB7JqV5b5pHdfGD42kMpAA2kyfiG5AsC5SxN2z`，實際 Git SHA `2871551ddda323c95ca2eb8bdb9e7ed40d3bde00`。
- 新 Graph query：https://api.studio.thegraph.com/query/79631/doudochain-arb-v-2/3.0.0-uups.20261015。初次查核無 indexing errors，但高度仍為 271876628，完整歷史重建尚未追上。此版新增必要 burned 欄位及市場歷史，未使用 graft。
- 完整 Graph 發布快照與驗證紀錄保存在 `../graph-staging-release/.deployment-history/test/2026-10-15T08-00-43-663Z-6d4f8e56-c2af-47ff-8d71-2201180a9e61/`。
- Backend、Frontend、Admin 的程式部署常數與 proof metadata 已改為新 Proxy；Admin 同步由 V2 ABI/domain/type 改為 V3。Backend 買家就緒檢查與 proof RPC 檢查新增 implementation 核對，拒絕只沿用相同 Proxy codehash 的未知升級。
- Backend 公開 staging 設定在 `../backend/config/fixed-probability-uups-staging.env` 與 `../backend/config/fixed-probability-buyback-staging.json`，兩個 Render 服務 Blueprint 的 Proxy／startBlock 已同步，啟用旗標保留 false。
- 尚未修改 Render 遠端環境、部署 API／worker／前後台網站或套用遠端 DB migrations；目前缺少 Render 管理憑證。新索引追上、API／worker 同版與 DB migrations、實際 KMS／Privy／Redis／錢包流程驗收後，才能啟用固定機率回收。
- 本輪驗證：原合約 25 項＋部署等待恢復 4 項；Backend 227 項通過、82 項依整合環境條件略過；Frontend 63 項；Admin 55 項；Graph 68 項 Matchstick＋43 項部署＋8 項 parity，test/prod 建置及 GitHub CI。三個應用 TypeScript 檢查及部署腳本型別檢查通過。未執行前後台 production build／瀏覽器驗收。

## 10 使用者確認的舊 V3 退場範圍（2026-10-15）

使用者指示：「暫停舊系列甚至移除都可以，沒有兼容的必要」。本次採停用舊系列營運並切換 active address，不新增雙部署相容、舊歷史或舊 NFT 產品路由。舊鏈上 NFT、DB / ledger 稽核資料保留，切換前先停新 quote／簽章並驗證沒有 HELD 點數或未完成帳務；存在 pending 先排空，不能刪除來繞過。前述要求全面保留舊產品流程的驗收部分由這份使用者決策取代。

Backend PR #139 已有 A1～A3 修正與局部複查；B1 依範圍變更記錄為 accepted scope change，須對最終完整 diff 做新上下文雙 reviewer 檢查及當前 head CI，才整合發布。Render 已可用登入的 Chrome，不需 API token；已建立公開 UUPS staging 群組，尚未連結服務。本輪 Mac 鎖定，等待手動解鎖後繼續 Dashboard；未完成步驟以 Backend runbook 的實際狀態為準。
