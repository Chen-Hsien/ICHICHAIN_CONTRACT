# 固定機率 NFT 回收換站內 Points 可驗證規格

- 日期：2026-10-15，Asia/Taipei。
- 狀態：待決策設計稿。需求、接口與驗收基準已定義；不是已實作或可部署證明。
- 目標：固定機率 NFT 接回既有回收頁、逐獎報價、交易恢復、Points 入帳、商品權益與成本報表。
- 對照向量：[fixed-probability-buyback-v1.json](../fixtures/fixed-probability-buyback-v1.json)。向量的測試地址不是可用部署。
- 延續既有 V3 的購買、VRF、實體兌換與開獎歷史，不另建回收頁、點數帳戶或逐筆人工審核產品。

## 使用者最新範圍決策（2026-10-15，優先於下方舊相容規劃）

使用者明確指示：「暫停舊系列甚至移除都可以，沒有兼容的必要」。本次停止舊 constructor V3 的系列營運與新購買入口，單一 active deployment 切換至新 UUPS Proxy。D-01 採「停用舊系列、不做產品相容」；BB-14、T-35 中要求保留舊 V3 系列／NFT／訂單畫面及雙部署恢復路由的部分，依使用者決策不納入本次驗收。這是需求範圍變更，不宣稱既有相容驗收通過。

切換前先停止新 quote／簽章，確認舊 V3 沒有 HELD 點數或未完成 purchase／refund／membership／ledger 帳務，才停用 DB 系列並發布新 active address。若仍有 pending，先排空。保留原 chain NFT、Graph 既存歷史、DB 與 ledger 稽核資料；不刪除帳務、不搬移／burn 舊 NFT、不將舊 V3 誤認為支援新 buyback。此次不新增雙部署抽獎／歷史／兌換路由。

## 1 版本與證據基準

以下是重新 fetch 的遠端分支快照，不代表線上 API、worker 或 subgraph 的版本。本規格只新增文件與資料向量；未合併分支、修改業務程式或操作鏈上狀態。後續實作必須在乾淨的工作目錄依各 repo AGENTS.md 同步指定基準，再重新檢查這些證據。

| Owner | 分支與完整 commit | 已核對的實作 |
| --- | --- | --- |
| Contracts | `origin/dev` `532552840e8111d2c876992da771a115af49f21c` | `contracts/FixedProbabilityLotteryV3.sol`；`contracts/modules/DoudoPrizeBuybackModuleUpgradeable.sol` |
| Backend | `origin/develop` `a81e1debeb76ce70cfe50f0e7a7de0619428126d` | `apps/api/src/buyback/`；`apps/worker/src/prize-buyback.ts`；`packages/contracts/src/prize-buyback.ts`；`packages/shared/src/points-valuation.ts` |
| Admin | `origin/develop` `7011abaa2cda402ffa150156cd14daf85ad6f84e` | `src/features/admin-console/series-details.tsx`；`buyback.tsx` |
| Frontend | `origin/dev` `a990b973215ab6a35f088da67a084e755dbc829d` | `app/lib/fixed-probability/catalog.ts`；`app/hooks/buybackTypes.ts`；`doudochainBackendClient.ts` |
| The Graph | `origin/develop` `be682ba287a9e85d96d8a10cc80fc5da18796156` | `src/fixed-probability.ts`；`src/prize-buyback.ts`；`schema.graphql` |

V3 公開部署紀錄：Arbitrum Sepolia，chainId `421614`，NFT 合約 `0x745Cb4540696Cf67a453aA3cE301CA50e1239fc5`，startBlock `313999040`。runtimeHash `0x82961dac68ec55ffa2daf7ba35053a6e84a8bf024528c8722426f60725e9451c`。來源：`deployments/fixed-probability-v3-arbitrum-sepolia.json`。本輪沒有讀取實際持有人、線上 endpoint 或 runtime bytecode；正式驗收必須另留證據。

已確認的阻塞：

1. V3 沒有公開 burn／回購接口，且是 constructor 直接部署的 ERC721，沒有代理升級路徑。現有回購模組要求的 Core 接口不能直接用於 V3。
2. BuybackService 將來源固定為 DOUDO_CORE，並讀取 V3 沒有的 ticketStatusDetail／requireBuybackDeadlineOpen。
3. 固定機率購買 SPEND 寫 contractAddress／orderId，沒有回購估值器目前要求的 coreAddress／fundingTokenPrices。以此形狀重現 BUYBACK_VALUATION_SOURCE_PENDING。
4. Graph 固定機率 Transfer handler 對 to=zero address 使用 assert，真正銷毀會使該 handler 失敗。
5. Admin 詳情排除固定機率回購面板；Frontend 固定機率獎項 buyback 固定為 null。

## 2 完成範圍與必要決策

「完整完成」須同時滿足一般購買所得、轉手、歷史 NFT 與特殊帳務來源的規則；不能以新部署可回收宣稱所有既有固定機率 NFT 已接通。

| 決策 | 規劃建議與限制 | 關閉決策需要的證據 | 未決時的行為 |
| --- | --- | --- | --- |
| D-01 既有 V3 NFT | 新部署採第 6 節原生回購；既有 V3 不假裝可以升級或由新模組直接 burn。既有 NFT 必須列入相容性範圍 | 按鏈／合約固定 snapshot 的系列、NFT、owner、已揭曉／已兌換及 pending VRF 清單；確認採新部署切換、需另立規格的遷移，或明確接受舊 NFT 不支援的範圍例外 | 舊部署回 UNSUPPORTED_BUYBACK_DEPLOYMENT，保留資產／兌換／歷史；不得顯示已全面支援 |
| D-02 零淨消費與免單來源 | 有價格不代表一定有完整估值。不得將缺少來源當零基準，也不得任意用現在匯率 | 產品與帳務確認 gross、rebate、refund 各類的原始比例、已退款基準與回購額度規則；提供完整 ledger fixture、精確期望估值與無重複消費的測試 | 尚未明定的來源在簽章及 burn 前回 BUYBACK_VALUATION_SOURCE_PENDING；列出原因，不能永久靜默排除 |

