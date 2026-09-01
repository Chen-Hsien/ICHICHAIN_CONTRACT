# 資料庫 Points、消費授權與 Membership V2 遷移規格

狀態：實作基準（不代表已部署）
目標環境：先於 Arbitrum Sepolia 驗證，設計本身不綁定單一 chain ID
最後更新：2026-08-31

## 1. 目的與責任邊界

本次切換把唯一支付媒介改為 Web2 資料庫 points。綠界只處理新台幣購買一般數位服務點數；鏈上只執行已由後端確認付款資格的抽獎服務、獎品 NFT 與不可轉讓會員 NFT。

| 責任                                        | 唯一來源                               |
| ------------------------------------------- | -------------------------------------- |
| points 可用、保留、扣除與退回               | 後端資料庫帳本                         |
| 綠界訂單及付款 webhook                      | 後端                                   |
| 消費授權內容及簽章                          | 後端授權 signer                        |
| 授權是否有效、是否重放、NFT mint 結果       | 合約                                   |
| 會員資格、180 天有效期、累積消費與 lifetime | Membership V2 合約                     |
| 消費回饋 points 入帳                        | 後端依鏈上事件冪等入帳                 |
| 查詢與歷史資料                              | The Graph、Admin；不得作為 points 帳本 |
| 用戶送出交易與確認                          | Privy EIP-7702 錢包；gas 可由平台贊助  |

這份規格是工程控制基準，不取代台灣律師、會計師、綠界或主管機關對實際商品、條款與營運模式的審查。

## 2. 不可破壞的會計規則

1. points 綁定正規化後的錢包地址，金額以 18 位精度的整數 raw value 儲存及傳輸；API 不得使用浮點數。
2. 單一錢包帳戶滿足 `available + reserved = 所有已入帳 ledger 的淨額`，兩者都不得為負數。
3. 所有餘額變化必須有不可變 ledger；不可直接改 balance 而沒有 ledger entry。
4. 每個外部事件都有唯一 idempotency key，例如綠界訂單編號、authorization ID、chain ID + tx hash + log index、migration case ID。
5. 綠界付款成功只新增資料庫 points，不 mint voucher、不 mint ERC20 points、不建立鏈上 mint intent。
6. 真正消費的 gross points 才增加會員 current qualifying spend 與 lifetime spend；付款儲值、會員回饋、促銷回饋與退款都不增加會員消費進度。
7. 會員回饋依本次交易執行前的有效等級計算；鏈上事件產生 reward entitlement，後端確認交易成功後才入帳。
8. 全系統對消費者只呈現一種 points。退款、回饋、收集冊、推薦與促銷全部改發資料庫 points。

建議帳戶欄位：

- `walletAddress`：正規化地址，唯一鍵。
- `availableRaw`、`reservedRaw`：decimal/numeric(78,0) 或等價整數字串。
- `frozenAt`、`freezeReason`：拒絕新儲值後服務與新消費。
- `version`：樂觀鎖或交易鎖版本。

建議 ledger 最少欄位：

- `entryId`、`walletAddress`、`amountRaw`、`balanceBucket`。
- `entryType`：payment、spend、release、refund、membership_reward、legacy_voucher、legacy_points、campaign、manual_adjustment、chargeback。
- `referenceType`、`referenceId`、`idempotencyKey`。
- `metadata`、`createdAt`、`createdBy`。

## 3. 綠界入帳

1. 建立訂單時把訂單綁定當下登入並驗證過的錢包地址；付款完成後不得改派到另一錢包。
2. webhook 必須先驗證綠界檢查碼、商店代號、金額、訂單狀態與本地訂單內容。
3. 在同一個 DB transaction 中鎖定訂單、檢查尚未入帳、寫入 payment ledger、增加 `availableRaw`、標記訂單已入帳。
4. 重複 webhook 只回成功，不得再次加點。
5. 退款或 chargeback 優先扣 `availableRaw`；不足時凍結帳戶並進人工處理，不得讓 balance 變成負數。

鏈上退票與免單退款另採原子沖銷規則：合約依每張票保存的原購買錢包、實付 points 與會員回饋，退款同筆交易反轉 Membership V2 的 current／lifetime 進度並標記該票已退款；後端以 settlement event 同時記錄退款本金與負數 `MEMBERSHIP_REWARD_REVERSAL`。資料庫 points 購買的票只有原購買錢包仍為持有人時可以退款；票券轉讓後不得退款，避免把原購買人的會員回饋扣到受讓人帳戶。即使回饋已被消費，回饋沖銷也直接由本次退款本金抵扣，因此帳戶不會出現負餘額；若事件中的回饋沖銷大於退款本金，合約與後端都必須拒絕，不能靜默入帳。

