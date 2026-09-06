# 系列優惠多輪設定與手動關閉規格

- 日期：2026-09-06
- 狀態：設計稿；三條業務規則已由需求方指定，技術方案供後續實作依循。
- 範圍：同一 series 的 opening discount 可於用完或手動關閉後重新設定。
- 原始交付：規格文件；後續實作進度與驗證請見 [實作與部署交接](series-opening-discount-rounds-implementation.md)。
- 原始碼基準：Contracts `0fbca28`，已執行 `git fetch origin main` 與 `git merge origin/main`，結果為 Already up to date。

## 1. 業務規則

1. 本輪用完：可直接設定下一輪。
2. 本輪尚未用完：先手動關閉，放棄剩餘優惠名額，再設定下一輪。
3. 本輪仍開啟且有剩餘名額：禁止直接覆蓋設定。

規則 3 同樣適用於已設定但使用數量為 0 的情況。這會改變舊版「尚未使用可直接覆蓋」的行為；需要修改價格或名額時，必須先關閉再設定。

新輪的 `ticketLimit` 是本輪名額，不是歷史累計上限，也不承接上輪剩餘名額。例：10 抽已用 3 抽，關閉後剩餘 7 抽失效；下一輪設定 5 抽，初始狀態為已使用 0／名額 5。

關閉只影響後續成交的優惠資格，不取消已成交訂單、不追回折扣、不變更既有 NFT 實付金額、退款依據或回饋。退款、訂單取消也不得新增「回補優惠名額」行為。

## 2. 現況與責任邊界

| 專案／本次檢視分支 | 既有依賴與責任 |
| --- | --- |
| Contracts `/Users/angustsai/ICHICHAIN_CONTRACT`；`codex/free-order-challenge-repair` | `contracts/modules/DoudoBundleModuleUpgradeable.sol`：設定、關閉、報價、使用計數及事件；合約擁有最終狀態與價格規則。 |
| Backend `/Users/angustsai/doudochain-backend`；`develop` | `packages/ops-workflow/src/index.ts`：SET／CLEAR workflow 與 receipt 驗證；`packages/graph/src/index.ts`：索引資料讀取。後端負責操作編排、訂單與資料同步。 |
| Admin `/Users/angustsai/doudo-admin`；`codex/free-order-challenge-repair` | `src/lib/series-operations-settings.ts`、`src/features/admin-console/series-details.tsx`：設定表單、驗證及 workflow 操作。 |
| The Graph `/Users/angustsai/thegraph/doudochain_amoy`；`develop` | `src/bundle.ts`、`schema.graphql`：事件索引、目前設定與不可變歷史事件。 |
| Frontend `/Users/angustsai/ichichain`；`dev` | `app/components/purchase/panel/openingDiscountPricing.ts` 與商品列表／購買畫面；`lib/backend/publicCatalog.ts`：買家價格、剩餘名額及結帳呈現。 |

目前合約在 `openingDiscountUsed != 0` 時禁止 SET 及 CLEAR。CLEAR 使用 delete 清除 config。Graph 則已在 Configured 時重設 `usedTickets = 0`，在 Cleared 時僅將 `active = false` 並保留數量與價格；前端以 active 與 `ticketLimit - usedTickets` 決定優惠。

本規格未核對實際 proxy／implementation、chain ID、部署區塊、RPC、Graph endpoint 或線上服務版本。上述分支是本地檢視基準，不代表已部署版本；本次不更動地址、環境變數或索引起始區塊。實作及部署驗收前必須另行確定目標部署。

## 3. 狀態模型

保留既有 storage 順序，在尾端 storage gap 前新增 `openingDiscountRoundId` mapping，並將 gap 由 30 調整為 29。既有系列升級後的目前輪次為 0；每次成功 SET 新輪時遞增。

- `seriesOpeningDiscounts[seriesID]`：目前／最近一輪的 `ticketLimit`、`priceInPoints`、`active`。
- `openingDiscountUsed[seriesID]`：目前／最近一輪已使用數量，**不是歷史累計使用數量**。
- 可用名額：`active ? max(ticketLimit - used, 0) : 0`。
- `active` 表示是否被手動關閉；用完可繼續保留 `active = true`，不可只看 active 判斷能否使用優惠。

