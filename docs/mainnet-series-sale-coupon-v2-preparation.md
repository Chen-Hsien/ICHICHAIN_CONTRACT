# Arbitrum One 限時販售與 Coupon V2 升級準備

此流程針對現有 Bundle、Fixed Probability、SeriesOps 三個 UUPS proxy；不建立新 proxy、不改 wiring、不切換 operator、不設定任何系列的截止時間。此腳本沒有正式網簽章／送單路徑，也不載入 `.env` 或私鑰。正式網部署與升級仍需另外取得明確授權。

## 產物與唯讀準備

先確認 checkout 與 compiler artifacts/cache 完全一致；腳本會逐一比對 compiler input 的所有來源檔案內容。執行前編譯：

```sh
npx hardhat compile
PREPARATION_RPC_URL=https://arb1.arbitrum.io/rpc npx hardhat run --no-compile --config hardhat.mainnet-preparation.config.cjs scripts/prepareMainnetSeriesSaleCouponV2.cjs --network preparation
```

輸出 `reports/mainnet-series-sale-coupon-v2/<releaseHash>/release.json`，以 SHA-256 命名且禁止覆寫不同內容。檔案含固定 block/hash、管理員 nonce、三個 proxy 的原 implementation、runtime hash、storage layout、現有設定、權限與跨模組 wiring、compiler source bundle，以及 9 筆未簽名交易。三個全新 library 部署在前，其次三個 implementation 部署，最後三個 proxy 的 `upgradeTo`。所有部署地址依管理員 nonce 預測，只是規劃值，不能當作已部署正式網身分。

檢查失敗即停止，不以 `unsafeAllowCustomTypes` 或略過 storage check 繞過。Fixed 的原 implementation、proxy、三個 library runtime 必須符合既有正式網 deployment artifact。Bundle 與 SeriesOps 的 implementation 地址必須符合既有正式網 inventory；runtime hash 會在唯讀快照建立並固定，歷史 inventory 沒有提供預先核准的 runtime hash，操作員仍須核對此兩個既有 implementation 的來源驗證。

本次另已取得兩個舊 implementation 的官方 Sourcify v2 已驗證來源資料：SeriesOps `0x105dcf76D53923b02eB878F4F57819ec1e8b9574`、Bundle `0x060994fB64964C1c178f851846dAE1Eb97434d3e`。Sourcify 的 creation/runtime 等級皆為 `match`，不是 `exact_match`。其鏈上 bytecode、依 API 宣告的 immutable 值修補後之重編譯 bytecode，均與獨立正式網 RPC 取得的 runtime 完全相同；入口 Solidity 來源亦符合 repo 歷史 commit `80afcd0`。補充證據封存在 release 目錄的 `baseline-source-evidence/baseline-source-evidence.json` 與官方原始回應。這是可重查的來源與 bytecode 證據；本次未重新執行歷史 compiler，也不宣稱它是先前操作員簽核過的 runtime hash。

## 本機 fork 演練

Anvil 必須從 Arbitrum One 固定區塊 fork，chain ID 為 42161；腳本會對每筆本機交易明確呼叫 `evm_mine`。只接受 HTTP localhost 與 Anvil fork metadata；遠端主機即使宣稱相同 chain ID 也無法進入送單路徑。

```sh
PREPARATION_RPC_URL=http://127.0.0.1:18957 MAINNET_PREPARATION_MODE=fork npx hardhat run --no-compile --config hardhat.mainnet-preparation.config.cjs scripts/prepareMainnetSeriesSaleCouponV2.cjs --network preparation
```

腳本先建立 snapshot，僅在本機 impersonate 現有管理員，依序部署並升級。每筆檢查成功 receipt、canonical block hash、部署地址、精確 runtime hash；每次升級檢查 `Upgraded` 事件與 EIP-1967 slot。完成後檢查所有原設定、counter 與 upgrader 維持一致，Bundle/Fixed 回傳 Coupon V2，SeriesOps/Fixed 舊系列預設 schedule 為 revision=0、無截止、啟用中。`fork-rehearsal.json` 明確標註 simulation，最後僅移除本流程尚未 mined 的 pending 交易並回復 snapshot，再核對 canonical head 與封存 `fork-cleanup.json`。演練產物不能用於正式網 runtime pin。

## 正式網操作順序

1. 發布前重做唯讀準備，核對固定區塊、管理員 nonce、implementation slot、角色與 wiring；若有 pending 管理員交易先處理並重建產物。不能直接使用 fork 預測地址或舊 nonce。
2. 經明確授權後，由操作員的既有安全簽章流程依 `transactions` 順序先部署三個 library 與三個 implementation。逐筆以正式網 receipt 與實際 runtime 驗證，保存真實地址、transaction hash、block/hash。任何 nonce 被其他交易使用都必須重新準備，不能沿用舊 calldata。
   六筆部署完成後，建立 JSON 對照檔（key 使用 release 內的 `deploy:合約名稱`，value 為真實 transaction hash），唯讀執行下列檢查。此檢查逐筆核對 chain ID、sender、nonce、完整 creation calldata、receipt、canonical block、部署地址、部署時與目前 runtime；並要求三個 proxy 仍維持 baseline、管理員 nonce 已到第一筆 upgrade 的預期值。檢查通過只代表部署與 baseline 可核對，不會送升級交易。

   ```sh
   PREPARATION_RELEASE_FILE=/path/to/release.json PREPARATION_DEPLOYMENT_RECEIPTS=/path/to/deployment-tx-hashes.json PREPARATION_RPC_URL=https://arb1.arbitrum.io/rpc npx hardhat run --no-compile --config hardhat.mainnet-preparation.config.cjs scripts/verifyMainnetSeriesSaleCouponV2Deployments.cjs --network preparation
   ```

3. 用真實正式網部署 receipt、compiler build-info 與 library 地址產生 runtime activation 證據。backend/frontend 先部署同時接受舊 implementation 與明確核准新 implementation 的版本；Coupon V2、截止時間排程功能維持關閉。
4. 重查 baseline 與角色，再由已授權管理員執行三個 proxy 的 `upgradeTo`。不呼叫 initializer、不重新授權、不改 operator。以真實 `Upgraded` receipt、slot、runtime 與設定保留結果封存升級界線。
5. 更新 backend/frontend 正式網固定版 artifact 與 runtime pin，讓舊交易／舊訂單沿原 implementation 歷史區塊驗證。同步 Graph ABI/資料來源並確認索引追上後，才啟用需要的新功能與系列 schedule 工作。

截止時間操作權限：正式網 server operation 地址 `0x75dbC2b4afbf720731EC02425fFa1D2b69D103B5` 必須在 SeriesOps 擁有 `OPERATION_ROLE`，在 Fixed 擁有 `OPERATOR_ROLE`。腳本會檢查，不會補 grant。截止時間狀態採 optimistic revision；API/worker 必須讀取目前 revision，並使用對應系列的 `setSeriesSaleSchedule`，避免覆寫較新的操作。

本次準備不證明正式網已部署候選 implementation、不執行正式網升級、不替代 Graph 重建與 backend/frontend 部署驗收。
