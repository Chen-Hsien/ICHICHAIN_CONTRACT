# 固定機率 UUPS 主網部署

## 範圍

將合約 origin/dev 整合至 main，新增部署 `FixedProbabilityLotteryV3Upgradeable`、三個固定連結 library 與 ERC1967Proxy。保留 `deployments/arbitrum-one.json` 的既有 Core、會員、Router 與其他模組；不重部署既有套件、不升級既有 Proxy、不執行資料庫估值 cutover。

網路為 Arbitrum One，chain ID 42161。初始參數取自已提交的 `deployments/arbitrum-one.json`；讀回主網 bundle 的 `pointsAuthorizationSigner()` 核對授權簽署錢包。禁止從 staging 環境覆蓋主網角色。

| 對象 | 地址／來源 | 權限 |
| --- | --- | --- |
| 管理／部署者 | `0xaf48208B55e4F21AEa32aa2E3ffa09284270E0f2` | DEFAULT_ADMIN_ROLE、UPGRADER_ROLE |
| 營運錢包 | `0x75dbC2b4afbf720731EC02425fFa1D2b69D103B5` | 新合約 OPERATOR_ROLE |
| 授權簽署錢包 | `0x82025d74b565E3A26deFC9bf01AFd53c620121A5` | mint authorizationSigner、BUYBACK_AUTHORIZER_ROLE |
| 新 Proxy | 由部署 receipt 決定 | Router requester、會員 CONSUMPTION_RECORDER_ROLE |

## 執行順序

1. 編譯與 focused contract tests，核對 ABI 與 storage layout handoff、implementation 小於 24,576 bytes。
2. `npm run deploy:fixed-probability:uups:arbitrum-one:preflight` 唯讀檢查鏈別、部署者、既有相依、角色及餘額，不送交易。
3. 設定 `MAINNET_FORK_JOURNAL` 為 repo 外的獨立檔案，執行 `npm run deploy:fixed-probability:uups:arbitrum-one:fork`。fork 使用本機 Anvil 的主網狀態及受限 implementation 大小，模擬交易不寫入主網部署紀錄。
4. 將已驗證的合約與部署工具推送 main，再執行 `npm run deploy:fixed-probability:uups:arbitrum-one`。此命令需 `ARB_MAINNET_RPC_URL`、匹配管理錢包的 `ARB_MAINNET_PK`；不得輸出憑證。
5. 每筆交易先保存 hash，再等待兩次確認。中斷後使用同一命令及同一 journal 接續，不刪除 journal 重跑。
6. 讀回 Proxy implementation slot、UUID、runtime、EIP-712 domain、簽署地址、會員與 Router 及全部角色；驗證通過才標記 verified。
7. 將主網證據與部署交接文件提交並推送 main。Frontend／Backend／Admin／Graph 的使用端切換另依實際發布流程執行，部署完成不代表應用端已啟用。

主網紀錄：`deployments/fixed-probability-uups-arbitrum-one.json`。fork 紀錄必須獨立並含 simulation=true，不可當作主網部署證據。原有 ADMIN／UPGRADER／既有模組權限不撤銷；營運及授權錢包不取得新合約管理或升級權。

## 本次編譯核對

主網編譯 ABI SHA256 與已驗證 staging 相同，implementation runtime 24,014 bytes；合約與三個 library 的原始檔及未連結 runtime bytecode 均與 staging 相同。35 個 storage 項目的 slot、offset、型別及成員遞迴比較一致。

整個 repo 重編譯會改變 solc AST/type ID，原始 storage layout JSON 雜湊因此不同。主網使用本次編譯產生的 `fixed-probability-uups-mainnet-artifact.json` 綁定 layout 雜湊，不改寫 staging 的歷史 artifact。兩份 layout 的實際儲存排列已另行核對。

Fork 使用 Anvil 的 Cancun 規則在目前 Arbitrum 狀態模擬這些相容 EVM 合約；fork 不能代表 Arbitrum 的實際費率或完整 sequencer 行為。主網成功與費用以實際 receipt 為準。