| 狀態 | 判定 | SET 新一輪 | CLEAR |
| --- | --- | --- | --- |
| 未設定 | config 為預設值，active=false | 允許 | 拒絕 |
| 進行中（含完全未使用） | active=true 且 used < ticketLimit | 拒絕 | 允許 |
| 已用完 | active=true 且 used >= ticketLimit | 允許 | 允許，僅標記關閉 |
| 已關閉 | 曾設定且 active=false | 允許 | 拒絕重複關閉 |

正常購買應維持 `used <= ticketLimit`；使用 `>=` 判斷用完是避免剩餘數量計算 underflow，不代表允許正常路徑超用。

## 4. 合約介面與轉換

### 4.1 SET：設定第一輪或下一輪

沿用 `setSeriesOpeningDiscount(uint256 seriesID, uint256 ticketLimit, uint256 priceInPoints)` 及 `OPERATION_ROLE`。

執行順序：

1. 驗證系列可設定價格：沿用 Core `seriesMintConfig` 與 `basePriceInPoints != 0`；測試證明不存在的 series（預設零值或 Core revert）不能通過。
2. 驗證 `ticketLimit > 0`、`0 < priceInPoints < basePriceInPoints`。
3. 若舊 config `active && used < old.ticketLimit`，以 `InvalidConfig()` 拒絕，不變更任何 state。
4. 寫入新 config `{ticketLimit, priceInPoints, active: true}`。
5. 將 `openingDiscountUsed[seriesID]` 設為 0。
6. 發出既有 `OpeningDiscountConfigured(seriesID, ticketLimit, priceInPoints)`。

名額／價格驗證必須先完成，失敗不能破壞舊輪狀態。每次成功 SET 都是新輪，即使新舊價格與名額完全相同。

本次不在合約新增售出量或預留量耦合：優惠不是庫存，mint 的供應限制仍由既有 Core 路徑執行。Admin／Backend 預檢新名額不得超過當時可售剩餘抽數；此預檢不保留庫存，並行購買仍可能使實際可用優惠少於所設名額。

### 4.2 CLEAR：手動結束本輪

沿用 `clearSeriesOpeningDiscount(uint256 seriesID)` 及 `OPERATION_ROLE`。

1. 若 `!config.active`，以 `InvalidConfig()` 拒絕。
2. 僅設定 `config.active = false`。
3. 保留 `ticketLimit`、`priceInPoints`、`openingDiscountUsed`，不再 delete config。
4. 發出既有 `OpeningDiscountCleared(seriesID)`。

關閉後未用名額立即不可使用；保留數量僅用於檢視，不代表將來可恢復。沒有「恢復本輪」操作，再次 SET 一律建立新輪。先關閉、後 SET 是兩筆獨立成功交易；中間買家依原價與既有一般抽數回饋規則購買。

### 4.3 呼叫與購買安全

- SET 的外部讀取是 Core `seriesMintConfig`；CLEAR 無外部呼叫。SET／CLEAR 都必須使用既有 `nonReentrant` 保護，避免具有操作角色的合約在購買回呼期間切換輪次，造成計數與 Applied 事件錯置。
- 檢查 legacy points 的 `_mintTickets` 與 database points 的授權購買兩條路徑：優惠計數仍在 Core mint、points、VRF、Membership 等外部呼叫之前更新，失敗交易完整回滾。
- 報價依交易執行當下的 config 計算，本輪優惠超出部分採既有一般價格與回饋規則；優惠抽數不被重複計入一般抽數回饋。
- 保留 `mintTickets` 的 `PriceLimitRequired` 行為；重開優惠後不能以無價格上限的舊入口繞過價格保護。
- 不更動 `isPreOrder`、reveal 政策、錢包限額、供應、free-order challenge 或其他活動規則。

## 5. 事件、輪次歷史與 ABI

保留函式、getter、錯誤及下列事件簽章與參數順序：

