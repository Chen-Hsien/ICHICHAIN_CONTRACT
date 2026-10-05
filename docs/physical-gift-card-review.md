# 實體卡禮包本地實作審查

日期：2026-10-06。模式：fix／本地 WIP，風險 L2（跨專案、資料庫、權限、Points、併發與耐久重試）。本紀錄不代表正式部署、遠端 CI 或可合併證明。產品規則見 [規格](physical-gift-card-spec.md)，工作目錄與啟用步驟見 [交接](physical-gift-card-handoff.md)。

狀態：**REVIEWED（使用者明確接受兩項風險，例外放行）**。第四批修正與第五輪完整獨立審查已完成，累計 5 輪／4 批修正／10 次 reviewer 呼叫。使用者於 2026-10-06 表示「應該沒這兩個狀況，可以放行了」，接受 SG-6、SE5-1 兩項 P2 暫不修正，解除這兩項造成的本地 HOLD。獨立審查原始結論仍為 Spec **FAIL**、Side effects **FAIL**、Standards／Simplicity **PASS**；不把人工例外改記成測試成功。使用者後續要求「push to dev」，三個來源 repo 已提交並推送開發分支；詳見下方推送紀錄。未開 PR，未執行正式 migration、手動部署或鏈上交易。

第四輪歷史快照為 `/tmp/physical-gift-review-r4.json`，耐久副本為 [physical-gift-card-review-r4-snapshot.json](physical-gift-card-review-r4-snapshot.json)，SHA-256 為 `f793a34e6cb6c3139ed765d815cbf6ed9b9a7fe743d5a69f52458b03ba80b96e`。兩位 reviewer 均核對 33 個來源檔雜湊及三個 repo 的固定 base／head／merge-base；審查期間沒有修改來源。第三輪的 31 檔快照另存 [physical-gift-card-review-r3-snapshot.json](physical-gift-card-review-r3-snapshot.json)，SHA-256 為 `b27fe63230add0877c89a1d22b2724cf0511b21bfe0e14809ae067e830d89a4d`；第二輪紀錄保留在 `/tmp/physical-gift-review-r2.json`。

## 需求與證據

| ID | 驗收行為 | 實作與本地證據 |
| --- | --- | --- |
| R1 | 相同卡片與固定入口；GET 不新增、不開盒、不入帳 | `/gift` 路由、User controller、HTTP／前台 GET 及開盒預覽測試 |
| R2 | 見面禮同帳號同活動一次；不同箱各一次 | sourceKey／parcel／claim UNIQUE；PostgreSQL 同帳號兩箱及並行領取測試 |
| R3 | 正式出貨建立等待資格；到店不解鎖，可信成功取件／送達才可領 | ECPay adapter／現有正規化／service；簽章加密 fixture、到店未取、子類型與身分不符測試 |
| R4 | 綁會員 canonical userId；不得指定金額／錢包；平台管理權限 | 真實 Nest owner／tenant／DOUDO_ADMIN／read-manage guards、HTTP 401／403／404／400 測試 |
| R5 | 多箱各自的出貨與收件來源；更正單號保留原身分 | 每箱 binding／dispatch／receipt；裝箱未出貨、晚出第二箱、換單舊證據失效、歷史單號不能另建一箱測試 |
| R6 | 未領撤回收件釋放預算；已開出不重抽、不再入帳 | 相同 budget／order 鎖；配送更正、人工撤回、反查漏通知、已核銷後換單測試 |
| R7 | 有限預算先保留最大額，抽獎轉實際承諾；固定版本與結果 | SQL 約束／policy immutable trigger；並行預算、補資、舊版本、暫停及完整 ledger shape 測試 |
| R8 | 回應丟失、程序重啟、重試仍使用原 claim／錢包／ledger | 真正 Points repository／PostgreSQL；入帳先提交後失去回應、lease 過期、新 service instance、凍結及原工作人工重試；daily lifecycle／reward recovery 拋錯仍修復原 claim |
| R9 | 遺失來源與完成通知可對帳；後台有原箱修復 | 增量與 bounded source backfill cursor、maintenance runner、Admin targeted reconciliation／audit；晚提交落在游標之前、漏建補建、跨啟用與版本變更、反查綁定競爭測試 |
| R10 | 沿用每日禮包畫面與機率；區分已開出／已入帳與不同箱；帳號切換清理 | 共享 ClaimRewardModal／TaskGiftRewardInfo、既有台北時區 formatter；前台開盒、出貨／收件時間、歷史唯讀、固定 ID 重試、切換帳號及 daily regression |
| R11 | Admin 用既有出貨畫面與權限；保留 evergreen 及物流通知 | Admin logistics detail／program workspace；既有物流、運費、任務、站內通知相鄰回歸測試 |

