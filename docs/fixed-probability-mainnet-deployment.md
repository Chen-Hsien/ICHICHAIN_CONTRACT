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

## 主網實際部署結果

- 程式發布 commit：`a0e4776ffa2a0b68e9660e730dd198d237d9c801`；已先推送 main，再執行部署。
- Chain：Arbitrum One（42161）。Proxy：`0x8Fc4977a5A999DB2Efaccd1EcEA090A542a61723`；startBlock：`520016196`；部署交易：`0x3787935fd3d74a6ee051cc590108d9ac9f8f7c237502e630fc88d8d44fe8e4cf`。
- Implementation：`0x9CAC1EeaeCE9e2C6674340Ce3171b0452A124ff3`；runtime 24,014 bytes。Proxy、implementation 與三個 library 均已在 Arbiscan 驗證，Proxy 已連結 implementation。
- 主網共 8 筆交易成功，總費用 0.000160716787404769 ETH；每筆 receipt 的 sender、chainId、status 與 canonical block hash 均已核對。
- 18 項部署檢查及另一次固定 block 的 10 項錢包角色／5 項相依權限核對通過。三個 library、implementation、Proxy 的實際 runtime 與 fork 演練一致。
- 管理／升級錢包為 `0xaf48208B55e4F21AEa32aa2E3ffa09284270E0f2`；營運錢包為 `0x75dbC2b4afbf720731EC02425fFa1D2b69D103B5`；mint／回購簽署錢包為 `0x82025d74b565E3A26deFC9bf01AFd53c620121A5`。Proxy 已授予 Router requester 與會員 CONSUMPTION_RECORDER_ROLE。
- fork journal 再次執行未產生新交易，nonce 維持不變。主網 journal status=verified、pending=null。
- 完整證據在 [主網部署紀錄](../deployments/fixed-probability-uups-arbitrum-one.json)。OpenZeppelin manifest 保留原有全部 Proxy／implementation，只新增本次一組。
- 未執行 DB migration／估值 cutover，未變更比值或發票開關，未切換 Frontend／Backend／Admin／Graph 至新地址。