```solidity
OpeningDiscountConfigured(uint256 indexed seriesID, uint256 ticketLimit, uint256 priceInPoints)
OpeningDiscountCleared(uint256 indexed seriesID)
OpeningDiscountApplied(uint256 indexed seriesID, address indexed buyer, uint256 openingQuantity, uint256 regularQuantity, uint256 openingPriceInPoints, uint256 grossPriceInPoints, uint256 rebatePoints)
```

新增 `OpeningDiscountRoundAdvanced(seriesID, roundId, ticketLimit, priceInPoints)`，同時保留既有 `OpeningDiscountConfigured` 簽章以維持 ABI 消費端相容。`roundId` 是 workflow 與 Graph 的權威輪次識別；receipt 仍保存 transactionHash 與 logIndex 供稽核。

歷史交易與不可變事件保留；目前狀態的 getter／Graph config 僅提供最近一輪。跨輪總用量必須由 Applied 歷史事件計算，不得再用 `openingDiscountUsed` 當累計值。若未來需要逐輪報表，應以 `(blockNumber, transactionIndex, logIndex)` 鏈上順序歸屬事件，另行設計索引欄位，不能只用時間戳排序；現有 schema 並未提供所有排序欄位。

重新編譯並同步 ABI，確認既有函式與事件簽章不變，新增 getter 與輪次事件的完整 shape。ABI 由 Hardhat artifact 產生，不手改。

## 6. Backend workflow 與資料同步

沿用 `SET_SERIES_OPENING_DISCOUNT` 與 `CLEAR_SERIES_OPENING_DISCOUNT`，不增加業務 workflow type。

1. 建立及執行前讀取鏈上 config／used，依狀態表驗證；設定價格與 series 原價採既有 points 單位轉換。管理 API 提供狀態、used、有效剩餘名額及資料來源／更新位置，不能僅依上架 metadata 判斷。
2. 同一 chain、bundle proxy、series 的優惠操作序列化；CLEAR 確認成功後才容許發送下一筆 SET。一般買家成交仍以鏈上執行順序為準。
3. 每個新輪用獨立 workflow／冪等識別。重試同一 workflow 必須先查原交易結果；不得因逾時重新建立新的 SET，以免在之後的已用完狀態意外多開一輪。
4. workflow 保存建立時的 `roundId`、config 快照與操作意圖。precheck 只需在固定區塊讀取 getter 並比較 round ID；若已切換則拒絕。升級前建立、缺少 round ID 的 workflow 暫時沿用事件回查，完成或重建後自然淘汰。
5. receipt 驗證包含目標合約地址、成功狀態、事件及完整參數。SET 確認 seriesID／ticketLimit／price；CLEAR 也確認 seriesID，不能只驗 topic。後續鏈上／Graph 讀回需考慮其後買家已成交，不以「讀回 used 必定是 0」判定 SET 成敗。
6. SET 成功保存新設定與 workflow 證據；CLEAR 成功保存關閉狀態，不能沿用舊 metadata 把商品顯示成仍有優惠。使相關 catalog／商品／報價快取失效。
7. 區分交易已確認與 Graph 已追上；索引落後時顯示同步中，不將舊索引值覆蓋成最新狀態。清除後設定失敗時保持「已關閉」，不得自動恢復舊輪。

介面相容性的限制：既有 SET／CLEAR 仍不帶 expected round；`roundId` 供後端在送出前判斷 workflow 是否過期。其他 OPERATION_ROLE 地址直接送出的並行交易仍按鏈上交易順序執行。

## 7. Admin 操作