## 第一輪 finding 與修正

| Finding | 狀態 | 修正／回歸證據 |
| --- | --- | --- |
| SG-1 P1：商家直送更正配送異常後仍信任舊收件 | fixed，待最終複查 | 主箱目前來源狀態不支持收件即清除；新增逐箱撤回 API／UI；更正先提交則 POST 拒絕，原預算釋放 |
| SG-2 P1：額外箱無法換單並保留身分 | fixed，待最終複查 | 平台權限、版本檢查及綠界新單反查的 binding correction；保留原 ID／快照／claim，歷史綁定不可另建箱 |
| SG-3 P1／B2 P2：直送額外箱借用第一箱寄出時間 | fixed，待最終複查 | 裝箱時 shippedAt 留空；需獨立 dispatch 時間／證據／操作者稽核，關閉新增資格後新箱不取得舊資格 |
| SG-4 P2：ECPay 延後補建借用送達時間判斷啟用與版本 | fixed，待最終複查 | 對照本單最早接受配送歷史；啟用前已寄出不因較晚送達取得新資格，已承諾出貨在停用後保留舊版本 |
| SG-5 P2：缺少 Admin 原來源對帳 | fixed，待最終複查 | 出貨單／逐箱 targeted reconcile，REQUESTED／COMPLETED／PROVIDER_FAILED 稽核，不能自行確認送達或重建 claim |
| B1 P2：送達未領即停止反查 | fixed，待最終複查 | 每五分鐘退避、每批十箱，納入送達尚未核銷資格；漏掉完成撤回通知的查詢測試 |
| B3 P2：反查未驗物流 ID／子類型及必要身分 | fixed，待最終複查 | physical gift 查詢要求四項身分完整相符；來源交易各次版本重試重驗預期綁定，錯誤／缺欄位與反查期間換單負向測試 |
| B4 P2：直送接線誤在交換完成流程 | fixed，待最終複查 | 正式 direct fulfillment 提交後才 refresh；保留新合併的站內物流通知；直接出貨即有 PENDING 資格，gift 處理失敗不回滾出貨 |

第二輪確認 SG-1／SG-3／SG-4／SG-5／B1／B3／B4 已關閉；SG-2 的功能已補齊，但競爭檢查仍有 SG-2R／B6，於第二批修正如下。

## 第二輪 finding 與修正

| Finding | 狀態 | 修正／回歸證據 |
| --- | --- | --- |
| SG-2R／B6 P1：額外箱換單並保留交易／子類型時，舊事件可在初查後命中新綁定 | fixed，待最終複查 | budget／order 鎖後重載包裹，核對 logisticsId；PostgreSQL 在初查後插入同交易／子類型換單，舊完成事件被拒絕，新單只核銷原資格 |
| B5 P1：主箱舊 callback 可在 Admin 換單後恢復舊物流 ID | fixed，待最終複查 | callback 每次 optimistic retry 驗目前 ID／交易／子類型；加密舊回報負向案例及實際並行寫入造成 CAS retry 案例；初次建立 ID 保留可用 |
| B7 P2：來源增量游標可能漏掉較晚提交的出貨 | fixed，待最終複查 | 新增既有 cursor 表的 orders_backfill，每批 100 筆循環補掃；真實 PostgreSQL transaction 先填 updatedAt、後提交，確認能補建且不複製原箱來源 |
| UX-1 P2：不同宅配禮包缺少時間以便辨識 | fixed，待最終複查 | 等待／可領／歷史均顯示箱次與出貨、有效收件時間；沿用 formatDateTimeMinute；jsdom 驗台北時間與不發 claim |

