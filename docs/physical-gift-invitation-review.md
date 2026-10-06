# 隨箱禮包邀請本地審查

日期：2026-10-06。模式：fix／本地 WIP，L2（跨專案、API、權限、DB migration、Points、狀態機與並行）。需求與驗證對照見 [spec](physical-gift-invitation-spec.md)／[handoff](physical-gift-invitation-handoff.md)。這是已交付固定 QR 禮包的私人邀請擴充，舊 SG-6／SE5-1 人工例外保留在原審查紀錄，未重寫其結論。

狀態：**REVIEWED（已修正的本地 WIP）**。累計 2 輪／1 批修正／4 次 reviewer calls，第二輪以新的上下文讀最終完整 diff，三軸皆 PASS，沒有未解 P0／P1／P2。這不是遠端 CI 或可合併／部署證明。本次預算最多 3 輪／2 批修正／6 calls。

## 第一輪

Snapshot SHA-256：`06669117925b9e970ea1b9c91d89371f24b89a26f5918fa3854262a83359247f`。唯讀 reviewer A／B 均核對 4 repo 的 base／head／target、patch 與 21 個列管來源檔雜湊。兩者都讀完整 diff 與必要 caller／consumer，未改來源或重跑測試。

A：Spec FAIL、Simplicity PASS，關鍵副作用在本地證據範圍內 PASS。B：Spec FAIL、Side effects FAIL、Standards／Simplicity PASS。需求 I1–I7／I9 本地證據通過；I8 尚有本單接線與送出紀錄分頁缺口。B 另指出失去 mutation 回應後舊連結仍可分享。

| Finding | 等級／軸／需求 | 狀態與修正證據 |
| --- | --- | --- |
| A-I8-1／B-1：getPhysicalGifts 忽略 orderId | A P1、B P2；Spec／Side effects；I8 | closed，第二輪 A／B 確認。首請求與後續頁都附 orderId；完整 transport URL 與 UI 多頁參數 assert |
| A-I8-2／B-2：已送出摘要 50 筆上限無後續路徑 | P2；Spec／Side effects；I8 | closed，第二輪 A／B 確認。獨立 `/invitations/sent` cursor，驗 sender／order 範圍，保持既有主列表欄位；真 PostgreSQL 51 箱／51 原 claim／51 ledger、跨 sender／order cursor 拒絕；UI 第 51 筆可見 |
| B-3：撤回／替換已提交但回應丟失時舊連結仍顯示 | P2；Spec／Side effects；I3／I8 | closed，第二輪 A／B 確認。任何 mutation 開始即清除本頁 link，失敗刷新狀態並提示重新產生；replace／revoke lost-response UI assertions |

## 第二輪完整 final review

最終 [snapshot](physical-gift-invitation-review-snapshot.json) SHA-256：`6426b1db3758749c02049816ddf0ec01699a4740ef3638ccc4153653c3beed51`。第一輪 [snapshot](physical-gift-invitation-review-r1-snapshot.json) 原文保留。兩位新上下文 reviewer 都驗四 repo 版本、完整 patch 與 21 個列管檔雜湊，閱讀最終完整 diff、I1–I9、完整改動函式與必要 caller／consumer；未改來源、重跑測試或操作外部服務。審查後只更新本份結果紀錄，不改被凍結的 source／spec／handoff。

A：Spec PASS、Simplicity PASS，關鍵副作用無新 finding。B：Spec PASS、Side effects PASS、Standards／Simplicity PASS。I1–I9 在本地證據範圍內全部 PASS，第一輪三項 finding 均 closed，沒有新的 P0–P2 或需新增修正批的 P3。

最終驗證 **264 PASS、0 failed、0 skipped**：真 PostgreSQL 50、前台 69，加上未改的相鄰 87／每日開盒 58；report SHA 記在 snapshot，兩位 reviewer 都已核對。兩 repo `tsc --noEmit`、範圍 eslint、`git diff --check` 通過。舊 migration 無修改，新 migration 排在 `20261005183000_add_logistics_status_inbox` 之後。