- 顯示「尚未設定／進行中／已用完／已關閉」、本輪名額、已用數量、有效剩餘數量與單價。已關閉時有效剩餘為 0，另顯示放棄名額，不把保留的 limit-used 當有效優惠。
- 未設定：提供「設定優惠」。進行中：提供「關閉本輪」，禁止直接送 SET。已用完／已關閉：提供「開啟下一輪」。
- 關閉提示：「本輪已使用 X／Y 抽。關閉後，剩餘 Z 抽優惠將失效；已成交訂單不受影響。」X、Z 為讀取當下值，最終以交易執行時為準。
- 新輪欄位使用「本輪優惠抽數」「本輪優惠單價」，避免被理解為增加歷史上限；表單價格低於系列原價，名額不超過可售剩餘抽數。
- 仍沿用既有 workflow 核准流程。待核准／送出／確認／索引同步期間顯示狀態，阻止重複操作；不能只在前端 disable 按鈕，後端仍須驗證。
- 同價格／同名額的新輪也可以提交；不能用表單值是否與上一輪相同判斷為無變更。
- 本期不加入一鍵關閉並重開，讓兩個操作與中間狀態清楚可見。

## 8. The Graph 與買家前端

### The Graph

Configured handler 重設 used=0、active=true；RoundAdvanced handler 寫入鏈上 round ID；Cleared handler 保留數量並設 active=false；Applied handler 累加 used。schema 的目前設定與不可變輪次事件都保存 round ID。

subgraph 加入新事件 handler 後重新部署並從既有 startBlock 回放。歷史舊輪沒有 RoundAdvanced 事件，因此 round ID 維持 0；升級本身不發優惠設定事件，也不重設任何系列。

### 買家前端與結帳

- 保留 active 條件及 `max(ticketLimit - usedTickets, 0)` 計算；列表、商品頁、購買對話框需一致刷新。
- 手動關閉後隱藏有效優惠，回到一般價格／回饋；SET 成功並取得新狀態後顯示新輪名額與價格。
- 結帳提交前重新取得權威報價；若優惠關閉、名額變動或新輪價格變動，顯示更新價格。買家需要接受較高價格時，沿用既有重新確認流程，不自動提高上限或增加扣款。
- Legacy points：保留 gross price 上限；新 gross 高於買家上限時拒絕，低於或等於上限可依現行規則成交。
- Database points：保留 `quote.grossPriceInPoints == authorization.grossPoints` 的授權驗證。報價不符時依訂單／授權流程重新報價及處理預留點數，不重複扣點或先宣告成交。
- 本期授權不綁輪次：舊授權若仍有效、未使用且新報價等於授權金額，可能於新輪成交。手動關閉不等於撤銷所有既有簽章；不得宣稱所有舊輪訂單自動失效。已有訂單／授權的過期與單次使用檢查繼續適用。

## 9. 升級相容性

| 升級前狀態 | 升級後行為 |
| --- | --- |
| 未設定／舊版已清除 | 不建立優惠，可 SET 第一個新輪 |
| active=true、used=0 | 保留優惠；改為必須 CLEAR 後才可重設 |
| active=true、0<used<limit | 保留用量與價格；可 CLEAR，不能直接 SET |
| active=true、used=limit | 保留已用完狀態；可直接 SET 下一輪 |

不需批次清零或逐系列遷移，不新增初始化／reinitializer。舊版 CLEAR 已 delete 的資料不能從目前 storage 恢復，歷史仍以既有事件為準。Core、NFT 實付帳務、原有 mint order、reveal 與已支付回饋不因升級變動。

部署前驗證 Bundle UUPS storage layout、runtime bytecode 大小、實際 implementation／ABI、OPERATION_ROLE 與兩種 points 模式。先完成相容的後端／Admin 狀態處理及測試，再依另行授權安排升級與啟用操作；舊版合約環境不得提前呈現已支援多輪。

## 10. 驗收矩陣