前兩輪 Spec／Side effects 為 FAIL；Standards／Simplicity 均 PASS。第三輪確認 SG-2R／B6、B5、B7、UX-1 的修正與回歸測試相符；沒有重開前輪其他已關閉項。SG-4 的帶日期 webhook 路徑通過，但查詢缺日期仍有 SG-4R，詳見下表。

## 第三輪 finding 與第三批修正

| Finding | 狀態 | 觸發／後果與具體修正需求 |
| --- | --- | --- |
| SG-4R，Spec P2，R3／R5／R7／R9 | fixed，待第四輪複查 | 首次資格不使用反查觀測時間。主箱 history 新增 PROVIDER／QUERY_OBSERVATION 來源標記；額外箱的 eventAt 與 observedAt 分開。已有 dated 出貨仍可用 undated 反查修復收件；較晚到達的 dated 來源可補上原出貨事實，保留目前可信收件狀態。PG 回歸涵蓋缺失／錯誤日期、啟用前後主箱／額外箱、觀測後補到 dated 來源及原獎池版本；協定測試完整 JSON shape 加上來源標記。 |
| B8，Side effects P2，R8／R9／R11 | fixed，待第四輪複查 | main handler 呼叫實際 reconcileTaskMaintenance；以 finally 執行禮包恢復，daily 原錯誤仍拋回 BullMQ。兩個 PG 案例注入 daily lifecycle／reward recovery 錯誤，證實原 claim 仍以原結果與 ledger 入帳；四個 worker 案例驗正常回應、gift 失敗與雙方同時失敗保留原錯誤。 |

第三輪歷史結論：Spec **FAIL**、Side effects **FAIL**、Standards／Simplicity **PASS**。第三批修正通過受影響回歸，第四輪亦確認上列兩項已關閉；因本輪其他 finding 仍 open，尚未宣告 REVIEWED。

## 第四輪完整審查與剩餘修正

第四輪歷史結論：Spec **FAIL**、Side effects **FAIL**、Standards／Simplicity **PASS**，交付狀態 **HOLD**。兩位獨立 reviewer 以固定快照讀取最終完整 WIP、需求、前輪 finding 與測試紀錄；未修改檔案、未重跑測試或操作外部服務。

| Finding | 軸／等級／需求 | 狀態、觸發與後果 | 最小修正與回歸 |
| --- | --- | --- | --- |
| SG-5R4 | Spec P2，R9 | **open**。`controllers.ts:288–329` 的整單對帳未指定 parcelId 時只呼叫主箱 syncOrderStatus，未反查額外 ECPay 箱，卻稽核整單 COMPLETED。第二箱漏掉送達／更正 callback 時，此操作不能修復第二箱。週期 worker 與逐箱入口能稍後修復，不能代表這次整單操作已完成。現有 PG 整單案例只有單箱直送。 | 對所有已登錄且獨立綁定的 ECPay 箱逐箱反查；保存每箱成功／失敗，部分失敗不能宣告整單完成。加入兩箱漏通知及部分 provider 失敗測試，核對原 ID 與稽核內容。 |
| SE4-1 | Side effects P2，R3／R9 | **open**。`logistics.service.ts:939–985` 的 normalized order 與 status history 分別提交。程序在前者提交、後者保存前中止，且後續反查只有 undated 狀態時，`service.ts:409–451` 找不到帶日期的 PROVIDER history，無法自動恢復正式出貨時間／首次資格。dated callback 重送可修復；不是不可逆的來源遺失。 | 同交易保存已接受來源與正規化狀態，或讓對帳使用可驗證、保持綁定與版本的耐久原事件修復。加入來源提交後中止、只有 undated 反查、原箱資格與 ledger 均唯一的回歸。 |
| SE4-2 | Side effects P2，R3／R5／R7／R9 | **open**。`service.ts:451／528／1252` 依 history 寫入順序選出貨時間並固定 shippedAt。啟用後 dated DELIVERED 先到，啟用前 dated IN_TRANSIT 隨後抵達，較早事實已保存但不會修正主箱／額外箱的出貨時間、啟用與獎池判斷；舊箱可能仍可領或使用錯誤版本。不能靠把目前 DELIVERED 倒退解決。 | 將目前配送狀態與最早可信正式出貨事實分開處理；未核銷時依已取得的較早事實重新檢查資格／版本，保留原包裹身分，已核銷例外留稽核且不重抽／自動追扣。加入主箱與額外箱 dated-delivery-first、跨啟用／版本、補到較早 dispatch 的回歸。 |

