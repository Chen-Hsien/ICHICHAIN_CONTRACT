# 統一實體卡禮包：實作交接

更新日期：2026-10-06。產品規則以 [規格](physical-gift-card-spec.md) 為準。本次是本地功能實作；本次未執行正式 migration 或手動部署，也未進行真實配送驗收；開發分支已推送，遠端 CI／自動部署狀態尚未驗證。

目前狀態：**REVIEWED（使用者風險例外放行）**。第四批修正與第五輪完整獨立審查已完成，累計 5 輪／4 批修正／10 次 reviewer。使用者於 2026-10-06 表示「應該沒這兩個狀況，可以放行了」，明確接受 Admin override 出貨時間與額外箱對帳期間換單兩項 P2 暫不修正，解除本地 HOLD。兩項仍是未修正例外，不改記為獨立審查或測試通過；原始證據及待補方案見 [審查紀錄](physical-gift-card-review.md#第五輪結論與使用者接受的例外)。後續使用者要求「push to dev」，來源已提交並推送既有開發分支，詳見以下紀錄；未開 PR、未人工啟用活動。

## 工作目錄

來源提交保留於各 repo 的 `codex/physical-gifts` 工作分支，已依使用者授權推送 Backend／Admin 的 `develop` 與前台 `dev`。文件使用 `codex/physical-gifts-dev` 分支，以合約 repo 的 `origin/dev` 為基底：

| 專案 | 工作目錄 | 基準 |
| --- | --- | --- |
| Backend | `/Users/angustsai/doudochain-backend-physical-gifts` | `origin/develop`，`fb055c72` |
| Admin | `/Users/angustsai/doudo-admin-physical-gifts` | `origin/develop`，`02ec72a` |
| 前台 | `/Users/angustsai/ichichain-physical-gifts` | `origin/dev`，`b0f6738f` |
| 規格／交接 | `/Users/angustsai/ICHICHAIN_CONTRACT-physical-gifts` | `origin/dev`，`4938b7a` |

## 已推送的來源

2026-10-06 使用者要求「push to dev」，以下普通 fast-forward push 均成功，無 force push：

| 專案 | 目標 | commit |
| --- | --- | --- |
| Backend | `develop` | `cb261ee72ed54f4a2735a56d517a8840fdb5d77d` |
| Admin | `develop` | `4fa38d56aefa746963b062ae404a2a729784eb67` |
| 前台 | `dev` | `6b05e50a421a0b01c56a50482a3464fc53a5df13` |

來源與第五輪凍結快照相同；兩項例外保留。原始 repo 工作目錄中的其他未提交內容未納入提交。

## 已實作的流程（兩項使用者接受的例外）

- 前台 `/gift` 由既有語系 middleware 導至 `/tw/gift` 或對應語系；沿用 Privy 登入、每日任務開盒／點數揭曉動畫及機率表。頁面載入與重新查詢只 GET，實際點開盒子才 POST 指定資格。等待、可領與歷史禮包顯示出貨單／箱次、出貨時間及已有的收件確認時間，沿用既有台北時區格式。
- 名片見面禮：同活動、同帳號唯一來源；不同箱子各有一次隨箱禮。每一箱的來源鍵不含活動版本、日期或會員，無法以重印／換帳號再領。
- 物流：沿用 ECPay 解密／CheckMac、事件時間、正規化與版本控制；主箱須有目前物流單號對應的已接受完成紀錄。到店待取、未知／過期通知及一般人工改「送達」均不解鎖。主箱換單沿用包裹 ID，舊完成證據失效。反查核對特店、交易、物流 ID 與子類型；主箱 callback 在每次版本重試核對目前綁定，額外箱在鎖定後重驗物流 ID／交易／子類型，避免換單期間舊回報覆蓋新綁定。
- 多箱：第二箱起需獨立物流資料；ECPay 額外箱先向官方查詢核對特店、交易、物流 ID 與方式。商家直送額外箱的裝箱不自動代表寄出，須單獨保存出貨時間與承運收寄證據，再以本箱收件證據確認。額外箱可在既有明細更正物流單號，沿用原包裹／資格／claim，清除舊收件證據；歷史物流單也不能改登另一箱再領。
- 帳務：有限預算先保留最大獎額，抽獎後轉為實際承諾；一份 claim 固定抽中結果、收款錢包及 `physical-gift:<entitlementId>` 入帳鍵。沿用既有 Points repository 的凍結、欠額抵扣及估值規則。
- 恢復：訂單／包裹及 claim 是耐久工作紀錄；現有 maintenance worker 定期補建／啟用／撤銷與補入帳。訂單來源採增量追蹤與每批最多 100 筆的循環補掃，避免較晚提交、時間戳落在增量游標之前的出貨漏建。入帳後程序失去回應，重試會取回原 ledger。補預算恢復原資格，三次自動入帳失敗後由後台重試原紀錄。已送達且尚未領取的箱子持續反查；後續完成撤銷或退回若漏掉通知仍可收斂。
- Admin：`/admin/physical-gifts` 管理預算、版本與三個獨立開關；顯示資格及入帳統計。既有出貨明細新增裝卡、每箱收件證據／稽核、商家直送出貨／收件確認、撤回收件及原箱／出貨單對帳。採既有 `TASK_CAMPAIGN_READ`／`TASK_CAMPAIGN_MANAGE`，另限制平台 `DOUDO_ADMIN` 角色。

首版實體禮包與 evergreen 任務分開計算，使用每日禮包 v3 獎池預設。獎池設定在資格建立時保存不可變版本；延後補建的宅配資格按出貨時的啟用紀錄及版本處理。ECPay 延後補建使用本物流單最早可信 provider 出貨事實，避免將送達日期改當較晚的出貨日期；若從未有配送中來源，只能依第一筆有效取件／送達事實補建。關閉新增資格不撤銷已承諾資格。所有卡片仍可使用相同網址；物流完成後收藏的網址或舊卡也能領取，這不構成持卡或拆箱證明。

可信出貨日期依 provider 事件日期排序，不依通知抵達順序。較早出貨事實晚到時，主箱與額外箱均保留目前送達／收件狀態；未核銷的原資格重新核對出貨時的啟用與獎池，必要時釋放或重新保留預算；已核銷不改結果／版本／wallet／ledger，補記出貨時間更正及已核銷例外。若再補到更早且符合當時資格的證據，可恢復因出貨時間判斷撤銷的原資格；不恢復已取消／退回的正式撤銷。領取交易也在原鎖內重查來源，不能靠落後的 AVAILABLE 直接核銷。

物流 normalized order 與完整 history 以同交易保存；舊／重複通知保存歷史時亦與本單領取交易串行，原來源提交後 activation 中止，可由現有 worker 及 undated 反查使用原來源修復。整單對帳逐一反查所有已登錄 ECPay 箱；一箱失敗仍核對其他箱，保留各箱結果而不宣告整單成功。Admin 即使操作部分失敗也重新 GET 顯示原箱現況並保留失敗原因，可用逐箱對帳重試。


反查沒有可解析的 provider 日期時，觀測時間只用於更新目前物流／收件狀態，不能作首次出貨依據或選擇獎池。未知出貨時間須等可信 dated 來源補齊；已有原出貨資格則仍可透過 undated 反查修復收件。當較早的 dated 來源晚於查詢送達時才抵達，可補足出貨事實，保持目前已驗證的收件狀態。原有 legacy history 若沒有時間來源標記，亦不能單靠其日期新增資格。每日任務出錯時，禮包恢復仍會執行，原 daily 錯誤保留給排程追蹤。

## 主要程式

| 範圍 | 入口 |
| --- | --- |
| Backend 來源／領取／入帳／對帳 | `apps/api/src/physical-gifts/service.ts`、`controllers.ts`、`domain.ts` |
| 物流接線 | `apps/api/src/logistics/module.ts`、`services/ecpay-logistics.service.ts`、`services/logistics.service.ts` |
| Worker | `apps/worker/src/physical-gifts.ts`、`main.ts` 的 task maintenance handler |
| DB | `packages/db/prisma/schema.prisma`、`migrations/20261005120000_physical_gifts/migration.sql` |
| 前台 | `app/[lang]/gift/page.tsx`、`app/components/gifts/PhysicalGiftClient.tsx` |
| 共用開盒呈現 | `app/components/tasks/TaskCenterClient.tsx` 的 `ClaimRewardModal`、`TaskGiftRewardInfo` |
| Admin | `src/features/admin-console/physical-gifts.tsx`、既有 `logistics.tsx` 與 `detail-router.tsx` |

本版不呼叫合約，也不新增鏈上事件或 subgraph 欄位。Points 帳務與領取唯一性以後端資料庫為準。

## 暫不修正的已接受風險

- SE5-1：有效 dated 出貨 history 的 decision 白名單須涵蓋 Admin override 保留分支，避免把後續送達日誤當出貨日；不得把 raw-only 資料直接當收件證據。待補實際 Admin 狀態更新與延遲通知跨活動啟用／政策的 PG 回歸。
- SG-6：額外箱反查若回傳 false，須重新核對原箱最新綁定或明確標失敗，不能記 COMPLETED。待補反查期間換單並驗逐箱／整單 audit 的 PG 回歸。

以上為已確認而尚未修正的本地來源問題；2026-10-06 使用者判斷兩種情境不會發生並明確接受風險，因此暫不追加修正／審查。保留回歸方案供日後需要時使用，不代表程式已防止這兩種情境。

## 本地驗證

Backend 使用隔離 PostgreSQL 16，先建立功能之前的 schema，再套用實際 migration，包括預算／來源／唯一性／獎池不可覆寫約束。測試使用此工作目錄的 ts-jest 原始碼、新 Prisma Client 與真正 Points repository。Nest HTTP 測試保留實際 tenant、平台角色與 permission guards；僅使用測試 token 驗證替身。

涵蓋並行領取、跨帳號讀取、同訂單兩箱、到店未取、完成刪除、舊事件、換單保留舊送達狀態、官方查詢格式、預算不足與補資、關閉新增資格後補建、固定版本、凍結帳戶、worker lease 過期與「入帳已提交但回應失去」復原。物流 adapter 使用公開測試金鑰的簽章／加密 fixture，未向綠界正式服務送出請求。

前台以 jsdom 驗證既有開盒元件的預覽／開盒請求、回應丟失重試、歷史唯讀、待入帳文案、帳號切換及未登入入口；Admin 以 jsdom 驗證分頁、ECPay 無人工確認操作、商家直送證據必填與正確箱 ID。依前台／Admin AGENTS.md 未執行瀏覽器驗收或 production build。

三個專案的 focused tests、TypeScript、修改範圍 ESLint 與 `git diff --check` 均列於 [審查紀錄](physical-gift-card-review.md)。未啟動整套正式 API／BullMQ worker、未驗證遠端 CI、未開 PR、未執行正式 migration 或手動部署。

## 啟用順序

1. 本地 review 已以兩項人類風險例外放行，開發分支推送已依使用者授權完成；後續正式發布仍需對應分支／CI 檢查及部署授權，保留例外紀錄。取得部署授權後，Backend 先套用新增 migration，再更新 Prisma Client、API 與 worker，使用該環境既有 `npm run prisma:migrate:deploy` 流程。
2. 更新 Admin 與前台，確認正式固定 `/gift` 網址的語系與登入返回。
3. 在 Admin 建立宅配方案與需要的名片活動；新方案預設停止新增資格、暫停開盒，未自動開始發獎。
4. 核對每日禮包 v3（銀 35%／1–3、金 50%／4–6、白金 15%／7–10）與有限預算，再開放新增資格／開盒。既有入帳工作另由「暫停 Points 入帳」控制。
5. 實際正向配送做一箱驗收：配送中不可領、到店不可領、成功取件／送達才可領；重掃／併發不多發。確認官方 callback 與 worker 反查均指向新部署版本。驗證過正式網址後再生成統一印刷 QR Code。

ECPay 官方查詢 [文件](https://developers.ecpay.com.tw/10171/) 的 v2 回應會以 `LogisticsType`（例如 `CVS_FAMI`）描述方式，adapter 同時處理該格式與明確 `LogisticsSubType`。正式環境各啟用物流方式仍需以真實配送驗收；不將本地 fixture 當成正式物流已通過。