## 4. 消費、授權與鏈上 mint 狀態機

正常流程：

`AVAILABLE -> RESERVED -> AUTHORIZED -> SUBMITTED -> CONFIRMED`

失敗流程：

- 授權過期且未上鏈：`AUTHORIZED -> EXPIRED -> RELEASED`。
- 交易 reverted：確認 receipt 後 `SUBMITTED -> FAILED -> RELEASED`。
- receipt 未定案：保持保留，不得提早釋放。
- 已確認：`CONFIRMED` 後將 reserved 永久扣除並寫 spend ledger；不可再釋放。

後端鎖點與簽發授權必須在受鎖定的 DB transaction 內完成狀態轉換。每個 reservation 只對應一個不可重複的 `authorizationId`。

### EIP-712 Authorization

授權至少綁定：

- `authorizationId`：`bytes32`，全域唯一。
- `buyer`：保留 points 的同一錢包，也是合約 mint 接收者與交易意圖擁有者。
- `seriesId`。
- `luckyNumbersHash`：`keccak256(abi.encode(luckyNumbers))`。
- `ticketQuantity`。
- `grossPoints`：合約依當下售價重算後必須完全相等。
- `revealImmediately`。
- `freeOrderChallenge`。
- `deadline`。

EIP-712 domain 必須綁定 name、version、當下 chain ID 與 verifying contract，因此同一授權不可跨鏈或跨合約使用。

合約執行順序：

1. 檢查資料庫 points 授權模式已啟用。
2. 檢查 `msg.sender == buyer`、期限、數量、lucky numbers hash、報價及後端 signer。
3. 檢查 `authorizationId` 未使用，並在外部呼叫前標記為已使用。
4. 更新開場折扣等合約內會計狀態。
5. 由 Core mint 抽獎 NFT，必要時同筆交易 reveal。
6. 同筆交易以 `gross points - 合約 bundle rebate` 的實際淨消費呼叫 Membership V2 的 `recordConsumption`。
7. 發出包含 authorization、gross spend、rebate/refund entitlement、會員 reward entitlement 與 token 範圍的事件。

合約不 burn 或 mint 舊 ERC20 points。EIP-7702 只改變錢包送交易與 gas 贊助方式，不改變上述授權內容、`msg.sender` 綁定或合約驗證。

## 5. Membership V2

Membership V2 是一錢包一枚、不可轉讓的 ERC-721。正常消費由抽獎合約在同一筆交易更新；後端 operator 只用於有稽核資料的初始切換與等級修正，不提供使用者自行換錢包。

### 固定會員門檻

| 等級     | current qualifying spend 門檻（18 位 raw） |          回饋率 |
| -------- | -----------------------------------------: | --------------: |
| Common   | 1 raw unit（10^-18 point，沿用舊合約數值） |           0 bps |
| Silver   |                               9,000 points | 25 bps（0.25%） |
| Gold     |                              48,000 points | 75 bps（0.75%） |
| Platinum |                              90,000 points | 150 bps（1.5%） |
| Emerald  |                             180,000 points | 250 bps（2.5%） |

### 有效期與累積

1. 每次成功消費把 `lastActivityAt` 更新為 block timestamp，`expiresAt = lastActivityAt + 180 days`。
2. 若下一次消費發生時已逾期，先把有效等級回到 `NONE`、`currentQualifyingSpendRaw` 歸零；本次沒有 pre-spend 會員回饋，再以本次消費重新建立進度。
3. `lifetimeSpendRaw` 永不因逾期歸零。
4. 本次回饋為 `netPointsConsumed * preSpendRewardBps / 10_000`，向下取整。
5. 正常記錄以 `authorizationId` 防重；同一授權不可重複增加進度。
6. tokenURI/metadata 反映當下會員等級與有效狀態；過期資訊不得誤導為仍可取得回饋。

### 管理還原與修正

operator 可依唯一 `caseId` 對原錢包指定會員等級、current qualifying spend、lifetime spend、last activity 與 expiry；這只供初始 snapshot migration 或有稽核證據的修正。系統不提供 Points 換錢包 API、不接受使用者自行指定目的錢包，也不搬移原錢包 Points。每次修正都必須防重、留下 admin audit 與完整鏈上事件。

## 6. 舊資產遷移規則

### 舊 voucher