主 agent 核對本輪三項證據：整單 controller 確實沒有迭代額外箱；物流 repository 以單獨 updateMany 保存狀態；worker 目前僅對帳 order／parcel／claim，不重放遺留 webhook。既有正式環境 webhook inbox 使用 Prisma、留存原 payload，既有 Admin webhook reprocess 亦支援 ECPay，因此 SE4-1 可透過原通知重送或人工重處理修復；這仍未滿足本功能自動耐久恢復。SE4-2 在較早 dated 事實抵達後仍保留較晚的 shippedAt，屬資格／版本問題，而非要求依未知未來通知預測真正出貨日期。

前輪 finding 的第四輪結論：SG-1、SG-2／SG-2R／B6、SG-3、SG-4R、B1、B3–B5、B7–B8、UX-1 **fixed／已關閉**；SG-5 的逐箱入口已修復，但整單語意由 SG-5R4 延續。第三批的缺日期觀測與 daily finally 恢復均有實作與回歸斷言。審查中的「重送後仍不能保存 dated source」及「20 筆 duplicate 會排擠 receipt history」候選，分別因 IGNORED_DUPLICATE 已可證明出貨、receipt 查詢先在 SQL 篩 NORMALIZED_STATUS_UPDATED 而排除，未列為剩餘 finding。

| 需求 | 最終本地狀態 | 限制 |
| --- | --- | --- |
| R1、R2、R4、R6、R8、R10、R11 | PASS | 依上述測試及固定來源審查；不代表正式 runtime 或部署通過 |
| R3、R5、R7 | FAIL | SE4-1／SE4-2 的耐久來源、出貨時間與版本缺口 |
| R9 | FAIL | SG-5R4／SE4-1／SE4-2 的對帳恢復缺口 |

本輪 Spec reviewer `/root/gift_spec_review_r4`（第 7 次）回報 14:37–14:44 UTC；Side effects reviewer `/root/gift_effects_review_r4`（第 8 次）回報 14:38:27–約 14:45:21 UTC。兩位均要求 `gpt-6-sol / high`，原因是沿用 L2 兩個獨立視角與 repo 成本策略；工具沒有執行 metadata，實際配置未確認，token／費用無法取得，未估算。未使用 Astra，未啟動更多 reviewer。

第四輪結束時已用完 4 輪／3 批修正／8 次呼叫，依 [code-review skill](../../doudochain-backend-physical-gifts/.agents/skills/code-review/SKILL.md) 的「達預算上限仍有問題則 HOLD」保留來源與剩餘修正；使用者於本輪明確追加後才繼續。前三輪六位亦均要求 `gpt-6-sol / high`，實際配置／費用未確認。第三輪 Spec reviewer 回報 13:45–13:50 UTC，Side effects reviewer 未提供精確結束時間。

第三批前同步 backend 到 `304ec349`；只暫存並套回本次 index.ts 修改，保留新基底的 disabled-series 修正。新增 public-series 回歸、既有 lifecycle 回歸及本次 worker isolation 案例均已驗證。Admin／前台 fetch 後基底相同、內容未變，不重跑無關 suite。


