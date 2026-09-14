# 免單挑戰：依設定當下剩餘抽數起算

## 本次範圍

調整 Bundle、Backend、Admin、The Graph。買家前端依需求不修改，由前端工程師接手。沒有部署、升級或變更地址。

## 規則與範例

- 設定上鏈時讀取剩餘抽數 R，接下來 N 抽有效；N 必須為正整數且不超過 R。
- 建立 workflow、預檢或簽核時不是起算點，交易實際執行才是。
- 全新 100 抽設定 N=20：第 1–20 抽有效。
- 已售 40、剩 60 時設定 N=20：第 41–60 抽有效，剩餘降至 40 時額度耗盡。
- 一般抽獎及挑戰購買都會消耗範圍；剩 5 抽時，挑戰 5 抽可行，挑戰 10 抽整輪拒絕，不拆單。
- 更新設定重新由當時剩餘量起算新版本；停用／更新不取消已購買輪次的結算和退款權利。
- 指定獎項耗盡、退款、多抽回饋和 DB Points 入帳流程不變。
- 達截止點可能仍保留 active=true；active 只是設定啟用旗標，不等於目前仍可購買。

## 合約相容性

只有 DoudoBundleModuleUpgradeable 需要升級；Core 不需變更。
setter 簽名仍為 setSeriesFreeOrderChallenge(uint256,uint256,uint256[])，第二參數改為相對 N。
不增加／移動 storage：儲存截止點 E = 原總量 T - 設定時剩餘 R + N。
舊 getter freeOrderChallengeConfigs 的 eligibleFirstTicketCount 及既有
FreeOrderChallengeConfigured 事件的 eligibleFirstTicketCount 仍代表絕對截止點 E，不是新設定的 N。
因此舊活動不需重設或搬移；已購買輪次仍依原 configVersion 結算。

新增事件 FreeOrderChallengeWindowConfigured：
seriesID、version 為 indexed；challengeTicketCount=N、startRemainingTicketCount=R、endSoldTicketCount=E。
每次設定先發既有 Configured，再發新 WindowConfigured。

## Graph／Backend 與前端交接

SeriesFreeOrderChallengeConfig 新增可空欄位：
challengeTicketCount、startRemainingTicketCount、endSoldTicketCount、calculationMode。
新設定 calculationMode=FROM_CONFIGURATION；歷史事件重播為 LEGACY_FIRST_N。
Backend 同名輸出數值為十進位字串；既有 eligibleFirstTicketCount 為 number，保留絕對截止點語意。
Graph 原生 triggerPrizeIDs 經 Backend 轉為 triggerPrizeIds。

前端判斷請以同一份最新系列狀態計算（大整數，不用浮點）：

```text
新活動 remainingEligible = max(0, min(Rcurrent, Rcurrent - (Rstart - N)))
舊活動 remainingEligible = max(0, min(Rcurrent, E - (T - Rcurrent)))
可購買 = active && 1 <= 整輪抽數 <= 10 && 整輪抽數 <= remainingEligible
```

新活動顯示「自設定生效起 N 抽，目前剩餘 X 抽可挑戰」。
不要將 challengeTicketCount 當成原系列第一 N 抽的截止點。
不要只用 active 顯示仍可參加；送單後仍須處理庫存競爭造成的合約拒絕。
更新／停用不得影響舊訂單的免單結果、結算重試與 DB Points 退款顯示。
新欄位不足時只可使用舊 cutoff 公式保守判斷，不可自行假設新的起點。

Admin／系列建立 payload 保留 eligibleFirstTicketCount 舊欄名，輸入語意為相對 N，
不是 Graph 同名輸出的絕對 E。通用合約 builder 另接受 challengeTicketCount 別名。
Admin 預檢以鏈上剩餘量檢查，不能依 Backend metadata 的原始獎項數量推估。

## 發布順序與注意事項（尚未執行）

1. 先部署新 Graph schema/mapping，保留原 deployment 起始區塊及地址，等待同步完成。
   Backend 新查詢會選取新欄位，不能先指向舊 schema。
2. 暫停設定免單的 operations；檢查舊版尚未送出的 workflow/tx intent，
   舊第二參數意圖為原始抽序，新版本解讀為相對 N，必須由營運重新確認或重建，勿直接批次重試。
3. 經授權升級 Bundle，接著發布 Backend 與 Admin；不要只發布 Admin 而合約仍用舊語意。
4. 前端工程師依本文件調整顯示；確認中途開啟／更新、剩 5 買 10、競爭購買、舊待結算輪次、
   免單成功 DB Points 入帳與失敗保留多抽回饋，再恢復設定操作。

不需要 DB migration，也沒有改動 DB Points worker、合約角色或測試網地址。

## 本地驗證

- Hardhat 編譯通過；split-module suite 32 項通過，包含中途啟用、一般購買消耗範圍、
  整輪超界拒絕、更新版本、DB Points 退款、多抽回饋與退款重試。
- Bundle runtime 22,587 bytes，低於 EIP-170 的 24,576 bytes；storage 宣告未改。
- Graph codegen/build 與 Bundle 6 項測試通過；新事件及 setter ABI 與合約編譯產物一致。
- Backend 六組相關套件原 198 項通過，追加 Core 剩餘量 ABI 測試後該套件 9 項通過；型別檢查通過。
- Admin 相關 37 項測試與型別檢查通過。全量測試有 398 項通過，
  另 6 個 DOM 測試檔因現有依賴缺少 jsdom 無法啟動，不能宣稱全量通過。
- 未使用瀏覽器；未執行 staging 實鏈流程、部署、升級或推送。