本輪不授權部署、改角色、送鏈上交易、遷移資產、發布服務或自動建立 GitHub Issue。這些是後續執行階段；本規格中的測試交易預設限隔離本機鏈。

## 3 可追溯需求

| ID | 必須成立的行為 | Owner | 驗收 |
| --- | --- | --- | --- |
| BB-01 | 回收取得站內 Points，不 mint ERC20、不當成原購買退款、不新增會員消費 | Backend | T-01、T-22 |
| BB-02 | 全路徑以 chainId、NFT 合約地址、tokenId 識別資產；seriesId 同樣有部署範圍 | 全 repo | T-02、T-03 |
| BB-03 | 已揭曉、本人持有、未兌換／履約、未過期、有效逐獎價格且無衝突操作才可回收 | Backend、Contracts | T-04～T-09 |
| BB-04 | 報價、接受、簽章前重驗價格、權益、期限與可入帳來源；未設定價格不可回收 | Backend、Admin | T-10～T-12 |
| BB-05 | 真正 burn 由持有人發起並綁定不可重放簽章；全批原子成功或失敗 | Contracts | T-13～T-16 |
| BB-06 | 接受報價與實體兌換／集冊等共用原子 claim；只有可證明安全時釋鎖 | Backend | T-17、T-18 |
| BB-07 | 只憑成功且 canonical 的完整 burn 證據建立應付；Graph、錢包回報不能直接發點 | Backend | T-19、T-20 |
| BB-08 | 先獨立保存應付，再冪等入帳；故障恢復不漏點、不重複 burn／發點 | Backend | T-21、T-23 |
| BB-09 | 資金來源映射可追到原始買家，即使 NFT 轉手；新舊與台幣基準未知不能當零 | Backend | T-24～T-27 |
| BB-10 | Graph 接受 burn、保留歷史、從可用資產移除，來源互不污染 | The Graph | T-28、T-29 |
| BB-11 | 釋放未履約配置、移轉約定商品權益，不新增採購成本或回補抽數 | Backend、Contracts | T-22、T-30 |
| BB-12 | 沿用既有 Admin、回收頁、歷史與報表；個別批次顯示已銷毀待入帳等真實狀態 | Frontend、Admin | T-31、T-32 |
| BB-13 | 部署能力、ABI、receipt verifier 與 registry 一致；新簽章停用不停止舊批次恢復 | 全 repo | T-33、T-34 |
| BB-14 | V3 舊資產不被遺漏或誤稱可 burn；特殊來源須關閉決策後才全量開放 | 全 repo | T-25、T-35 |

## 4 資產識別與 API 契約

```ts
type BuybackAssetRef = {
  source: 'CORE' | 'FIXED_PROBABILITY';
  chainId: number;
  contractAddress: `0x${string}`; // NFT 合約，不是交易 target
  tokenId: string;             // canonical uint256 十進位字串
};
```

地址先驗證再小寫正規化。source 不能單獨決定信任，必須與伺服器 deployment registry 的鏈別、合約、協議及 runtimeHash 相符；任意 caller address 不得成為可信目標。每批只能包含同一鏈／NFT 合約／回購執行目標；同一批 tokenIds 嚴格遞增、無重複，points 與 token 一一對應。

沿用 `/v1/user/buyback`：

| 接口 | 規劃增量 |
| --- | --- |
| GET eligible-tokens | 接受 source／deployment 範圍；items 回完整 AssetRef、seriesDbId、seriesId、prizeId、priceRaw、policyVersion、exchangeDeadline、eligibility。不可用原因以穩定 reasonCode 顯示於既有資產／入口，不把「尚未啟用」偽裝成無 NFT |
| POST quotes | 新 body 為 `{assets: BuybackAssetRef[]}`，整筆最多 50 張；暫不跨鏈。可以同鏈多部署，依完整範圍拆 batch。每個 batch 保存來源及執行目標。回應帶 schemaVersion、quoteHash、expiresAt、各批 item／總額／部署快照 |
| POST orders/:id/intents | 沿用 executionMode、本人 wallet 與 ownership 驗證；按 batch 的可信部署快照建立 intent，不使用目前單一全域 module 地址替換 |
| GET orders、orders/:id | 保留新舊訂單並回批次來源；歷史不能因新部署切換而消失 |

相容輸入 `{tokenIds: string[]}` 僅代表當前 registry 的原 CORE，不推測為固定機率。同時傳 assets 與 tokenIds 拒絕。未傳 source 的舊清單維持 CORE；新回收頁按支援部署分頁／合併，不能把全平台游標當某部署的 tokenId 游標。游標須綁 wallet、部署、排序與 snapshot；聚合時保留各部署 cursor，頁面過濾後仍持續向後掃描。

前端 key、勾選集合、query key、去重、報價提交與收據刷新均使用完整資產鍵。部署來源從服務器回應取得，不從 tokenId 猜測。多部署訂單不是一筆鏈上原子交易，UI 必須顯示逐批進度及部分完成。

## 5 資格、期限與價格

資格以有效逐獎收購價決定，不以 A/B/C、小賞或機率推定。政策與 accounting 沿用共同 Series／seriesDbId。系列停售不自動取消既有 NFT 回收；仍依回購政策與期限判定。缺少部署能力、merchant、metadata、期限或估值證據時，回明確阻擋碼。

固定機率目前的有效兌換期限：

```text
exchangeDeadline = DrawSettled.blockTimestamp + effectiveMerchantExchangeWindowDays * 86400
effectiveMerchantExchangeWindowDays = merchant.exchangeWindowDays ?? 14
authorizationDeadline = min(chainNow + 300, 全批 exchangeDeadline 的最小值)
```

`14` 來自現行 DEFAULT_EXCHANGE_WINDOW_DAYS；實作應引用該常數。揭曉時間只能來自同部署 canonical DrawSettled，不使用 NFT mint 或 API 收到請求的時間。鏈上時間與 API 時鐘差異超過 30 秒時拒絕新簽章，錯誤碼 BUYBACK_CLOCK_SKEW；單元測試固定兩個時間，不依測試機現在時間。

