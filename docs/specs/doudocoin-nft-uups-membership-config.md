# DOUDOCOINNFT UUPS 與會員設定規格

## 目標

將目前不可升級的 `DOUDOCOINNFT` 改為 UUPS proxy 架構，保留既有 Voucher、會員、兌換回饋、ERC721 與事件介面，並讓管理員可在不更動 metadata URI 的情況下設定會員門檻與回饋比例。

預設會員設定如下：

| 等級 | 門檻 | 回饋比例 |
| --- | ---: | ---: |
| NonMembership | 0 | 0% |
| Common | 1 wei DOUDO | 0% |
| Silver | 9,000 DOUDO | 0.25% |
| Gold | 48,000 DOUDO | 0.75% |
| Platinum | 90,000 DOUDO | 1.5% |
| Emerald | 180,000 DOUDO | 2.5% |

## 權限與升級

- `DEFAULT_ADMIN_ROLE`：管理角色、券種、會員設定與 reward token。
- `MINTER_ROLE`：鑄造 Voucher 與會員 NFT。
- `UPGRADER_ROLE`：唯一可授權 UUPS implementation 升級的角色。
- `MIGRATOR_ROLE`：只用於從 immutable 舊合約搬移既有 NFT 與會員狀態；切換完成後必須撤銷。
- implementation 建構子必須停用 initializer；proxy 只能初始化一次。
- 初始化參數不得為零地址。

## 會員設定不變量

- `rewardBasisPoints` 不得超過 10,000。
- 等級索引必須存在。
- 除 NonMembership 外，門檻必須嚴格大於前一級；非最高級時也必須嚴格小於下一級。
- `updateMembershipLevel` 保留既有四參數 ABI，可同時更新門檻、URI 與比例。
- 新增 `setMembershipLevelConfig(levelIndex, threshold, rewardBasisPoints)`，只更新門檻及比例並保留 URI。
- 兩個設定入口皆發出完整的 `MembershipLevelUpdated` 事件。

## 狀態與相容性

- UUPS proxy 是新的部署地址；目前 immutable 合約不能原地轉成 proxy。
- 新合約保持既有公開讀寫 ABI、角色名稱及事件形狀，讓前端、後端與 The Graph 只需切換地址與起始區塊。
- storage 只允許在尾端追加，並保留 storage gap。
- 正式切換前必須盤點並遷移舊合約的券種、持有 NFT、會員累積額、等級與最後活動時間；不得只切地址而遺失狀態。
- 遷移依舊 token ID 遞增執行，保留 token ID、owner、voucher type 與會員 userInfo；已燃燒 token 形成的 ID 缺口不重新鑄造。
- `userVoucherCounts` 無法從舊合約完整列舉歷史鑄造量，只能依遷移當下仍存在的 Voucher 重建；這不影響 NFT 所有權，但正式切換前須確認是否仍需沿用歷史限購計數。
- proxy 必須取得 DOUDO points 的 `MINTER_ROLE`，舊合約角色是否撤銷由獨立切換程序決定。
- ERC721 token approval 與 operator approval 屬於舊合約地址，無法搬到新 proxy；切換後使用者必須重新授權。

## Arb Sepolia 切換清單

2026-07-22 唯讀盤點舊合約 `0x35d6650973B713193C9D0Ef96E4EbFB61B96B7B7`：14 個券種、20 個現存 NFT（10 Membership、10 Voucher）、12 個 holder，其中 10 個 holder 為合約錢包。正式遷移前必須重新 dry-run，合約錢包需確認可接收新 proxy 的 safe mint。

| Consumer | 切換項目 |
| --- | --- |
| DOUDO points | 新 proxy 取得 `MINTER_ROLE`；舊合約撤權需另行核准 |
| Frontend `/Users/angustsai/ichichain` | NFT proxy 地址及 `NEXT_PUBLIC_DOUDO_COIN_NFT_START_BLOCK` |
| Backend `/Users/angustsai/doudochain-backend` | `DOUDO_COIN_NFT_ADDRESS` 與預設 registry 地址 |
| The Graph `/Users/angustsai/thegraph/doudochain_amoy` | `subgraph.yaml`、`networks.json` 的地址及 start block，重新部署索引 |
| Admin `/Users/angustsai/doudo-admin` | 目前未找到會員合約 ABI／設定頁；若新增操作 UI，使用 `setMembershipLevelConfig` 並驗證排序與 10,000 bps 上限 |

部署腳本預設只做 dry-run。正式部署須明確設定 `EXECUTE_DOUDOCOIN_NFT_UUPS_DEPLOY=1`；存在合約 holder 時還需完成 receiver review 並設定 `ALLOW_CONTRACT_HOLDER_MIGRATION=1`。部署後先驗證 owner、token ID、券種、會員 userInfo、角色與 DOUDO mint 權限，再進行 consumer 切換。

## 驗證

- 初始化只能執行一次，implementation 不可初始化。
- 非管理員不可設定會員配置，非升級者不可升級。
- 預設六級的名稱、門檻、URI 與 basis points 完整一致。
- 設定成功後事件參數及 getter 必須完整一致；不存在索引、錯誤排序與超額比例必須拒絕。
- UUPS 升級後 ERC721、券種、會員設定、角色及 user state 必須保留。
- 編譯、完整測試、upgrade safety、bytecode size 與 `git diff --check` 必須通過。
