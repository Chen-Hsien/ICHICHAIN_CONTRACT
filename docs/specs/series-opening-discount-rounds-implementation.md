# 系列優惠多輪實作與部署交接

日期：2026-09-06。對應規格：`series-opening-discount-rounds.md`。

## 實作結果

| 層級 | 已完成內容 |
| --- | --- |
| Contracts | SET 僅允許未設定、已關閉或已用完；新輪重設 used。CLEAR 保留本輪價格、名額與用量，只設 inactive。兩個入口加入既有非重入 guard，ABI／storage 欄位不變。 |
| Backend | 固定區塊讀取鏈上 config、用量及可售供應；建立、預檢、enqueue 及 worker 真正送出前檢查。相同系列以 PostgreSQL advisory lock 序列化 workflow 建立，未完成操作阻擋下一筆。SET／CLEAR receipt 驗證合約地址與完整參數。 |
| Admin | 呈現鏈上狀態、每輪名額、用量、放棄數量、資料區塊及未完成 workflow；進行中禁止 SET，關閉提示剩餘名額失效。未取得鏈上狀態時禁止操作。 |
| The Graph | 已驗證現有 handler 的 CLEAR 保留資料、SET 歸零行為符合規格；增加部分使用後關閉、重開、用完直接重開與歷史保留的事件回放測試。完整 ABI 與編譯結果一致，不需改 schema。 |
| Frontend | 保留既有計價方式，補上跨輪計價測試。收到 MINT_PRICE_CHANGED 時刷新商品資料並要求重新確認，不自動重試或提高買家金額。 |

### 實作細節與相容性

- 待執行 workflow 的輪次防護採用建立時的 **chain ID、proxy、series ID、區塊號及區塊 hash** 與 config 快照。後續掃描快照之後的 Configured 事件，即使價格及名額完全相同也拒絕舊操作；另檢查快照是否發生鏈重組。此做法不用為了建立每筆操作回掃系列全部歷史；新輪的完整交易事件仍由 receipt／Graph 保存。
- 既有沒有快照的優惠 workflow 必須取消後重建，不允許直接補用當下輪次冒充原始意圖。已預備或已發送交易仍遵守原本 durable attempt／同 hash 恢復路徑，不重新建立下一輪操作。
- 目前狀態以鏈上 getter 與 Graph 為準，上架 metadata 保留建立時資料；Admin 不再把上架 metadata 當成目前輪次狀態。公開商品讀取既有 no-store Graph 路徑，SET／CLEAR 不需重建上架 metadata。
- Database points 新購買要求 `totalPrice` 作為買家接受的上限，後端在 holdPoints 與簽署之前驗證新報價。現有買家前端已傳此欄位；其他直接呼叫 mint API 的消費端亦須傳入。既有 intent 的冪等重取流程維持不變。
- 本期仍不新增鏈上 round ID，不能阻擋其他 OPERATION_ROLE 地址在受管 workflow 之外直接送出的跨輪操作；合約最終按交易順序與當下狀態執行。
- Backend／Admin／Frontend 本次為原始碼更新；尚未部署或重啟 API／worker／網站服務。

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
- 版本標籤：`4ac732533bd6132f0812cffb5f4b99483c401635`；IPFS deployment：`QmQ7ZnbKvJqTrNpfnRFPhrhuLxo9PMhnAuKzTvigcGD3FA`。
- endpoint 查詢成功，`hasIndexingErrors=false`，已索引至區塊 305762877，並可讀取既有 `SeriesOpeningDiscountConfig`。
- mapping 與 schema 原本已符合多輪事件語義，本次部署包含新增的事件回放測試，proxy 地址及 startBlock 未變。

## 部署工具與限制

升級腳本：`scripts/upgradeBundleOpeningDiscountRounds.ts`，預設僅唯讀；只有 `EXECUTE_OPENING_DISCOUNT_ROUNDS_UPGRADE` 等於所選 chain ID 時才執行。腳本會先保存 checkpoint，驗證升級回執、implementation、wiring 與既有優惠資料；如有既存未完成 checkpoint，拒絕盲目重送。

Graph 的既有部署工具要求 test 從乾淨 develop、prod 從乾淨 main 發布。此次僅發布 test/dev；Arbitrum One 合約與正式 Graph 均未變更。Backend／Admin／Frontend 仍是本地實作，尚未部署或重啟。