## 第四批修正與第五輪完整審查範圍

使用者已授權新增一批修正與一輪獨立審查；本次總額度 5 輪／4 批修正／10 次 reviewer 呼叫。前三批及前八次 reviewer 為既有累計；本批是第四批，不重置預算。第五輪第 9、10 次呼叫已由兩位新的 L2 reviewer 完成，均要求 `gpt-6-sol / high`；工具沒有提供實際執行 metadata，實際配置未確認，token／費用無法取得。

| Finding | 本批狀態 | 來源修正與回歸證據 |
| --- | --- | --- |
| SG-5R4 | fixed，第五輪支持；新競爭分支另見 SG-6 | 整單按主箱與每個額外箱各自反查、逐箱稽核；單箱 provider 失敗仍繼續其他箱，整單不得寫 COMPLETED，錯誤及整單稽核保存各箱結果。兩個 PG 案例覆蓋三箱正常與第二箱失敗、第三箱成功、原 ID 重試；Admin catch 後 GET 更新部分成功狀態並保留錯誤訊息，jsdom 回歸驗證。 |
| SE4-1 | fixed，第五輪支持 | 既有 repository 的通知保存接受 history，Prisma 以同交易 CAS 保存 normalized order 與完整事件；記憶體替身亦先驗 history 成功才保存。舊／重複事件亦以本單鎖與版本檢查保存歷史，不倒退配送狀態；五次 CAS 均失敗則回報可重試錯誤，不回成功並遺失來源。provider snapshot 更新時間保持單調，避免同毫秒／程序時鐘倒退破壞 CAS。PG 注入 history 寫入失敗驗回滾，再模擬來源提交後 activation 中止、undated 反查，核對原箱／資格／claim／ledger 唯一。相鄰 inbox 測試改為來源回滾時不得發布未提交的送達通知；正式遷移與 DTO 未因此改動。 |
| SE4-2 | 指定修正第五輪支持；Admin override 分支另見 SE5-1 | 主箱按可信 PROVIDER 歷史的實際日期取最早值（SQL DISTINCT 避免傳輸重複輪詢日期）；主箱／額外箱共用較早出貨時間修正與稽核，保留目前配送及收件。未核銷重新核對當時啟用／版本，釋放並重留預算，不新增 ID；已核銷維持結果、版本、wallet／ledger，補記 claimedException。只有 DISPATCH_NOT_ENROLLED 的時間判斷撤銷可在更早有效證據到達後恢復原來源；真正 SHIPMENT_REVOKED 不因此恢復。POST 也在原 budget／order 鎖內重查來源，避免 callback activation 遺失時沿用舊資格。PG 八個分支涵蓋主箱／額外箱、啟用／版本邊界、未領／已領；另有來源交易與 POST 並行、兩個後續證據恢復原資格案例。 |

本批同步：Backend `origin/develop` 前進至 `fb055c72ac9345d86ab7cc9144667d79d9da4bac`，已 fast-forward 合併其運費帳務修正並跑 shipping-fee-accounting 相鄰回歸；Admin／前台基底不變。前台來源與第四輪 hash 全部相同，沿用其 171 項測試及 type/lint 證據，不重跑無變動的 suite。Admin 的部分失敗顯示已修改，重新驗證 4 個 test files 及 type/lint。

第五輪完整來源與固定 base/head/merge-base 已保存於 `/tmp/physical-gift-review-r5.json` 與 [physical-gift-card-review-snapshot.json](physical-gift-card-review-snapshot.json)。第四輪來源另存 [physical-gift-card-review-r4-snapshot.json](physical-gift-card-review-r4-snapshot.json)，雜湊維持 `f793a34e6cb6c3139ed765d815cbf6ed9b9a7fe743d5a69f52458b03ba80b96e`。第五輪共 34 個來源檔，快照 SHA-256 `d556a6b3030a68faa7e98911d3de4c593fa1d83a84da2b61b700a676b992b3b2`，固定時間 `2026-10-05T16:23:46.988571+00:00`。兩位 reviewer 及主 agent 均核對 34 個來源檔、固定 base／head／merge-base、patch 與測試報告雜湊；來源與 spec 在審查期間及結果收齊後保持不變。僅在結果收齊後更新本紀錄與交接文件。

