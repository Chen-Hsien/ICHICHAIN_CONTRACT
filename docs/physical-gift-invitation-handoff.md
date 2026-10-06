# 隨箱禮包贈禮邀請交付

日期：2026-10-06。需求來源與產品行為見 [spec](physical-gift-invitation-spec.md)。這份擴充沿用已交付的固定 QR／物流資格／隨機禮包功能。

## 使用流程

購買者在既有物流訂單頁點「查看隨箱禮包／送給朋友」，進入本單禮包列表。尚未領取的隨箱禮可產生私人連結、複製或由裝置分享；購買者自行分享，不由系統寄送訊息。有效邀請期間，購買者不能自己開盒；撤回可恢復自己的領取權，重新產生會使舊連結失效。

朋友使用原有 Privy 登入／註冊，不增加手機、地址驗證。進頁、登入、預覽不會綁定資格；確認開盒時，原箱資格歸給朋友，抽取與入帳沿用既有每日禮盒畫面及 Points 流程。訂單、包裹及收件資訊仍歸購買者。朋友已領取後，購買者只能看到已送出紀錄，不能撤回或再送。

持有連結且成功登入的人有領取權；這不是收件身分驗證。請私下分享，先成功確認者取得這一份原箱資格。相同紙卡及 QR 不受影響。

## API 與資料

- `GET /v1/user/physical-gifts?orderId=<id>`：依登入帳號驗證本單，回傳既有資格與已送出摘要。
- `POST /v1/user/physical-gifts/entitlements/:id/invitation`：建立／替換本人的未核銷隨箱禮邀請。
- `POST /v1/user/physical-gifts/invitations/:id/revoke`：撤回未核銷邀請。
- `GET /v1/user/physical-gifts/invitations/sent?cursor=<id>&orderId=<id>`：已送出摘要的獨立分頁，只接受本人的已核銷邀請 cursor。主列表第一頁附 `sentInvitations`／`nextSentCursor`，畫面以此取得後續紀錄；不受自身資格是否還有下一頁影響。
- `GET /v1/user/physical-gifts/invitations/:id`：以 `X-Gift-Invitation-Token` 驗證後預覽，不寫入歸戶／claim。
- `POST /v1/user/physical-gifts/invitations/:id/claim`：body 只有 `{ token }`；recipient、wallet、points 不接受 client 輸入。

上述路由沿用 EdgeInternal／Privy／UserGuard 與 canonical platform user ID。秘密只在建立／替換時回傳，DB／audit 不存原文；前台分享連結使用 fragment，讀入後移除 fragment，放在本頁 history state 保留刷新與登入恢復。不是 localStorage 或 React Query cache。邀請頁不送自動分析 pageview、不初始化分析 SDK。手動分享仍含 fragment，API secret 在 header／body，回應 no-store。

`PhysicalGiftInvitation` 每個 entitlement 一筆，tokenHash 唯一，狀態為 ACTIVE／REVOKED／CLAIMED，SQL CHECK 固定各狀態的核銷欄位。領取與撤回／替換沿用 budget → order 的鎖順序。資格歸戶、固定抽取、原 claim、預算扣記、邀請核銷於同一 DB transaction；既有 grantClaim 與 worker 使用原 idempotencyKey，只入帳一次。物流未送達、取消／退回、活動暫停與預算限制仍生效。

## 需求與驗證對照

| ID | 實作入口 | 驗證證據 |
| --- | --- | --- |
| I1 | invitation page、原 wallet connect、claimInvitation | guest→登入→預覽→開盒 UI；訂單／parcel owner 不變的 PostgreSQL assert |
| I2 | createInvitation、entitlementId unique | 他人／WELCOME 不可分享；每箱原 entitlement／claim 數量不增 |
| I3 | claim、createInvitation、revokeInvitation | 原 owner 領取受阻；替換舊 token 404；撤回 idempotent；已核銷不能變更 |
| I4 | readonly getInvitation、confirm chest POST | GET 與列表不產生 claim；不同朋友並行只有一位成功 |
| I5 | syncOrderParcel、ensureEntitlement、refreshEligibility | 未收件／暫停／待補資／退回／缺 wallet 保留邀請且不歸戶 |
| I6 | budget/order locks、createClaim、grantClaim、worker | 朋友／owner／撤回／替換並行；失去入帳回應、新 service 與 wallet 切換仍原 draw／ledger |
| I7 | hashed token、controller validators、proxy、private page metadata | 真實 Nest guards／嚴格輸入／預覽無 PII；header/body transport；token 不進 URL／query key，history 恢復；邀請頁無自動分析輸出 |
| I8 | LogisticsOrder、PhysicalGiftSharing、PhysicalGiftClient | 本單 href／初始及分頁 transport、複製／撤回、換帳號遲到回應不顯示；已送出第 51 筆分頁；撤回／替換已提交但回應丟失不再顯示舊連結；每日禮盒與機率表沿用 |
| I9 | additive migration、既有 source/worker/Points | 真實 PostgreSQL 由 pre-feature schema 逐份套用原 migration＋新 migration，SQL CHECK／FK／unique 測試；物流／evergreen／每日開盒回歸 |

## 驗證邊界與上線順序

驗證使用隔離 PostgreSQL 16（127.0.0.1:15489，每個 suite 隨機建立／刪除 DB）、Prisma 6.19.3、ts-jest 的當前 service／worker 函式、real Points repository，以及前台 jsdom。不是正式 API／BullMQ worker，也沒有瀏覽器驗收、正式物流 callback、正式 DB 或鏈上操作；依 frontend AGENTS 未跑 production build。

新增 migration：`20261006090000_physical_gift_invitations`。先以既有部署流程套用這份 migration，再發 backend API／worker，最後 frontend。既有已套用 migration 完全不改。這次未自動套用遠端 migration，也未自行部署／push；目前為本地 WIP。審查與精確測試結果見 review 與 snapshot。
