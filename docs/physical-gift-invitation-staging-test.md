# 隨箱禮包轉贈：staging 測試流程

日期：2026-10-06。使用者要求 push to dev 並提供 staging 測試流程。這份文件區分「程式已推送」、「環境已部署」與「真人流程已驗收」。

## 已推送的版本

| 專案 | 開發分支 | commit |
| --- | --- | --- |
| Backend | `develop` | `40a607336e22c26e314083bc7025da502b8e5751` |
| 前台 | `dev` | `70d793b8aa616f92f6e707be78c43f4b3783a60b` |
| Admin | `develop`，本次無修改 | `4fa38d56aefa746963b062ae404a2a729784eb67` |

兩個來源提交的檔案內容與最終獨立審查 snapshot 相同。264 項本地測試通過，審查詳見 [review](physical-gift-invitation-review.md)。本次未發 PR、force push、手動部署、人工套用遠端 migration 或建立測試訂單／領獎。

## 測試入口

- [前台 dev 禮包頁](https://ichichain-git-dev-chenhsiens-projects.vercel.app/tw/gift)。分支 alias 會隨 dev 部署更新；需確認 Vercel 部署的 commit 是上表版本。
- [本次前台固定 Preview](https://ichichain-qdm8abext-chenhsiens-projects.vercel.app/tw/gift)：Vercel 已回報 `70d793b8` 部署 success。
- [Admin 實體卡禮包](https://doudo-admin-ghz8bunx6-chenhsiens-projects.vercel.app/admin/physical-gifts)。這是已成功部署的 Admin commit `4fa38d56` 對應 Preview URL；若使用自己的 Admin staging alias，仍須確認版本及後端指向。
- [Backend health](https://doudochain-api.onrender.com/healthz)。200 `{ok:true}` 只能證明服務在線，不代表已部署本次版本或 migration 已完成。

## 先確認部署，再做真人測試

1. Vercel 的前台 dev Preview 部署 `70d793b8` 成功；Admin 保留 `4fa38d56` 或包含該版本的新 staging 部署。
2. Render staging API／worker 包含 backend `40a60733`，Prisma Client 已更新。checked-in `infra/render.yaml` 的 API `preDeployCommand` 為 `npm run prisma:migrate:deploy`；若 Dashboard 已沿用該設定，部署會先跑 migration。不要只根據 git push 推定實際 Dashboard 配置或部署完成。
3. 同一個 staging runtime DB 中，`20261006090000_physical_gift_invitations` 的 `_prisma_migrations.finished_at` 非空、`rolled_back_at` 空，且 `PhysicalGiftInvitation` 表存在。沿用既有 migration 工作流程；本次 agent 沒有自行對遠端執行 migrate。
4. 前台與 Admin 的 Preview `DOUDOCHAIN_BACKEND_URL` 都指向 staging API。使用 staging 帳號／資料，不從正式站進行以下領取。
5. 檢查新入口：前台 `/tw/gift/invitation/staging-readonly-probe` 應存在；直接未登入 GET API `/v1/user/physical-gifts/invitations/sent` 應受權限保護，而非 route 404。這些是唯讀 smoke checks，仍不等於登入領取驗收。

CI：[Backend 本次提交](https://github.com/Chen-Hsien/doudoBackend/actions/runs/37410235788)。前台部署：[Vercel 本次提交](https://vercel.com/chenhsiens-projects/ichichain/5UnNCCM1cU4sm537ApwCY9upcdET)。本文件最後的「環境觀測」紀錄實際檢查時間與結果。

## 準備帳號與測試箱

- A：既有購買者，用一般瀏覽器 profile 登入。
- B：朋友，先用另一個未登入 profile 開啟邀請，然後沿用目前登入／註冊方式；不新增手機驗證步驟。
- C：第二位朋友，僅在測多人同時領取時使用第三個 profile。
- Admin：staging 的平台 `DOUDO_ADMIN`，具有 task campaign read／manage 權限。
- 至少準備 4 份未領取的測試箱資格，分別用於未送達、成功轉贈、撤回、換連結／競爭。可使用不同測試訂單，避免單一已領箱重複當作新案例。

在 Admin `/admin/physical-gifts` 找「宅配隨箱禮」SHIPMENT。沒有才建立；已存在就沿用，不另建第二個 SHIPMENT 方案。啟用「開放新增資格」、取消「暫停開啟禮包」與「暫停 Points 入帳」，填操作原因後「儲存設定」。新測試方案預算可設 100 Points；沿用既有方案時先確認預算能涵蓋已承諾、已保留及新增測試箱最大獎額，每箱最大 10 Points。

**方案先啟用，再正式出貨新的測試箱。** 啟用前已寄出的舊訂單不保證取得新資格，不要拿它判斷功能故障。

快速驗 UI／轉贈可用 staging 的 `MERCHANT_DIRECT` 測試訂單：沿用既有正式出貨流程，再於物流明細「隨箱禮包與裝卡紀錄」記錄裝箱。測成功收件時填本箱收件時間、測試簽收證據及原因，點「依證據確認本箱收件」。只在 staging 填測試證據；ECPay 的真實 callback 驗收另見下方。

## 建議依序測試

| 案例 | 操作 | 預期結果 |
| --- | --- | --- |
| 1. 本單與送達門檻 | A 在物流訂單頁點「查看隨箱禮包／送給朋友」；先用已出貨、尚未確認收件的箱，建立邀請給 B | 只出現本單禮包，沒有其他訂單或名片見面禮；B 可登入預覽，仍不能開盒；A／B 都不入帳 |
| 2. 新人正常領取 | Admin 確認該箱有效收件。A 分享私人連結，B 用未登入 profile 開連結，依現有流程登入／註冊 | 登入不增加手機欄位；只有預覽與機率表，不抽獎、不先綁資格。A 的該箱自己領取按鈕受阻 |
| 3. 確認開盒 | B 點「開啟朋友的禮包」，再點禮盒內「開啟隨箱禮」 | 沿用每日開盒動畫；得到固定獎勵，成功入帳顯示「Points 已入帳」。A 顯示朋友已領取；原訂單、收件資料與包裹仍在 A |
| 4. 重掃／刷新／多按 | B 重新開同一分享連結、刷新、查看結果；另以 C 開同一連結 | B 查回同一份結果，餘額只增加一次；C 不能領第二份。A 不能撤回、換連結或把已領的箱再送人 |
| 5. 撤回未領邀請 | 用另一份未領箱，A 產生連結後點「撤回邀請」，B 開舊連結 | 舊連結失效；A 可自己開這份原箱禮包，沒有新增第二份資格 |
| 6. 更換連結 | 用第三份未領箱，A 保存舊連結後點「產生新連結（舊連結失效）」 | 舊連結不能領；新連結可由 B 領取，仍只有原箱一份。重新整理 A 頁面後需重新產生才能再次取得可分享的秘密連結 |
| 7. 多人同時開盒 | 用新的可領邀請，B／C 各自登入並幾乎同時確認開盒 | 僅一人成功；另一人顯示已領或需重新查詢。總共只有一筆原 claim 與 Points 入帳 |
| 8. 兩箱與換帳號 | 同一 A 的另一箱也給 B 領；領取／產生連結途中切換帳號 | 不同箱各一次，不是每帳號終身一次；換帳號後不顯示前帳號私人連結或遲到的領取結果 |

案例 2／3 可沿用案例 1 的箱；其餘案例用不同未領箱。不要用已領箱嘗試清除核銷或重抽。

## 補充驗證

- **物流整合**：以綠界 sandbox 測試物流單驗證「配送中／到店待取仍不能領，可信成功取件／送達後才可領」。使用原 callback／官方查詢及「對帳本箱禮包」，不能只在 Admin 改一般送達標籤或替 ECPay 人工確認收件。這項驗的是 ECPay integration，商家直送 UI 成功不能代替它。
- **暫停及待入帳**：在 staging 暫停開盒後確認新邀請不能核銷；恢復後同一邀請可用。另可暫停 Points 入帳，確認開盒結果固定且顯示待入帳，恢復後由 maintenance worker 入帳一次。記住原設定，測完恢復。
- **回應中斷**：可用 DevTools 在測試 mutation 已提交時中斷回應。領取重試須回同一個 claim／獎額；撤回／換連結結果不確定時，畫面不再提供舊連結複製或分享。一般斷網不一定能重現「server 已提交」，這項本地已有針對性 regression，真人驗收需記錄實際時點。
- **秘密與追蹤**：B 進邀請頁後，網址的 fragment 憑證應消失；刷新仍可預覽。DevTools 中 GET 憑證在 `X-Gift-Invitation-Token`、POST 在 body，不在 API URL。測「直接開邀請」及「一般頁已載入追蹤 SDK 後再進邀請」兩種情境，網路輸出不得包含原 token；本地尚不能代替第三方 Hotjar 的實際網路觀察。不要把真 token 附在公開截圖或紀錄。
- **大量已送出紀錄**：若 staging 已有超過 50 筆，點「查看更多已送出的禮包」應取得第 51 筆並保留本單篩選。沒有資料時不必為人工測試建立 51 箱；本地真 PostgreSQL 與 UI 已驗該邊界。

## 留下驗收紀錄

每個案例記錄：前台／API／worker 版本、A／B／C 測試帳號代號、orderId、parcelId、邀請 ID（不記 token）、claimId、開出 Points、入帳前後餘額及結果。多次掃描／重試必須是同一 claimId、同一獎額；Points ledger／idempotency key 只一份。`Points 已入帳` 才算入帳完成，單有 HTTP 2xx 或動畫開盒成功不算。

## 環境觀測

初次 push 後：backend CI 執行中、Vercel 部署 pending、新 API 尚 404，已設定 migration DB 尚無新 invitation table。此初次結果已由後續唯讀觀測更新：

- Vercel `70d793b8` 部署 **success**，固定 Preview 為上方連結；dev alias 邀請頁 HTTP 200，包含正確邀請標題與 noindex。
- API `/healthz` HTTP 200；新 `/v1/user/physical-gifts/invitations/sent` 由 404 變成 **401**，確認入口已掛載且未登入受保護，未驗證 authenticated claim。
- 已設定的非正式 migration DB 中，`20261006090000_physical_gift_invitations` **2026-10-06 11:44:19 台北時間完成**，未 rollback，checksum 與本次提交 migration 相符，`PhysicalGiftInvitation` 表存在。agent 只有 SELECT，沒有人工執行 migration。
- 該連線與線上 Render runtime DB 的映射尚未獨立確認。GitHub 的 Render 部署紀錄也仍附舊 ref／SHA，不能單靠該紀錄宣稱精確 runtime commit；請在 Dashboard 核對 API／worker 的目前 commit 與 DB 指向。
- Backend 本次 commit 的 CI 仍執行中；沒有把 in_progress 當成通過。真人登入／物流／Points 驗收留給上述操作流程，agent 未自動發放測試獎勵。