邊界：chainNow 等於 exchangeDeadline 時仍有效，超過一秒即失效。過期檢查與合約一致使用 `>`。已到貨不是回收前提；「未到貨」可通過。估計到貨時間不得新增為固定機率回收門檻。

quote 保存 merchant 天數、揭曉事件、有效期限及政策／帳務／估值版本快照；accept 及簽章前重驗。如果未接受前 merchant 天數、政策或權益版本改變，回 BUYBACK_QUOTE_STALE，要求新報價。簽出的授權按其固定 deadline 生效；政策停用或期限縮短不保證立即撤銷該簽章。緊急撤銷使用既有合約 pause／撤銷簽章角色，由授權維運操作。

鏈上驗證簽章 deadline；商家 DB 期限及價格由授權服務可信判定。此方案不宣稱合約能獨立驗證 DB 天數、掛單、帳戶或實體履約。若要求改成獨立鏈上期限，須另版規格及鏈上期限來源，不可偷偷將判斷移回前端。

穩定錯誤碼至少包含：UNSUPPORTED_BUYBACK_DEPLOYMENT、BUYBACK_NOT_OWNER、BUYBACK_UNREVEALED、BUYBACK_ALREADY_EXCHANGED、BUYBACK_FULFILLED、BUYBACK_EXPIRED、BUYBACK_ACTIVE_LISTING、BUYBACK_ASSET_BUSY、BUYBACK_POLICY_DISABLED、BUYBACK_METADATA_PENDING、BUYBACK_QUOTE_STALE、BUYBACK_VALUATION_SOURCE_PENDING、BUYBACK_CLOCK_SKEW。錯誤不得附帶私有商家約定、簽章、RPC URL 或個資。

## 6 新部署的合約方案

依使用者 2026-10-15 最新指示，採「固定機率 UUPS Proxy＋原生 buyback」：新核心直接暴露與既有回購模組相同的 buyback tuple、consumed getter 及 PrizeBuybackBurned 事件。保留 V3 抽獎函式／事件與設定編碼；以部署能力版本區分，不讓原 V3 地址冒充支援回購。此方案避免為固定機率偽造 redraw，也不改既有 Core 的回購模組。

```solidity
struct BuybackAuthorization {
    bytes32 batchId;
    address buyer;
    address coreAddress;
    bytes32 itemsHash;
    bytes32 quoteHash;
    uint256 totalPoints;
    uint256 deadline;
}
function buyback(BuybackAuthorization calldata auth,
    uint256[] calldata tokenIds, uint256[] calldata points,
    bytes calldata signature) external;
function consumed(bytes32 batchId) external view returns (bool);
event PrizeBuybackBurned(bytes32 indexed batchId, address indexed buyer,
    address indexed coreAddress, uint256[] tokenIds, uint256[] points,
    uint256 totalPoints, bytes32 quoteHash);
```

EIP-712 domain 沿用 `DOUDO Prize Buyback`、version `1`、當前 chainId、verifyingContract=該批實際執行地址。原 Core 批次為回購模組；新固定機率原生批次為 NFT 核心，事件 emitting address 與 coreAddress 均為新核心。原 V3 mint 的 domain 與 buyback domain 分開計算，不能覆寫原本的 authorizationDigest／eip712Domain 語意；兩個 domain 的正反向驗證必須測試。

`itemsHash = keccak256(abi.encode(uint256[] tokenIds, uint256[] points))`。authorization 欄位順序與 typehash 精確沿用既有定義。batchId、quoteHash 非零；buyer=msg.sender、coreAddress=address(this)、deadline 未過、batch 未消耗。1～50 張、每張 points>0、嚴格遞增 tokenIds、長度一致、sum=totalPoints、itemsHash 相等。回購 signer 使用專用 BUYBACK_AUTHORIZER_ROLE；不自動將 mint signer 視為回購 signer。

執行順序：nonReentrant／whenNotPaused → 驗簽與格式檢查 → 標記 consumed → 每張檢查存在、owner、prizeId 非零、未 exchanged → 真正 `_burn` → 最後發 PrizeBuybackBurned。錯誤必須 revert 整批，連 consumed、先前 burn、事件一起回滾。ownerOf 不存在時拒絕，不以 Draw 預設零值判定存在。批准的 operator 不能代替 buyer 發起回購；不得加入 admin 任意 burn 接口。

每張 ERC721 Transfer(owner, zero, tokenId) 先於最後回購事件；保留 Draw、Order、prizeId、原始 buyer／recipient、VRF 與帳務資料。burn 不設 exchanged=true，因兩者是不同事實。不得減 acceptedDraws、退 eligibility 額度、改 drawCap、機率、退款或 Membership；不能產生替代 NFT。原生 buyback 不外部 mint／轉點；所有外部依賴與回呼邊界納入重入測試。

實作修訂（2026-10-15，取代先前不可升級新部署方案）：新核心為 `FixedProbabilityLotteryV3Upgradeable`，使用 OpenZeppelin UUPS／ERC1967Proxy，部署時原子呼叫 `initialize(router, signer, operator, membership, initialAdmin, upgrader)`。Implementation constructor 呼叫 `_disableInitializers()`；Proxy 只能初始化一次，所有依賴與角色地址均拒絕零值。`UPGRADER_ROLE` 與 mint signer、`BUYBACK_AUTHORIZER_ROLE` 分開；`_authorizeUpgrade` 只接受明確的升級角色。既有已部署的 constructor V3 不會因此取得 Proxy 升級能力。

新核心使用與一番賞相同的 MinimalAccessControlUpgradeable／LightweightGuardsUpgradeable，搭配 ERC721Upgradeable，保留 storage gap。為符合 EIP-170，固定連結三個 library：`FixedProbabilityConfigValidation`（設定與雜湊）、`FixedProbabilitySettlement`（購買建檔／事件、VRF 結算與會員帳務）、`FixedProbabilityBuybackValidation`（回收格式與驗簽）。library 不能在原 implementation 內換址；更換連結需升級 implementation，且須重新驗證 code／storage。結算 library 的 storage references 只由具 guard 的核心傳入，所有對外呼叫及事件仍由 Proxy context 執行。

