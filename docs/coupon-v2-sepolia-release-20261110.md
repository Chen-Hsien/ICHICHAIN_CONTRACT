# 優惠券 V2 測試鏈部署交接（2026-11-10）

目標僅Arbitrum Sepolia（421614）；正式鏈未變更。Bundle與固定機率沿用既有proxy及原始startBlock，新增V2 implementation與linked libraries。upgrade receipt、runtime hash、ABI與來源摘要、前後設定核對保存在deployments/coupon-v2-arbitrum-sepolia.json；固定機率舊implementation／libraries保存在implementationHistory。

| 合約 | Proxy（Graph持續索引） | 新implementation | 升級區塊 | 升級交易 |
|---|---|---|---|---|
| Bundle | 0x68cBA2b3c72Be39be748B06c1e6dDab2855E91b6 | 0x012bf347dCA264BfE6456D301a82615a274Ed864 | 327750353 | 0x731b6f3b8544d76b169b3577c01f47784141babe251efab4c7bed6b741bc53e6 |
| Fixed | 0x51a9f7f467498fee72eFBe37043897A3c225F235 | 0x02904B450DC737fFEFA940c1DEe3424b739FF65b | 327750427 | 0xd430971a274653bdae58d7f66ff9643541157aa00b54474c01fbcea09510e53b |

兩個proxy的couponAuthorizationVersion()均為2。鏈上slot、Upgraded事件、成功receipt及implementation runtime均已核對，wiring／簽章者／暫停狀態保留，固定機率計數未回退。59項本機合約測試通過；兩個新implementation的Arbiscan原始碼驗證均成功。最初library交易等待receipt介面失敗後，使用既有deploymentReceipt helper從同一journal續跑；沒有重送該筆library部署。

Graph更新ABI與事件已在優惠券PR實作；本次更新實際implementation／library證據，不將source指向implementation，不重置起始區塊。proxy建立receipt與舊ABI hash保留原義；新ABI hash另存couponV2Upgrade。

原始Graph repo含未提交工作，部署使用隔離的develop checkout，從origin/develop正常fast-forward整合本次已驗證變更，保留來源commit及完整部署履歷，不修改原worktree，也不藉用CI環境變數冒充branch。

本次範圍為合約與Graph。後端固定機率identity gate仍有implementation位址／runtime hash pin，需依本部署記錄更新並發布後端，才能通過新版合約白名單；本次不部署後端、前端、後台或啟用活動，未宣告整個購買鏈已上線。