1. 以切換 snapshot 的實際持有量直接換成資料庫 points。
2. 換算時沿用舊合約算法，包含 snapshot 當下仍有效會員等級的回饋。
3. voucher 換得的實際 points（含已確認要計入的會員回饋）依既定舊邏輯更新 Membership V2 進度。
4. 每筆以 `legacy-voucher:<chainId>:<contract>:<tokenId>:<wallet>:<snapshotBlock>` 防重。

### 舊 ERC20 points

1. snapshot 餘額以原始 18 位 raw value 等額入帳資料庫。
2. 不再增加會員進度，避免與歷史 voucher／消費重複計算。
3. 每筆以 `legacy-points:<chainId>:<contract>:<wallet>:<snapshotBlock>` 防重。

### 舊 NFT 與 points 合約失效

- 舊 voucher 與舊 membership NFT 保留歷史，但合約層全域標記取消；停用 mint、redeem、approve 與 transfer，metadata 顯示 canceled。
- 發出包含 snapshot block、snapshot root 與生效時間的全域 cancellation 事件。
- 前端不再顯示舊 voucher、舊 membership 與舊 points 餘額；Admin 與 subgraph 保留稽核歷史。
- 舊 ERC20 points 撤銷 minter/burner，所有支付、退款、回饋、collection reward、referral 與 campaign 路徑停止讀寫。角色撤銷與 upgrade 是部署操作，另行審批，不由程式提交自動執行。

## 7. 切換 runbook

1. 停止建立綠界訂單、付款入帳、mint、reveal、refund、redeem、voucher exchange、會員更新、collection reward、referral、campaign reward 與人工點數調整。
2. 等待綠界 webhook、鏈上 tx intent、VRF/reveal、refund 及背景工作進入可對帳終態。
3. 記錄 snapshot block、DB snapshot timestamp、程式版本、合約地址與 Merkle root。
4. 在持續暫停營運下，先用獨立的 DB migration job 匯入舊 voucher 與舊 ERC20 points；逐筆寫 ledger、依 manifest digest 防重並產生已驗證 gate receipt。鏈上腳本不連線也不修改資料庫。
5. Chain cutover 必須驗證 gate receipt 的 chain ID、snapshot block/root、migration ID 與預先核准的 manifest SHA-256 後，才部署／升級新合約、啟用新模式並註銷舊合約。Membership V2 的 current/lifetime/expiry 另以可重跑的會員 migration 流程匯入。此步必須獲得明確部署授權。
6. 切換 backend／worker feature flag，再切換 subgraph、frontend、Admin；所有服務版本與環境值一併記錄。
7. 執行小額 canary：綠界入帳、reserve、7702 送交易、mint、會員更新、refund/reward 入帳、失敗釋放、重放拒絕。
8. 確認總額及抽樣 wallet 對帳後才恢復營運。

### 已提供的切換操作面