目前核心 implementation 為 24,014 bytes，測試 V2 為 24,247 bytes，均 <=24,576 bytes；測試必須檢查 implementation，不得只檢查很小的 Proxy runtime。不能以 Hardhat allowUnlimitedContractSize 代替可部署證明。升級測試須執行 OpenZeppelin storage-layout validation，拒絕不相容布局，並驗證舊 NFT、批准、角色、抽數、未完成 VRF、Order／Draw、accounting、consumed 及未到期簽章延續。

EIP-712 的 verifyingContract、NFT address、執行目標與 Graph entity scope 一律使用 Proxy。mint domain 仍為 FixedProbabilityLottery／3，buyback domain 仍為 DOUDO Prize Buyback／1，不因 implementation 換址而改成 implementation domain。

部署 registry 必須記錄 `proxyKind=uups`、Proxy runtimeHash、implementationAddress／implementationRuntimeHash。簽章前在同一 block 核對 Proxy code、ERC1967 implementation slot、implementation code 及其 proxiableUUID，不能只驗 Proxy codehash。Recovery 在 burn receipt 的 block 核對 implementation；可接受已保存快照、目前核准實作或保留在 approvedImplementations 的歷史實作，不依新簽章 enabled 開關。未知實作不發點、不釋鎖，轉 NEEDS_REVIEW。

## 7 簽章前的帳務來源證明

每張 NFT 必須有可信 funding origin，至少保存：AssetRef、order／reservation、原始 SPEND ledger ID、逐 NFT 購買價分攤、原始 valuation snapshot、rebate／refund ledger 關聯與來源版本／hash。當前持有人可以不是原始買家；不能只掃當前 wallet 的 SPEND。

固定機率需確認 order 已 SETTLED、reservation 扣點與既有回饋／免單退款均已正式入帳、原始來源可唯一辨識，才建立可授權計畫。沿用原購買工作流的證據門檻，不以回收流程強制完成原訂單；尚未完成時回可重試的待帳務原因。

一般多抽分攤：按 tokenId 數字遞增，`base = netPoints / quantity`，前 `netPoints % quantity` 張各多 1 raw unit。所有分攤合計精確等於 netPoints，不能用 JS Number 或小數運算。gross、rebate、refund 各自保留，不能把「已免單」直接當成缺資料，也不能單憑 DrawSettled 判定購買／退款已入帳。

新帳務寫入需提供 valuation adapter 可理解的 coreAddress／fundingTokenPrices 或等價明確映射；它們是相容欄位，coreAddress 在固定機率表示 NFT 合約。還要保留原 contractAddress／orderId／product 等既有欄位。不可單加地址別名卻沒有逐 NFT 與 ledger 證據。

歷史資料以可重建的來源映射補足，不覆寫已入帳的 SPEND、發票快照或原始 valuation。建議新增 `NftFundingOrigin` 投影表，唯一鍵 `(chainId, contractAddress, tokenId)`，保留 sourceLedgerId、fundingPointsRaw、evidenceJson、version、proofHash 與來源類型。歷史重建需核對已知 requestDraws receipt、NFT 範圍、reservation 與 ledger，差異／多重來源進待核，不把舊式 legacyExempt 旗標自行套到固定機率。

規劃新增 batch item 的 `fundingOriginSnapshotJson`／`fundingOriginHash`，以及 batch 的 `valuationPlanHash`。簽章前在交易中鎖定來源與政策，使用現行 Points valuation engine 預計算本批回購 allocation，再保存計畫與簽章。計畫含原始來源比例、legacy/current 分攤、已知 basisTwdRaw、policyVersion；quoteHash 綁定該計畫。來源或依賴版本不相符時不簽章。

來源與計畫只能由已核驗的服務端證據產生，API 不接受 caller 宣告 legacyExempt、原始 ratio 或可直接入帳的 valuation plan。consume／settle adapter 必須能讀取可信歷史投影；不能只保存計畫 hash 卻繼續用原本缺資料的查詢入帳。DB migration 保留舊 API／worker 的讀取相容；新型 FP 批次須由支援該協議的恢復 worker 處理，不讓舊 worker 取得新批次 lease。

回購點數依原始來源比例，不能用回收時帳戶匯率替代；同一原始 SPEND 的本批獎項合併估值後再依既有引擎處理捨入，不能逐張改變規則。已接受批次的入帳使用被驗證且凍結的計畫；新增帳戶凍結／來源更正等情況保留應付待核，不能把未兌現義務刪除。

已知 basis=0 與未知 basis=null 嚴格區分。net=0、全額回饋、免單退款或來源尚未入帳，依 D-02 決策處理；在決策未完成前不得產出正向可執行授權。

## 8 報價與批次協議

整筆 quote 最多 50 張，各批按完整部署範圍分組。每批內 tokenIds 數字遞增，跨批按 chainId、正規化 contractAddress、executionTarget 排序。quote 總額等於各批與各 item 的總額；batchId 必須全域不重複，跨部署也不能重用。

新增 quote schemaVersion=`fixed-probability-buyback-quote-v1`。新的 canonical quote payload 至少含 orderId、wallet、全部批次 AssetRef／執行目標、itemsHash、逐獎政策與權益版本、期限快照、估值計畫 hash、總額及 expiresAt。用 RFC 8785 canonical JSON UTF-8 bytes 算 keccak256；整數 raw 值一律字串。JSON hash 不能依物件插入順序或不明 JSON.stringify 慣例。既有已簽 quoteHash、authorizationJson 與簽章不得重算或改寫。

