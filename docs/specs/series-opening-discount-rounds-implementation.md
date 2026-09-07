# 系列優惠多輪實作與部署交接

日期：2026-09-07。對應規格：`series-opening-discount-rounds.md`。

## 實作結果

| 層級 | 已完成內容 |
| --- | --- |
| Contracts | SET 僅允許未設定、已關閉或已用完；新輪重設 used 並遞增 `openingDiscountRoundId`。CLEAR 保留本輪價格、名額與用量，只設 inactive。既有事件簽章不變，新增輪次事件與 getter。 |
| Backend | 固定區塊讀取鏈上 config、用量及可售供應；建立、預檢、enqueue 及 worker 真正送出前檢查。相同系列以 PostgreSQL advisory lock 序列化 workflow 建立，未完成操作阻擋下一筆。SET／CLEAR receipt 驗證合約地址與完整參數。 |
| Admin | 呈現鏈上狀態、每輪名額、用量、放棄數量、資料區塊及未完成 workflow；進行中禁止 SET，關閉提示剩餘名額失效。未取得鏈上狀態時禁止操作。 |
| The Graph | 新增 `roundId` 與 `OpeningDiscountRoundAdvanced` 索引；保留 CLEAR、SET、Applied 原有語義，並補輪次事件回放測試。 |
| Frontend | 保留既有計價方式，補上跨輪計價測試。收到 MINT_PRICE_CHANGED 時刷新商品資料並要求重新確認，不自動重試或提高買家金額。 |

### 實作細節與相容性

- 新 workflow 快照保存 **chain ID、proxy、series ID、區塊號、區塊 hash、round ID** 與 config。precheck 比較鏈上 round ID，一次合約讀取即可識別相隔很久或內容相同的新輪。升級前缺少 round ID 的既有 workflow 暫時沿用事件回查。
- 既有沒有快照的優惠 workflow 必須取消後重建，不允許直接補用當下輪次冒充原始意圖。已預備或已發送交易仍遵守原本 durable attempt／同 hash 恢復路徑，不重新建立下一輪操作。
- 目前狀態以鏈上 getter 與 Graph 為準，上架 metadata 保留建立時資料；Admin 不再把上架 metadata 當成目前輪次狀態。公開商品讀取既有 no-store Graph 路徑，SET／CLEAR 不需重建上架 metadata。
- Database points 新購買要求 `totalPrice` 作為買家接受的上限，後端在 holdPoints 與簽署之前驗證新報價。現有買家前端已傳此欄位；其他直接呼叫 mint API 的消費端亦須傳入。既有 intent 的冪等重取流程維持不變。
- 新增鏈上 round ID 作為受管 workflow 的輪次一致性依據；SET／CLEAR 的既有函式簽章保持不變，合約最終仍按交易順序與當下狀態執行。
- Backend round ID reader 已推送 develop；API／worker 的 Render 滾動部署需另以 runtime 版本確認。Admin／Frontend 本次無需新增程式變更。

## 已執行驗證

- Contracts：`hardhat test test/doudochain-v2-module-split.test.js`，31 項通過。涵蓋兩種 points 模式、多輪計價、舊授權／價格上限及捕捉／傳播回呼重入失敗。
- 完整 ABI 與精確 HEAD 原始碼的舊 build-info 比對一致；與 Graph ABI 全部 108 項比對一致。
- Backend：優惠 reader／workflow／receipt／金額上限及既有系列生命週期、發布同步、免單庫存等 7 個 suite，99 項通過。
- Admin：設定 builder 與系列畫面相關 22 項測試通過；原始碼 typecheck 及 scoped lint 通過。
- Frontend：計價及購買 hook 7 項測試通過；typecheck 通過。
- Graph：bundle Matchstick 測試 5 項通過；codegen 與 `build:test` 通過。
- Backend typecheck、scoped lint 與升級腳本獨立 typecheck 通過。
- Contracts 完整 TypeScript 檢查受既有 `contracts/deploy.ts`、其他部署腳本與不屬本次的網站檔案錯誤影響；本次升級腳本以獨立 tsconfig 驗證通過。Admin 完整 typecheck 有既有 `.next/dev/types/validator.ts` 指向已不存在任務路由的錯誤，排除產生的 dev cache 後原始碼檢查通過；未刪除使用者的開發快取。