## 第五輪結論與使用者接受的例外

第五輪審查當時的結論為 Spec **FAIL**、Side effects **FAIL**、Standards／Simplicity **PASS**，本地 WIP 為 **HOLD**。2026-10-06 使用者明確接受以下兩項風險後，本地狀態改為 **REVIEWED（風險例外放行）**。Spec reviewer 對 R1–R8、R10–R11 的本地證據回報 PASS，R9 FAIL；聚合 Side effects finding 後 R3／R5／R7／R9 均有未關閉分支，其餘需求不因此擴大成正式環境驗收通過。

| Finding | 軸／等級／需求 | 狀態、入口與可重現路徑 | 最小修正與驗證 |
| --- | --- | --- | --- |
| SG-6 | Spec P2，R9 | **deferred：使用者接受風險，2026-10-06**；未修正。Backend `physical-gifts/controllers.ts:326–340` 反查額外箱後忽略 `acceptExtraParcelEvent` 的 false 回值。查詢期間另一個有權限的管理操作更正原箱綁定，`service.ts:1311–1314` 已找不到舊 logisticsId，回 false；refreshOrder 不更新額外箱，仍記逐箱／整單 COMPLETED。新綁定從未反查，稽核誤報修復完成。 | false 必須視為綁定變更，重讀原 parcel 並核對新綁定，或把原箱標 PROVIDER_FAILED、整單保留部分失敗。加查詢 barrier 期間更正單號的 PG 回歸，驗原箱 ID 不變、未套用舊狀態、逐箱及整單 audit 不得成功，原箱重試才可完成。 |
| SE5-1 | Side effects P2，R3／R5／R7／R9 | **deferred：使用者接受風險，2026-10-06**；未修正。Backend `physical-gifts/service.ts:423–428` 出貨日期白名單漏掉 RAW_UPDATED_ADMIN_OVERRIDE_PRESERVED。既有 `PATCH /orders/:orderId`（`logistics/controllers.ts:1305–1328`）允許 ECPay 人工 DELIVERY_EXCEPTION，`logistics.service.ts:1097–1106` 保存 ADMIN override。較早但晚到的可信 dated IN_TRANSIT 在 `logistics.service.ts:902–914` 耐久保存為該 decision，之後較晚 dated DELIVERED 可正常提交。禮包排除前者，只把送達日當出貨日；真正於活動啟用前出貨的箱子可能在送達後取得可領資格，或套錯政策。claim 的鎖內重查使用相同缺漏來源，不能拒絕這條路徑。 | 在目前綁定、PROVIDER、可解析日期、mapped shipped 的出貨事實白名單納入此 decision，仍不得把它當收件完成證據。PG 用實際 Admin override→延遲 dated IN_TRANSIT→後續 dated DELIVERED，覆蓋啟用與政策邊界，驗未領拒領／正確原版本；已核銷不改原結果／wallet／ledger，保存 claimedException 更正稽核。 |

兩項經完整 caller 與函式核對成立；未另執行安全 runtime 重現，也未新增其 regression，不能將上述待補案例列入已通過的 524 tests。SG-6 的 false 分支與 SE5-1 的 decision 白名單均由主 agent 對目前來源確認。兩位 reviewer 只讀來源及既有報告，未跑測試、未改檔、未操作外部服務。

本輪 reviewer：第 9 次 `/root/gift_spec_review_r5`，2026-10-05 16:25:13–16:35:05 UTC；第 10 次 `/root/gift_effects_review_r5`，16:26:16–16:33:02 UTC（本地日期均為 2026-10-06）。要求均為 `gpt-6-sol / high`，採 L2 兩個獨立視角；實際模型／effort 未確認，token／費用不可取得，未估算。沒有使用 Astra，也沒有啟動第 11 次 reviewer。

