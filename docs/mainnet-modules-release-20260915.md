# 2026-09-15 正式合約部署與 backend 交接

鏈：Arbitrum One（42161）。合約來源：main `80afcd0`（PR #71）。操作期間 backend 維護狀態為 PAUSED，版本 10；未解除維護。

## 完整模組核對

| 合約／模組 | Proxy／地址 | Implementation | 結果 |
| --- | --- | --- | --- |
| DOUDO_PRIZE_BUYBACK_MODULE | `0x876668Ae85a7656434641F0CE51e55cf1b4F04aE` | `0x1D9683E3A8475e5FAf8f3b53e6Acd3696B4edFEa` | 新增；bytecode 比對通過 |
| DOUDOCOIN | `0x9f9D7D9A81e061a2F81C29588a8a98E43763C908` | `0x9f9D7D9A81e061a2F81C29588a8a98E43763C908` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_VRF_ROUTER | `0x13Ee37A43B012A772765089d8711b0Be42984010` | `0x13Ee37A43B012A772765089d8711b0Be42984010` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_PRIZE_DRAW_LIB | `0x1b2335610A4C67cb276498C756c099E60156E72e` | `0x1b2335610A4C67cb276498C756c099E60156E72e` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_TOKEN_URI_LIB | `0x62150A87EF65A89525b64F78868476241643De90` | `0x62150A87EF65A89525b64F78868476241643De90` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_CORE | `0x4749289F940F0C6B7cf68A19b0BDc611b80cdb0A` | `0x3E4b971c57cA67f82BD828c8B0F3Da0534AF358E` | 升級；bytecode 比對通過 |
| DOUDO_SERIES_OPS_MODULE | `0x21a55C40a4Dd25Ec83dec24527cDdfb232aD7e47` | `0x105dcf76D53923b02eB878F4F57819ec1e8b9574` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_BUNDLE_MODULE | `0x0aDe18AD89B9971229d5E6588a76d4bEeAaE4b8f` | `0x060994fB64964C1c178f851846dAE1Eb97434d3e` | 升級；bytecode 比對通過 |
| DOUDO_REFUND_MODULE | `0xD1d215c050aE51CFA6Eae0b236dEcD129cEddD3F` | `0x3d5b31caB0D3C8C8A7AB3e8C3eD802EF8227cb51` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_REDRAW_MODULE | `0xeDC87Ef2124ab0ee4B6fc1522A9b0F458A9B61ed` | `0x78c03EB5334F85922431DbfaB5C1B218c38Ec7b2` | 升級；bytecode 比對通過 |
| DOUDO_COLLECTION_REWARD_MODULE | `0x1f7D42b6e6064911C0E690cA44DC7e7d592a4549` | `0x3E47468a483eAd44A4c908aac5a2e9a6234C60b4` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_COLLECTION_BOOK | `0x150e44C0E1d9C80de474d9232cd958eaf05497f6` | `0x0fB83510ec60A5A91c507dC14a78A07D5782FAa9` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_COIN_NFT | `0xf1D77D5485cD80CCC32ada1100e40558EB58B5cA` | `0x76eeeBBDfD64504a92dAF89020fda1973BaFB31c` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_MERCHANT_REGISTRY | `0x178eF41099aC23730e63f7593A8d83c85ac496eE` | `0x2b9E4B4Bb1Df08eabdD73998d4c1C203A1643901` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_MERCHANT_PUBLISHER | `0xd4DF68df78e9e5389288B5c1E91eB3024060e363` | `0x4B78787e62972Bc308Dc4e683368a9750f833cdE` | 已一致，無需升級；bytecode 比對通過 |
| DOUDO_MEMBERSHIP_V2 | `0x3Fb8Df0381c96D95CEC8376FA1959E68EE1A0e94` | `0x84F4245C09518d66724511AC271C798fd6C1679C` | 已一致，無需升級；bytecode 比對通過 |

## Buyback 與索引

- Buyback proxy：`0x876668Ae85a7656434641F0CE51e55cf1b4F04aE`。
- 授權 signer：`0x82025d74b565E3A26deFC9bf01AFd53c620121A5`，與正式 Bundle 的 pointsAuthorizationSigner 相同。
- DEFAULT_ADMIN_ROLE／UPGRADER_ROLE：既有治理地址 `0xaf48208B55e4F21AEa32aa2E3ffa09284270E0f2`。
- OPERATION_ROLE：治理地址與既有 operation `0x75dbC2b4afbf720731EC02425fFa1D2b69D103B5`。
- Core 已授予 Buyback MODULE_ROLE，授權區塊 **505136506**，交易 `0xaf7c494450f7358b657ea7911792fa9285fcc8d48bca657b810d04fb6773dcd3`。
- Buyback proxy 部署區塊 **505136483**。Graph 動態 data source 必須涵蓋上述 MODULE_ROLE 事件；保留既有主網起始區塊，不能從授權事件之後才開始索引。
- 本次未部署或發布 The Graph，未重設任何既有系列／免單設定。

## 驗證

- 新版本 41 項合約測試通過；Core runtime 24553 bytes，未超過 EIP-170。
- 全部既有 proxy storage layout 驗證通過；正式鏈 fork 演練三項升級及 Buyback 初始化／角色授權成功。
- 升級前後 Core／Bundle／Redraw wiring、Points signer、Membership、DB Points 模式及 NFT totalSupply 相同。
- 使用 backend RPC 設定逐筆核對 10 筆正式交易成功回執及 canonical block hash，並確認四個 proxy implementation slot。
- 四個新 implementation 均已完成 Arbiscan 原始碼驗證。
- 完整交易、升級前後狀態與核對結果位於本 repo `deployments/mainnet-release-20260915*.json` 與 `mainnet-module-inventory-20260915*.json`。

## Backend 上線

backend `packages/config/src/index.ts` 的 chain registry 加入主網 Buyback proxy；不是設定舊的 PRIZE_BUYBACK_MODULE_ADDRESS 環境變數。
API 與 worker 必須部署包含該設定的同一版本。Render API 依 CI 部署，worker 依既有 runbook 手動部署；完成 Graph 同步與 runtime 驗收後才解除維護。
