# 折抵券 V2 合約交接

日期：2026-11-09。這份文件描述本機程式；未部署、升級或執行鏈交易。

## 定價與授權

`G` 是券前售價小計，`B` 是購後回饋，`C` 是本次券折抵，`N=G-B-C`。立即應付為 `G-C`。V2 僅接受 `C>0`、`C % 10^18=0`、`N>=10^18`、非零 `pricingSnapshotHash` 及 `pricingVersion=2`。

Bundle 新增 `mintTicketsWithPointsAuthorizationV2(PointsMintAuthorizationV2,uint16[],bytes)` 與 `pointsAuthorizationDigestV2`。型別保留 V1 欄位順序，再追加 `couponDiscount:uint256`、`rebatePoints:uint256`、`netPoints:uint256`、`pricingSnapshotHash:bytes32`、`pricingVersion:uint256`。EIP712 primary type 為 `PointsMintAuthorizationV2`，domain 沿用 `DOUDO Database Points`、version `1`。

固定機率 UUPS 新增 `requestDrawsV2(DrawAuthorizationV2,bytes)` 與 `authorizationDigestV2`。型別保留 V1 欄位順序，再追加 `couponDiscount:uint256`、`pricingSnapshotHash:bytes32`、`pricingVersion:uint256`。EIP712 primary type 為 `DrawAuthorizationV2`，domain 沿用 `FixedProbabilityLottery`、version `3`。

兩者使用實際 chain ID 與 proxy 地址作 domain。兩者都提供 `couponAuthorizationVersion()=2`，並共用各自既有的 authorization ID 去重映射。簽章直接綁定 G、B、C、N、買家、數量、系列、deadline、snapshot 及版本。Bundle 同時綁定選號 hash，固定機率同時綁定 config hash 與 eligibility key。

既有 deadline 為 inclusive，`block.timestamp>deadline` 才過期。券期限為 exclusive，因此後端簽章 deadline 不得晚於券截止前一秒。

## 逐票與退款

Bundle 先依既有規則把 B 分到一般價票。V2 拒絕 B 超出一般價票總額的舊設定。每張票得到剩餘容量後，依固定票序分配 C。每步使用 `floor(剩餘C × 本票容量 / 剩餘容量)`，再扣除本票容量及折抵。`Math.mulDiv` 避免乘法中間值溢位。相鄰相同淨額的票合併呼叫 Core。

Core 的 `pointsPaid` 合計為 N。會員消費、逐票會員回饋、一般退款及免單退款均沿既有入口使用這個淨額。固定機率保留既有 `Order.netPoints=N` 作鏈上帳務與免單退款權威；每 draw 的來源成本由後端分攤保存。

## 事件與相容性

V2 發出 `DatabasePointsPurchaseMintedV2`，欄位依舊 DB purchase 事件順序，再追加 C、snapshot hash、version。原 `grossPoints` 保留 G，`netPointsConsumed` 為 N。固定機率另發 `OrderRequestedV2`，欄位依舊 OrderRequested 順序再追加 C、snapshot hash、version。

V2 不發舊 `DatabasePointsPurchaseMinted` 或 `OrderRequested`。V1 仍使用原型別、事件及定價。通用 `TicketPurchaseMinted.priceInPoints` 與 Bundle `OpeningDiscountApplied`、`FreeOrderChallengePurchased` 的支付價欄位在 V2 填 G-C，回饋仍為 B，因此舊支付價減回饋等於 N。

兩個 UUPS 核心均未新增、刪除或重排 storage。既有 gap、Order 及票券狀態布局不變。固定機率的 `createSeries` 配置寫入及事件移入既有 `FixedProbabilityConfigValidation` linked library，核心保留權限檢查與 ID 遞增。library 仍是部署時固定連結，沒有可變路由或獨立狀態。

## 本機驗證檔案

`test/coupon-v2.test.js` 驗 G/B/C/N、完整事件、V1 兼容、跨版本 nonce、簽章竄改、整點及最低淨支出、逐票尾差、零容量、部分退款、免單與 NFT callback 重入。

`test/fixtures/coupon-v1/pre-coupon-contracts.json` 保存實作前 HEAD 的 ABI 與正規化 storage layout hash。新實作逐項核對 ABI 與 storage，並檢查 EIP-170 runtime 上限。

`test/fixtures/coupon-v1/authorization-v2-golden.json` 是後端及前端共用固定 fixture，包含兩種 typed data、digest、selector、calldata 及完整事件。`node scripts/generateCouponV2Fixture.cjs` 可重建。

驗證命令為 `npx hardhat test test/coupon-v2.test.js test/doudochain-v2-module-split.test.js test/fixed-probability-v3.test.js test/fixed-probability-buyback.test.js`。所有呼叫都在本機 Hardhat，沒有真實 RPC 或憑證。

本機結果：上述四個 suites 共 59 個測試通過。最後補強的 coupon suite 共 11 個測試通過。runtime 為 Bundle 24,393 bytes、固定機率核心 22,603 bytes、ConfigValidation library 6,712 bytes、Settlement library 4,421 bytes，均低於 24,576 bytes。