batch 保存 `source`、NFT address、executionTarget、mintProtocolVersion、buybackProtocolVersion、registryVersion、Proxy runtimeHash、proxyKind、implementationAddress／implementationRuntimeHash。既有 coreAddress／moduleAddress 欄位為相容別名，分別對應 NFT address／executionTarget；新增資料必須相符。新 reader 允許讀舊資料，缺 source 的歷史批次只有在已知原 Core 範圍才推斷 CORE。不能把所有 moduleAddress 等於 coreAddress 的資料都推斷成可信固定機率。

## 9 資產互斥與恢復

accept 在同一 DB transaction 取得每張資產的 ExchangeTokenClaim，與實體兌換共用唯一鍵。固定排序鎖定，並重驗 policy、accounting、期限與 funding origin；任一張失敗整個 accept 回滾。已接受但簽章中斷可續簽相同批次，不能另建立會同時有效的授權。

簽章保留資產到 deadline；瀏覽器取消、lease 到時、無交易 hash 都不足以釋放。只有 finalized 時間已超過 deadline，且在同一 finalized anchor 查該批 consumed=false，才可原子 EXPIRED／釋放。consumed=true 但無 hash 必須保留 claim，交既有交易恢復找收據，不能補送或假裝過期。

DB claim 不能攔截使用者直接呼叫 ERC721 transfer／exchangePrize。鏈上 owner、revealed、exchanged 與 consumed 才是最後防線：轉手或先兌換會使回購失敗；先 burn 後 transfer／exchange 必須失敗。這種鏈外競態不得發點；等安全期限後再釋 claim。

## 10 應付與點數狀態

| 狀態 | 必要證據與允許動作 |
| --- | --- |
| NOT_SUBMITTED／NOT_DUE | 保存接受快照與授權；可以恢復原 intent，不可宣稱已扣除 NFT |
| CONFIRMED／PENDING | 成功 receipt、canonical block hash、精確事件與每張 Transfer burn；獨立 DB transaction 保存應付、消耗 claim、釋放未履約配置 |
| CONFIRMED／CREDITED | 獨立 DB transaction 寫 PRIZE_BUYBACK_CREDIT、Points valuation、AccountingShare 與 creditEntryId；合計完全相等且原子提交 |
| EXPIRED／NOT_DUE | finalized 超過 deadline 且 consumed=false；釋放 claim；不記成本／發點 |
| NEEDS_REVIEW | 收據證據衝突、估值計畫不符或不可自動更正；保留原應付、證據及原因，不重新 burn |

收據驗證必須逐一核對：RPC chainId、可信 target／NFT address、成功 status、canonical block hash、唯一 PrizeBuybackBurned 的 batchId／buyer／coreAddress／quoteHash／tokenIds／points／total，以及每張 NFT 唯一且先於回購事件的 Transfer(buyer,zero,id)。新固定機率中 emitting address 與 NFT address 相同也必須通過完整驗證。錯地址同名事件、removed log、缺 burn、重複／換序／少點數、他人 NFT 都拒絕。

沿用成功 receipt 加當下 canonical 即可認列，不新增 finalized 等待；只有未送出授權的安全過期釋鎖使用 finalized。入帳後鏈重組不保證由目前 worker 自動發現：驗收另用已知 hash 的 canonical 核對程序測試發現衝突，建立不可重複的待核事件與人工帳務更正證據，不刪除 credit、不負向直接覆寫餘額。這是共用恢復邊界，不能宣稱已有自動補償。

入帳 idempotency key 沿用 chainId／executionTarget／batchId，另以完整 AssetRef 防止跨批重複回收。worker 從舊批次部署快照恢復，不因新 registry 切換改 target。停新報價／停 signer 不停已 burn 應付補帳；未完成應付不可因移除設定被跳過。

## 11 Graph 與資料消費

新部署使用獨立可信 datasource，保留舊 V3 的來源、地址、startBlock 與所有歷史 entity ID。新原生回購由靜態 datasource 訂閱 Proxy 的事件，不依原 Core 的 MODULE_ROLE 動態註冊流程。Upgraded 事件保存於 audit，另外更新 FixedProbabilityProxyState；保留 immutable deployment 身分及既有 NFT／Order／Draw ID。

規劃在 FixedProbabilityNFT 新增 `burned: Boolean!`、可空 burnedEvent／buybackBurn 關聯；mint 初始化 false。Transfer to zero 設 currentOwner=zero、burned=true，保留 Draw／Order／NFT；只接受已知存在且 owner 相符的 NFT。burn 事件冪等，不增加 claimedCount，不把歷史 claimed／minted 數減掉。

PrizeBuybackBurned 維持不可變 burn entity，新增 deployment／source 關聯時必須保留原 Core schema 的查詢相容。Graph handler 核對事件所宣稱 coreAddress 與 datasource，不索引任意 emitting address。Graph 不依自己的資料發 Points。

更新 metadata／NFT／rewards／procurement／proof 等查詢的完整 shape。持有及可兌換清單排除 burned；購買、開獎與回收歷史仍可查。舊 V3 NFT 預設 burned=false 只能在完整 reindex 或有證據的資料轉換後取得，不能假設 schema 部署即補值。新 schema 先部署並重建索引，驗收 parity 後才切 backend。

## 12 Admin 前端 庫存與報表

Admin 沿用已發布系列詳情回購面板與既有權限：逐獎設定／停用收購價、版本競態檢查、成本商家、跨商家權益約定與原因。不存在能力的舊 V3 顯示原因；可以保存停用中的政策，但不能因價格存在就對用戶顯示可執行回收。不能在 generic listing／全域回購面板繞過相同能力檢查。

Frontend 沿用回收頁／LIFF、確認、錢包交易、歷史與 Points 餘額刷新。顯示報價期限、分批數量、站內 Points 及「已銷毀待入帳／已完成／過期／需處理」；送出交易或 Graph 收到事件不顯示完成。quote failure、資產刷新及部署切換不得保留錯來源勾選。

burn 證據確認後只釋放該 NFT 已配置但未履約的 NftProcurementUnit，保留成本、配置歷史及來源系列；rightsMerchantId 依接受時快照移轉。沒有配置時不新增虛構庫存，已履約不得釋放或覆寫。不得恢復有限獎池或固定機率 drawCap。