- Chain preflight：`npm run cutover:database-points:arbitrum-sepolia:preflight` 或 Arbitrum One 對應指令。預檢 Bundle、Refund、Collection Reward 與舊 NFT 的 UUPS storage layout、CollectionBook reward target、執行錢包角色、snapshot block/root 及 authorization signer；預設不送交易。
- DB points migration：在 backend 以 `npm run migration:database-points` 執行。manifest 每筆包含 `walletAddress`、`sourceType`（`LEGACY_POINTS`／`LEGACY_VOUCHER`）、唯一 `sourceId` 與 18 位 raw 整數 `amountRaw`。預設只驗證；寫入另需 `EXECUTE_DATABASE_POINTS_MIGRATION=1`、`OPERATIONS_PAUSED=1`、`POINTS_MIGRATION_MANIFEST_PATH`、`DATABASE_POINTS_MIGRATION_MANIFEST_SHA256` 與 `DATABASE_POINTS_MIGRATION_GATE_PATH`。每筆 transaction 寫入不可變 ledger 並更新 account；重跑只驗證既有 ledger，不重複入帳。全部逐筆驗證後才原子寫出 gate receipt。
- Chain execution：只有同時設定 `EXECUTE_DATABASE_POINTS_CUTOVER=1` 與 `OPERATIONS_PAUSED=1`，且 DB migration gate 通過，才會升級 Bundle／Refund／Collection Reward／舊 NFT、部署或重用 Membership V2、啟用資料庫 points 授權與 entitlement 模式並全域註銷舊 collection。腳本以鏈上狀態為準跳過已完成動作，並把 Membership proxy 與完成階段寫入 checkpoint，因此中途失敗可安全續跑；執行仍須另行取得部署授權。
- 必填 chain 參數：`DOUDO_BUNDLE_MODULE_PROXY_ADDRESS`、`DOUDO_REFUND_MODULE_PROXY_ADDRESS`、`DOUDO_COLLECTION_REWARD_MODULE_PROXY_ADDRESS`、`DOUDOCOIN_NFT_PROXY_ADDRESS`、`DOUDO_POINTS_ADDRESS`、`POINTS_AUTHORIZATION_SIGNER_ADDRESS`、`BACKEND_OPERATION_ADDRESS`、`LEGACY_POINTS_MINTER_ADDRESSES`、`LEGACY_POINTS_BURNER_ADDRESSES`、`LEGACY_SNAPSHOT_BLOCK`、`LEGACY_SNAPSHOT_ROOT`、`LEGACY_CANCELLED_TOKEN_URI`；執行另需 `CUTOVER_CHECKPOINT_PATH`、`DATABASE_POINTS_MIGRATION_GATE_PATH`、`DATABASE_POINTS_MIGRATION_ID`、`DATABASE_POINTS_MIGRATION_MANIFEST_SHA256`、`DATABASE_POINTS_MIGRATION_ENTRY_COUNT` 與 `DATABASE_POINTS_MIGRATION_TOTAL_RAW`，可另設 `MEMBERSHIP_V2_PROXY_ADDRESS`、`MEMBERSHIP_DEFAULT_ADMIN_ADDRESS`、`POINTS_CONFIG_GOVERNANCE_ADDRESS` 與 `LEGACY_SNAPSHOT_MIN_CONFIRMATIONS`（預設 20）。snapshot 必須不高於 RPC `finalized` block 且符合最低確認數，不能以 `latest` 冒充 finalized。Points signer 必須與 backend、會員 admin、Points 治理地址及 cutover signer 分離，且不持有任何 protocol role。腳本會把 Bundle／Refund／Collection Reward 的 `POINTS_CONFIG_ROLE` 留給 admin／multisig、只把 Bundle `MEMBERSHIP_OPERATOR_ROLE` 給 backend，並撤銷 backend 的 Bundle `OPERATION_ROLE`。兩個舊 Points role 清單必須先由部署紀錄與鏈上事件完整盤點；若經事件與角色盤點確認某類角色為空，必須明確填 `NONE`。執行腳本會逐一撤銷並驗證。
- 腳本會同時升級 Refund Module、Collection Reward Module 並開啟資料庫 points 模式。一般退票與免單退款發出含退款本金及會員回饋沖銷額的 settlement event；收集冊 points 獎勵發出專用 entitlement event。後端 receipt reconciler 以 `chainId + txHash + logIndex` 冪等入帳，不再增發舊 ERC20 points。
- backend 與 worker 必須在同一個暫停切換窗口設為 `DATABASE_POINTS_MODE_ENABLED=true`；推薦獎勵此後直接冪等寫入資料庫 points ledger，不再建立 `mintWithReason` 鏈上交易。切換前所有舊推薦 reward tx intent 必須先進入終態。
- 資料庫 points 補發：`POST /v1/admin/payments/points/credits` 由 `OPS_RUN` 建立待核申請，另一位具 `OPS_APPROVE` 的管理員呼叫 `POST /v1/admin/payments/points/credits/:requestId/approve` 後才入帳。每日限額預設為 0；限額變更需兩位不同且皆非申請人的核准者。所有金額使用 raw 18 位整數，並以類型與 reference 產生冪等鍵、寫入 admin audit/event log。
- 會員快照／修正：Admin mint operation 只開放 `MEMBERSHIP_V2_SET` 與系列 NFT；不提供使用者 Points／會員換錢包。舊 Voucher、鏈上 Points、Membership V1 建立入口在 API 與 Admin 都停用。

## 8. 上線門檻

- 合約：storage layout upgrade validation、authorization 重放／過期／錯 wallet／錯 chain／錯 price／錯 lucky numbers 測試、同 tx 會員更新、Soulbound、逾期、行政遷移測試。
- 後端：ledger 不變式、webhook 冪等、並發 reserve、receipt reconciliation、reward 冪等、chargeback freeze、migration restart 測試。
- 整合：EIP-7702 sponsored transaction 在目標 chain 成功與失敗路徑；不得把 relayer nonce 當成用戶消費 nonce。
- 資料：snapshot 前後 points 總額、會員 current/lifetime、舊 voucher 數量逐項對帳。
- 法遵／商務：正式商品說明、使用條款、退款與失效規則、綠界品項及商店審查由專業顧問和綠界書面確認。