| Repo | 固定 head／比較 target／merge-base（同一 SHA） | WIP 範圍 |
| --- | --- | --- |
| backend，origin/develop | `b2aa9e3207c70148f604be34fdc2f2ef81816b99` | 6 個來源檔 |
| frontend，origin/dev | `6b05e50a421a0b01c56a50482a3464fc53a5df13` | 13 個來源檔 |
| Admin，origin/develop | `4fa38d56aefa746963b062ae404a2a729784eb67` | 無本次 delta |
| docs，origin/dev | `34bf90efb36aacd954b921df7b3b053eec09ed19` | spec／handoff，另附 review 證據檔 |

仍有一項部署驗證邊界 **UNKNOWN**：一般頁先前載入的 Hotjar script 在 SPA 導到邀請頁時可能仍留在 document；本地只能驗本次程式不送自家 invitation pageview、不初始化分析 SDK，並讀入後移除 fragment。第三方 SDK 是否會記錄清除前的 fragment 尚無真瀏覽器／網路實測，不把它當作實測通過或已證實 bug。正式 Privy 登入跳轉、API／BullMQ／ECPay、遠端 migration／CI 也沒有本次 live 證據。

## 配置與驗證邊界

四次 reviewer 都因 API／DB／權限／Points／跨 repo 風險採 policy L2：要求 `gpt-6-sol/high`，fork_turns=none，未再委派；每輪兩位並行。第 1 輪為 gift_invite_spec_r1／gift_invite_side_r1，第 2 輪為 gift_invite_spec_r2／gift_invite_side_r2。可取得的 metadata 沒有實際模型／effort、token 或費用；要求配置有記錄，實際配置與成本未確認，reviewer 耗時未獨立計時。母 agent 沒有估算費用或以高階模型替代。

第一輪測試 258 PASS：PG 49、後端相鄰 87、前台 64、既有每日開盒 58。第一批修正重跑受影響的 PostgreSQL／前台 suite 與兩 repo 型別／範圍 lint／diff 檢查；精確報告及 source hashes 記錄於最終 snapshot。未變的相鄰 87／每日開盒 58 沿用第一輪實際結果，沒有用無新證據的全套重跑取代 review。

本地 WIP review 當時尚未 commit／push／開 PR，也未驗證遠端 CI、正式 API／BullMQ／ECPay、遠端 migration、瀏覽器或 production build；不能作為 merge／部署證明。新增 migration 本地真 SQL 套用及不可修改舊 migration 的歷史／日期順序檢查已執行。後續使用者授權 push 的事實另記於下節，不改寫前輪驗證結果。

## 後續授權 push to dev

2026-10-06 使用者明確要求「push to dev，然後提供 staging 的測試流程」。提交前 fetch／merge 兩 repo 目標分支，base 未前進；19 個來源檔逐一核對仍符合 final snapshot 的 SHA-256，只有本次檔案 staged／commit。Backend 完整 `npm run lint:check` 通過（0 errors，5 個既有 chain service warnings），`npm run secrets:scan` 通過；普通 fast-forward push 成功，未 force push 或開 PR。這項使用者授權優先於一般 feature PR 流程，沒有改寫 repo policy。

| Repo | 目標 | 已推送 commit |
| --- | --- | --- |
| Backend | `develop` | `40a607336e22c26e314083bc7025da502b8e5751` |
| 前台 | `dev` | `70d793b8aa616f92f6e707be78c43f4b3783a60b` |

Admin 本次無 source delta，沿用已推送 `4fa38d56`。未修改原始工作目錄的其他未提交內容。staging 的入口、前置條件、實際部署／migration 觀測及人工測試步驟見 [staging 測試流程](physical-gift-invitation-staging-test.md)；沒有自行執行真人登入、領取、正式物流或手動部署。