回購成本以 confirmed burn 應付為準，後續補點只清償應付；回購發點不列營收，後續商品消費不能再加成第二筆營收。報表追蹤完整來源、seriesDbId、原始成交、商家成本、已付／待付、商品權益及後續 Points 消費；固定機率不能因缺 fundingTokenPrices 全落入 UNATTRIBUTED。缺證據要顯示原因，不填零。

## 13 驗收矩陣

下列均是待實作驗收，不是本輪已通過。正向案例必須核對完整事件／DTO／DB／ledger shape；負向案例還要斷言 owner、consumed、ledger、claim、庫存均沒有不該發生的變動。

| 測試 | Given 與 When | 必須觀察的結果 |
| --- | --- | --- |
| T-01 | 一張有完整來源的已揭曉 NFT 回收 | 真 burn、精確站內 Points credit，一筆應付／分帳／credit；無 ERC20 mint |
| T-02 | 同鏈 Core 與 FP 都有 tokenId=1／seriesId=1 | 清單、勾選、價格、鎖與報表各自獨立 |
| T-03 | 舊 tokenIds 請求；混傳兩種輸入；任意地址／跨鏈 assets | 舊輸入僅 CORE；混傳／非 allowlist／跨鏈拒絕 |
| T-04 | 不存在 ID、零預設 Draw、未揭曉 NFT | 全部拒絕；不消耗批次、不發點 |
| T-05 | 他人持有、批准 operator 發起、簽章後轉手 | 非 buyer 或 owner 拒絕；舊授權不會 burn 新持有人 NFT |
| T-06 | 已 exchange／已有履約／有出售掛單 | 報價或接受拒絕；直接先兌換時合約回購拒絕 |
| T-07 | deadline 前一秒、等於、後一秒 | 前兩者可執行；後者拒絕；預設 14 天計算正確 |
| T-08 | 尚未到貨，但有效價格、期限與來源完整 | 可回收，不要求 availableAt 已到 |
| T-09 | merchant／期限／metadata 缺失、RPC 錯鏈或時鐘偏移 | 明確原因；無可執行簽章 |
| T-10 | 價格未設定、停用、版本／權益改變 | 停用拒絕；舊未接受 quote 變更後拒絕 |
| T-11 | 報價後商家期限縮短；已簽後政策停用 | 前者需重報價；後者仍依已簽 deadline，緊急 pause 才阻止上鏈 |
| T-12 | 原始來源缺失、模糊或 basis 未知 | 在簽章／burn 前阻擋；已存在資產與帳戶不被隱藏 |
| T-13 | 錯 buyer／chain／target／NFT 地址／quoteHash／簽章角色 | 全部 revert；draw 簽章與回購簽章不能交互使用 |
| T-14 | 重放、空批、重複／換序 token、0 點、總額錯、uint256 溢位 | builder 與合約均拒絕，前後 invariant 不變 |
| T-15 | 50 張有效 NFT；51 張；後一張不合格 | 50 張完整成功且記錄 gas；51 拒絕；後者全批回滾 |
| T-16 | pause、撤銷 signer、合約角色買家嘗試重入 | 阻止執行，無部分 burn／consumed 洩漏 |
| T-17 | 兌換與兩筆回收同時競爭同一 AssetRef | DB 原子互斥；只有一個 ownerKey 取得 claim |
| T-18 | 無 hash；consumed=true；deadline 到但未 finalized | 全保留 claim；finalized 過期且 consumed=false 才釋放 |
| T-19 | 偽造同名事件、錯 emitting address、缺／重複／晚於回購事件的 burn | 無應付、無 credit；完整匹配才通過 |
| T-20 | revert receipt、canonical hash 不符、RPC 錯鏈 | 不發點，原證據不覆寫 |
| T-21 | 寫入應付後、credit 前 crash；credit commit 後 crash | 重啟補一筆 credit；不重 burn、不重記成本 |
| T-22 | 比較回收前後抽獎與會員狀態 | 機率、acceptedDraws、額度、訂單與會員不變；NFT 供應只減 burn 數 |
| T-23 | 兩個 worker 同批／同 wallet 並行入帳 | 同批一次、不同批相加正確；shares 和 credit 完全相等 |
| T-24 | NFT 轉給新 wallet；歷史原買家來源可查 | 發給持有人，估值來自原買家，不取新 wallet 現在匯率 |
| T-25 | 全額回饋、免單、net=0、退款未入帳 | D-02 未定時 pre-burn 阻擋；決策完成須新增精確正向 ledger 向量 |
| T-26 | raw 點數不能均分；新舊混合、已知零與未知基準 | 整數守恆、可重算；null 不當 0，整批來源分組捨入符合既有引擎 |
| T-27 | 歷史 backfill 重跑／來源衝突／同 NFT 第二次回收 | 相同證據冪等；衝突待核；第二次拒絕；不改舊 ledger |
| T-28 | mint→reveal→transfer→buyback 的完整事件序列 | Graph 不 assert；NFT burned、burn entity、順序與總額正確 |
| T-29 | 舊資料 reindex、重複 event、rollback／replay | 歷史保留、無重複 entity；Graph 與 pinned RPC snapshot parity |
| T-30 | 無採購配置、未履約配置、已有履約與跨商家權益 | 僅釋未履約配置，保留成本／歷史；不虛增庫存 |
| T-31 | Admin 詳情／listing／全域面板，具權限與無權限角色 | 同一政策驗證；有能力 FP 可設價，舊 V3 清楚阻擋，不洩私有約定 |
| T-32 | 回收頁、LIFF、歷史、多部署部分成功／逾期／待入帳 | 完整 DTO 與資產鍵，進度真實，正確刷新 Points 與庫存 |
| T-33 | 新 registry 上線、停新報價、舊批次仍待補帳 | 從舊快照恢復，停新不停止還債；換地址不重送舊簽章 |
| T-34 | 新 ABI／datasource／runtimeHash 任一錯配；code size 超限 | gate 失敗，保持新簽章停用；舊 mint／reveal／exchange 回歸通過 |
| T-35 | 既有 V3 NFT 及 pending VRF／未入帳訂單 | D-01 清單完整；不遺失、不假成功；選定方案另有可核驗結果 |