## 部署結果

### Arbitrum Sepolia

### Arbitrum Sepolia round ID 升級（2026-09-07）

- Bundle proxy 維持 `0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6`。
- implementation：`0x17138341b4c823b0EFEeB30A0CafD20aa7244c13` → `0x7947317fb1D30cDc8A8C11c382f6D9f3c3DAcdB8`。
- 升級交易：`0xfdde9a05d37d942208bfacab19793bcbac64e44f233b9152e51f2934273bd6ac`，區塊 306110590，receipt status 1。
- runtime 22,505 bytes；storage layout、角色、wiring 驗證通過。
- 119 個既有系列的 config／used 均保持一致，沒有同區塊並行優惠事件；119 個 legacy round ID 初始化為 0。
- implementation 已在 Arbiscan 完成原始碼驗證。

- chain ID：421614。
- Bundle proxy：`0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6`。
- 升級前 implementation：`0x392D3A603B8421C3Dd92B553D71fE46A80b08C73`。
- 升級後 implementation：`0x17138341b4c823b0EFEeB30A0CafD20aa7244c13`。
- Core：`0xf75395A8cd753f47135cfcaE00D2706252c3E0F5`。
- 快照區塊：305761010；盤點 117 個系列。
- 升級交易：`0x54a66aa9bd809155aa5ffbafdc3f290a823d73959a1acd68d0a6801d92426e01`，區塊 305761574，receipt status 1。
- database points 模式已啟用；UPGRADER_ROLE、連線與 storage layout 驗證通過。
- 新 Bundle runtime：22,382 bytes，低於 EIP-170 的 24,576 bytes。
- 117 個既有系列的優惠 config／used 與全部 wiring 在升級前後一致，升級區塊沒有同時修改優惠的事件。
- 已在 Arbiscan 完成 implementation 原始碼驗證；排除 UUPS immutable address 後，鏈上 runtime bytecode 與本地 artifact 完全一致。
- 以 `eth_call` 驗證新行為：已用完的系列 57 可設定下一輪；尚有名額的系列 75 無法直接覆蓋，但可手動關閉。這些呼叫沒有送出交易，不會改變系列資料。

### Arbitrum One

- chain ID：42161。
- Bundle proxy：`0x0aDe18AD89B9971229d5E6588a76d4bEeAaE4b8f`。
- Core：`0x4749289F940F0C6B7cf68A19b0BDc611b80cdb0A`。
- 唯讀預檢在 `seriesMintConfig(0)` 實際回傳 64 bytes（兩欄位），目前分支預期 128 bytes（四欄位），解碼遇到 BAD_DATA，無法通過系列盤點。不得使用目前分支直接升級此 Bundle。
- 如指定正式網，需先確認鏈上既有 Core／Bundle 版本，選擇相容的最小變更回移方案；不能將其他未授權的 Core 或 database points 遷移一起部署。

### The Graph dev

- 從乾淨的 `develop` 部署至 `doudochain-arb-v-2`（Arbitrum Sepolia）。
- round ID 版本標籤：`ea05e2d`；IPFS deployment：`QmdcehTseCZEZcuaWPceZYCVLnR7B7AJC2PXxvnoT9Sf1k`。
- endpoint：`https://api.studio.thegraph.com/query/79631/doudochain-arb-v-2/ea05e2d`。
- 新版本已發布，會從既有 startBlock 回放；發布後初始 `_meta` 為 273178799、`hasIndexingErrors=false`，追趕完成後再驗證 series 118 的 `roundId=0`。
- proxy 地址及 startBlock 未變。

## 部署工具與限制

round ID 升級腳本：`scripts/upgradeBundleOpeningDiscountRoundIds.ts`，預設僅唯讀；只有 `EXECUTE_OPENING_DISCOUNT_ROUND_IDS_UPGRADE` 等於所選 chain ID 時才執行。腳本會先保存 checkpoint，驗證升級回執、implementation、wiring 與既有優惠資料；如有既存未完成 checkpoint，拒絕盲目重送。

Graph 的既有部署工具要求 test 從乾淨 develop、prod 從乾淨 main 發布。此次僅發布 test/dev；Arbitrum One 合約與正式 Graph 均未變更。Backend／Admin／Frontend 仍是本地實作，尚未部署或重啟。