| 編號 | 案例 | 預期結果 |
| --- | --- | --- |
| C01 | 初次設定 10 抽 | active=true、used=0；Configured 全參數正確 |
| C02 | 0／10 使用時直接重設 | InvalidConfig；原 config／used 不變；無新事件 |
| C03 | 3／10 使用時直接重設 | 同 C02 |
| C04 | 3／10 時 CLEAR | active=false；limit=10、used=3、price 保留；Cleared seriesID 正確；報價優惠數=0 |
| C05 | C04 後 SET 5 抽新價格 | active=true、limit=5、used=0；不繼承上輪 7 抽；新 Configured 正確 |
| C06 | 10／10 使用後直接 SET | 成功，不需 CLEAR；同價格及同名額也成立 |
| C07 | active=true 且用完時 CLEAR | 成功、數量保留；重複 CLEAR 拒絕 |
| C08 | 未設定時 CLEAR／非操作角色 SET 或 CLEAR | 拒絕，沒有 state／event 副作用 |
| C09 | 不存在 ID、零名額、零價格、等於或高於原價 | 拒絕；舊輪資料不被重設 |
| C10 | 第二輪剩 2 抽，買 5 抽 | 2 抽本輪優惠、3 抽一般價格；完整 Applied、一般回饋及各 token 實付金額正確 |
| C11 | 買完第二輪，再開第三輪 | 計數各輪獨立；歷史事件與原 token 實付金額維持不變 |
| C12 | 關閉前取得舊報價，關閉後提交 | 價格上限／授權精確金額檢查生效；失敗不消耗優惠、不 mint、不重複扣點 |
| C13 | 舊有效簽章跨輪且新 gross 相同 | 依現有有效期與單次授權規則處理，不因輪次不同自行宣告失效 |
| C14 | 有操作角色的接收合約在 mint callback 呼叫 SET／CLEAR | 重入被拒絕；依 callback 是否捕捉 revert 驗證整筆 rollback 或外層正常完成；沒有跨輪 Applied 錯置 |
| C15 | 升級前各種 config／used 快照，升級後讀取 | storage 值不變，按第 9 節轉換可操作性 |
| B01 | CLEAR→確認→SET workflow、相同設定的新輪 | 正確次序與獨立紀錄；重試已成功 workflow 不再送新交易 |
| B02 | 過期 CLEAR／SET workflow、其他輪已成立 | 發送前拒絕過期操作；並行同系列 workflow 被序列化 |
| B03 | 偽目標地址／錯 seriesID／錯 SET 名額價格 receipt | 驗證拒絕，不能僅憑事件名稱成功 |
| G01 | Configured→Applied→Cleared→Configured→Applied | config 只反映新輪；所有不可變歷史事件仍在 |
| G02 | 第一輪用完直接 Configured；同區塊多事件依序回放 | 不串輪、無舊 used 殘留；索引回滾／重放結果一致 |
| U01 | 未用、部分用、用完、已關閉與待確認畫面 | 按鈕符合狀態；未使用亦無直接覆蓋入口；放棄名額清楚 |
| U02 | 列表、商品頁及已開啟結帳遇到 CLEAR／SET | 正確刷新與重新報價；索引落後顯示同步狀態 |

C01–C13 中涉及成交／計價的案例涵蓋 legacy points 與 database points 模式，以及既有適用的 free-order／reveal 路徑，驗證不變更各自原有限制。增加針對性測試，不以只斷言「交易成功」取代事件、參數及帳務檢查。

## 11. 實作交付與驗證順序

1. Contracts：SET／CLEAR 狀態規則、非重入保護、回歸測試；compile、相關 Hardhat tests、storage layout 與 bytecode 檢查。
2. Backend：workflow 預檢、序列化／冪等、完整 receipt 驗證、關閉狀態與快取同步；執行對應單元與整合測試。
3. Admin：狀態與操作入口、表單驗證、關閉提示、重複操作限制；typecheck 與 UI 流程驗證。
4. Graph／Frontend：先驗證沿用現有格式；補事件回放、第二輪資料映射及價格切換測試，必要時才修改實作。
5. 執行 `git diff --check`，定向檢查舊 `openingDiscountUsed != 0` 限制、delete config、尚未使用可直接覆蓋文案與用量累計假設是否殘留。
6. 取得目標部署資訊後執行完整測試環境流程：第一輪部分使用→關閉→第二輪→用完→第三輪；驗證交易、後端訂單、Graph 與買家畫面一致。

本規格完成不代表上述測試已執行或功能已上線。後續需按實際結果區分本地驗證、測試環境驗證與正式部署；正式升級及任何鏈上操作須另有明確授權。