## 14 實作順序與交付責任

| 階段 | 交付與 Owner | 進入下一階段的條件 |
| --- | --- | --- |
| P0 範圍與來源 | Backend／Contracts：D-01 snapshot；產品／帳務：D-02；凍結 registry 與完整 quote／origin fixture | 決策簽認或精確標示限縮範圍；未決不得全量開放 |
| P1 協議與資金來源 | Backend：AssetRef、部署 adapter、origin projection migration、preflight／valuation plan、兼容舊輸入 | T-02、03、09～12、24～27；來源缺失不得出現可執行授權 |
| P2 合約與索引 | Contracts：新核心原生 buyback／ABI／大小；Graph：burn schema／mapping／新部署 datasource | T-04～08、13～16、22、28、29、34；原 V3 mint 行為回歸 |
| P3 交易與帳務 | Backend：按批路由、claim、receipt、應付、credit、恢復、庫存及報表 | T-17～21、23、30、33；隔離 PostgreSQL／Redis 重啟驗收 |
| P4 共用畫面 | Admin／Frontend：既有入口、政策、價值展示、完整資產鍵與逐批歷史 | T-31、32；不用另一套回收產品掩蓋共用接口缺口 |
| P5 階段聯合驗收 | 五 repo：版本清單、已知測試交易與 DB／Graph／ledger 對照 | 所有適用 T-* 通過、D-01／02 關閉、部署與 runtime 證據完備後，才可宣稱全量完成 |

拆分 PR 仍保留本規格需求 ID；每個 PR 附通過的 T-*、未完成的 T-* 及實際 command／runtime，不用「tests pass」替代跨層證據。不在本規劃階段替使用者建立或傳送其他 chat 工作。

## 15 發布與回復門檻

執行前產生 deployment handoff：chainId、NFT／execution target、runtimeHash、startBlock、mint／buyback 協議版本、signer／角色、ABI hash、Graph deployment CID／schema、API 與 worker commit、資料庫 migration／origin backfill 版本。只列 RPC／KMS 等環境變數名稱與設定狀態，不記錄秘密或私有 endpoint。

發布依序：擴充 DB 相容 migration → 部署經授權的新合約及角色 → Graph schema／datasource／reindex／parity → Backend API 與 recovery worker → Admin／Frontend → 經明確授權的 staging 測試交易 → 小範圍逐獎開放。所有新部署在驗收前維持新簽章關閉；新版本 reader 能讀舊批次。

正式開放必要證據：新合約真實 code size 與 runtimeHash、角色核對、實際 N 張 NFT 回收 receipt、Graph burn 投影、獨立應付、Points credit／估值及 shares、庫存歷史、前後余额及重跑冪等；另測政策停用後已 burn 的補帳。部署／角色／staging 交易需另有使用者明確授權。

回復先停新 quote／簽章／獎項政策，保留既有 reader、恢復 worker、origin 與 ledger schema。不能直接還原到只認單一 Core 的程式、移除已簽批次地址、刪應付或強制解鎖。緊急合約 pause 不阻止鏈外補帳。回復結果以未完成批次逐筆對帳，不靠 UI 清空狀態。

## 16 向量重算與驗證狀態

向量涵蓋資產同號隔離、拆批與排序、raw 分攤、期限邊界、EIP-712 domain／itemsHash、正常估值與反例。輸出 hash 是工具重算的靜態參考，不能當成新合約已部署或系統已驗收。

在 Contracts repo 執行以下命令；需 sibling Backend 的既有 viem／canonicalize 依賴。若 Backend 位於其他位置，可設定 BUYBACK_BACKEND_ROOT 為該 repo 路徑。這段只讀取向量，不寫資料或發交易。

```bash
node <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const paths = [process.env.BUYBACK_BACKEND_ROOT || '../doudochain-backend'];
const v = require(require.resolve('viem', { paths }));
const canonicalize = require(require.resolve('canonicalize', { paths }));
const f = JSON.parse(fs.readFileSync('docs/fixtures/fixed-probability-buyback-v1.json', 'utf8'));
for (const x of f.allocations) {
  const n = BigInt(x.quantity), p = BigInt(x.netPointsRaw);
  const actual = Array.from({length:Number(n)}, (_, i) => (p/n + (BigInt(i)<p%n ? 1n:0n)).toString());
  assert.deepEqual(actual, x.expectedRaw);
}
for (const x of f.deadlines) {
  const expiry = BigInt(x.revealedAt) + BigInt(x.windowDays ?? 14)*86400n;
  assert.equal(expiry.toString(), x.expectedExchangeDeadline);
  assert.equal(BigInt(x.chainNow) <= expiry, x.expectedEligible);
  if (x.expectedEligible) assert.equal((BigInt(x.chainNow)+300n < expiry ? BigInt(x.chainNow)+300n : expiry).toString(), x.expectedAuthorizationDeadline);
}
for (const x of f.authorizations) {
  const ids=x.tokenIds.map(BigInt), points=x.pointsRaw.map(BigInt);
  const itemsHash=v.keccak256(v.encodeAbiParameters([{type:'uint256[]'},{type:'uint256[]'}],[ids,points]));
  assert.equal(itemsHash,x.message.itemsHash);
  const message=Object.fromEntries(Object.entries(x.message).map(([k,a])=>[k,['totalPoints','deadline'].includes(k)?BigInt(a):a]));
  assert.equal(v.hashTypedData({domain:x.domain,types:f.authorizationTypes,primaryType:'BuybackAuthorization',message}),x.expectedDigest);
  assert.equal(points.reduce((a,b)=>a+b,0n).toString(),x.message.totalPoints);
}
for (const x of f.quoteHashes) assert.equal(v.keccak256(v.stringToHex(canonicalize(x.payload))),x.expectedHash);
for (const x of f.snapshotHashes) assert.equal(v.keccak256(v.stringToHex(canonicalize(x.payload))),x.expectedHash);
const keys=f.assets.map(x=>`${x.chainId}:${x.contractAddress.toLowerCase()}:${x.tokenId}`);
assert.equal(new Set(keys).size,keys.length);
const counts=new Map();
for (const a of f.assets) { const k=`${a.chainId}:${a.contractAddress.toLowerCase()}`; counts.set(k,(counts.get(k)||0)+1); }
assert.deepEqual([...counts.values()].sort((a,b)=>a-b), f.expectedBatchAssetCounts);
assert.notEqual(f.authorizations[0].expectedDigest,f.authorizations[1].expectedDigest);
console.log('PASS: raw allocations, deadlines, asset scope, ABI hashes, EIP-712 and canonical quote hashes');
NODE
```