第五輪時額度 5 輪／4 批修正／10 次呼叫已耗盡，因此依 [code-review skill](../../doudochain-backend-physical-gifts/.agents/skills/code-review/SKILL.md) 的「達預算上限仍有問題則 HOLD」停止。後續使用者直接表示「應該沒這兩個狀況，可以放行了」，依 [review policy](../../doudochain-backend-physical-gifts/docs/agents/code-review.md)「人類可明確接受某個剩餘風險，但報告應標示例外及原因，不把它洗成測試成功」記錄例外；原因是使用者判斷兩種操作情境不會發生。這是人類風險決策，不是程式已阻止該情境的證據。兩項保留 P2 與待補驗證方案，無需再開本輪修正／審查。只更新本地審查與交接紀錄，未更動產品規格、來源或凍結快照；未授權合併或部署。

## 使用者授權的開發分支推送

2026-10-06 使用者於接受兩項風險例外後明確要求「push to dev」。依此直接提交並以普通 fast-forward push 更新既有開發分支；Backend／Admin 沒有 dev 分支，使用其既有 develop，前台使用 dev。沒有建立 PR，也未使用 force push。

| 專案 | 目標 | 已推送 commit |
| --- | --- | --- |
| Backend | `develop` | `cb261ee72ed54f4a2735a56d517a8840fdb5d77d` |
| Admin | `develop` | `4fa38d56aefa746963b062ae404a2a729784eb67` |
| 前台 | `dev` | `6b05e50a421a0b01c56a50482a3464fc53a5df13` |

提交前重新 fetch／merge，各來源 repo 基底與第五輪快照相同；17 個 Backend、10 個 Admin、7 個前台檔案與被審查的 34 個來源雜湊完全相同，僅提交這些檔案。沿用第五輪測試與 type／lint 證據，不將 git 操作算成新行為驗證。兩項 P2 仍保留為使用者接受的例外。

本規格、交接、review 與三份歷史快照另以合約 repo 的 origin/dev 為基底提交文件；不從原來 main 基底合併無關合約變更。正式 DB migration、正式 ECPay 配送、手動部署及鏈上交易未執行；推送後遠端 CI／自動部署狀態尚未驗證。原始 WIP 快照保留為審查當時證據，不改寫其 head／base 或歷史狀態。

## 已執行驗證及限制

- Backend：14 suites，310 tests 通過（PostgreSQL 39，其他 13 suites 271）。使用隔離 PostgreSQL 16、實際 additive migration、新 Prisma Client、此工作目錄 TS source、真實 Points repository；Nest HTTP guards 與 maintenance runner 使用新原始碼執行。本批新增 14 個 PG cases 及 1 個 source CAS 時鐘回歸。最終完整 PG 39 cases 與相鄰 271 cases 均通過；首次新增案例的測試時鐘／publishPolicy 回傳 fixture 校正後重新完整執行，沒有降低斷言。JSON 證據為 `/tmp/physical-gift-r5-postgres-tests.json`、`/tmp/physical-gift-r5-neighbor-tests.json`。
- 前台：6 suites，171 tests 通過；包含禮包頁與每日任務，以及同步後站內通知／物流詳情／API client。
- Admin：4 test files，43 tests 通過，涵蓋實體禮包／API client／物流／運費；包含部分失敗後顯示已更新原箱並保留錯誤。JSON 證據為 `/tmp/physical-gift-r5-admin-tests.json`。
- 三個專案 TypeScript 通過；修改範圍 ESLint 與 `git diff --check` 通過，最終快照固定前再核對。
- 未使用正式 DB 或正式 ECPay 請求。未啟動完整正式 API／BullMQ main process，未驗證真實 carrier 收件通知、遠端 CI、production build 或瀏覽器畫面。Frontend／Admin AGENTS.md 要求未受請求時不做 browser/build。
- Backend／前台基底在修正前前進，已同步並保留新的物流站內通知及詳情。最終 review 必須核對更新後 base；本地內容仍是未提交 WIP。