實作時必須將相同向量交給 Contracts、Backend、Admin、Frontend 測試；不把 hash 值複製到程式後只測相等，也不把本命令當完整 T-* 驗收。反例另按矩陣執行並斷言拒絕與無副作用。

以下從 Backend repo 重現目前的估值阻塞，並以明確標示為合成的 legacy-only 資料核對正向查找。此處 legacyExempt 不是正式資料補救方案，不能由用戶輸入或由年代推測：

```bash
node -r ts-node/register/transpile-only <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {valuePointsOperation} = require('./packages/shared/src/points-valuation');
const f = JSON.parse(fs.readFileSync('../ICHICHAIN_CONTRACT/docs/fixtures/fixed-probability-buyback-v1.json', 'utf8')).valuationRegression;
const p = f.purchasePointsRaw;
const state = {availableRaw:p,reservedRaw:'0',legacyAvailableRaw:p,legacyReservedRaw:'0',availableBasisTwdRaw:'0',reservedBasisTwdRaw:'0'};
const spend = {id:'original',walletAddress:'buyer',amountRaw:'-'+p,balanceBucket:'RESERVED',entryType:'SPEND',referenceType:'MINT_RESERVATION',referenceId:'order',idempotencyKey:'spend',legacyExempt:true,metadataJson:f.existingSpendMetadata};
const credit = {id:'buyback',walletAddress:'seller',amountRaw:f.buybackPointsRaw,balanceBucket:'AVAILABLE',entryType:'PRIZE_BUYBACK_CREDIT',referenceType:'PRIZE_BUYBACK',referenceId:'batch',idempotencyKey:'buyback',metadataJson:{chainId:f.chainId,coreAddress:f.nftAddress,buybackTokenPoints:{[f.tokenId]:f.buybackPointsRaw}}};
assert.throws(() => valuePointsOperation(state,[credit],[spend]), e => e.detailCode === f.expectedCurrentError);
const result = valuePointsOperation(state,[credit],[{...spend,metadataJson:f.normalizedFundingMetadata}]);
assert.equal(result.state.availableRaw,(BigInt(p)+BigInt(f.syntheticLegacyOnlyExpectedCreditRaw)).toString());
console.log('PASS: original source failure and normalized synthetic source lookup');
NODE
```

本規劃輪次已執行上述兩類向量驗證、gross／rebate／net 整數守恆、14 條需求／35 個驗收 ID 的完整性及文件連結檢查，均通過。新文件與向量的 whitespace 檢查另以 `git diff --no-index --check /dev/null <file>` 驗證；不將此結果標為 T-* 功能通過。

盤點輪次既有程式驗證：Solidity 編譯 130 檔成功、合約測試 12 項、Backend 58 項、Frontend 22 項、Graph 部署檢查 6 項通過；Admin 2 項通過，另兩個 UI 測試檔缺 jsdom 無法執行。這些是上述 commit 快照的既有測試，不是本規格新增功能驗收；Graph mapping／reindex、真實外部服務、部署與回購交易均另待執行。


## 15 實作交接補充（2026-10-15）

實際程式位置、資料欄位、驗證結果與待部署步驟，見 [實作交接](/Users/angustsai/.codex/worktrees/fixed-probability-buyback/ICHICHAIN_CONTRACT/docs/specs/fixed-probability-buyback-implementation.md)。本地測試不等於 T-01～T-35 的實際部署全量驗收。

新 quote 另保存 `quoteSnapshotJson` 作為實際 canonical 雜湊輸入；既有訂單此欄為 null，舊簽章不重算。此快照含內部權益資訊，只供受權後端驗證，不放入買家回應。

實作盤點確認目前基礎 subgraph manifest 未啟用市場掛單資料源。新原生部署可附市場部署證據建立掛單來源；市場索引未覆蓋前，Backend 以 `BUYBACK_MARKETPLACE_INDEX_PENDING` 阻擋簽章。`marketplaceIndexReady` 預設 false，需在實際索引／部署證據驗證完成後才啟用，不能把空 listings 結果當成沒有掛單。


## 16 UUPS 補充驗收

| ID | 輸入／操作 | 可驗證結果 |
| --- | --- | --- |
| T-36 | 直接 initialize implementation、重複 initialize Proxy、六種零地址 | 全部拒絕；角色與 ID counter 僅由原子初始化設定 |
| T-37 | buyer／operator／mint signer／未具升級角色的 admin 升級；非 UUPS target | 全部拒絕；只有 UPGRADER_ROLE 能走受保護的 Proxy 升級路徑 |
| T-38 | 有 NFT、approve、已兌換／burn、pending VRF、pause 及舊簽章時升級 V2 | Proxy／NFT／Order／Draw／角色與 consumed 不變；VRF、exchange、accounting 及舊簽章可接續；重放失敗 |
| T-39 | Proxy code 不變，但 slot／implementation code／UUID 不符；已核准升級後關閉簽章 | 不符時禁止簽章／發點／安全釋鎖；核准版本可恢復舊批次，即使 enabled=false |
| T-40 | 保留舊函式及 tuple／indexed events，插入錯誤 storage，計算 implementation 大小 | ABI 相容測試通過；錯誤 layout 驗證拒絕；核心及測試 V2 均符合 EIP-170 |
