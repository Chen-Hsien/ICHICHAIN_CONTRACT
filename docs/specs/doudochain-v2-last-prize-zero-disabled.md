# V2 Core 最後賞停用語意

## 行為定義

- `lastPrizeQuantity == 0`：系列售罄時不建立最後賞 NFT，也不送出最後賞 VRF 請求。
- `lastPrizeQuantity >= 1`：系列售罄時依設定數量建立最後賞。
- `setSeriesLastPrizeQuantity(seriesID, 0)`：允許營運方在售罄前停用已設定的最後賞。
- 一般 `subPrizes` 只控制抽獎獎池；最後賞仍使用固定 prize ID `999`，不加入一般獎池。

## 跨層契約

- Admin 新系列表單的最後賞數量預設為 `0`。
- Backend 將缺少數量或數量 `0` 正規化為「未設定最後賞」，不得產生 `/999` metadata 或要求 `/999` 資產。
- Backend 對任何正數最後賞數量（包含 `1`）都必須在售罄前提交 `SET_SERIES_LAST_PRIZE_QUANTITY`。

## 升級注意事項

- 此變更不增加或重排 storage 欄位。
- 升級後，鏈上既有 `lastPrizeQuantity == 0` 且尚未售罄的系列會被視為未啟用最後賞。
- 部署前須盤點既有未售罄系列；若後台資料明確設定最後賞，必須先安排對應數量的設定交易。
- 已經鑄造的 prize ID `999` NFT 不會因升級或把數量設為 `0` 而自動移除。

## 2026-07-28 Arbitrum Sepolia 部署與盤點

- series `21`、`24`、`26`、`27` 已在升級前補設最後賞數量 `1`。
- series `30` 後台 `lastPrize == null` 且已售罄，不需補設定；既有 token `1243`
  已經是 prize ID `999`，此程式變更不會移除它。
- 目前 Core runtime bytecode 為 `24,573` bytes，距 EIP-170 上限僅剩 `3`
  bytes；後續再改 Core 必須重新檢查 bytecode 大小。

### 執行結果

- Core proxy：`0xf75395A8cd753f47135cfcaE00D2706252c3E0F5`
- 舊 implementation：`0x73a3e3d2f632500aA034b68Df86249B011c24B06`
- 新 implementation：`0xDD82D1850731148779bB54c910a39f06a026b1B5`
- 升級交易：`0x537f7439d217e23dba5df10d2e352e62e3df6f26a9b94979c346b448f4b87fdb`
- 暫停交易：`0x2e40216e88da3b5f178cc57f9c71dc4b60e07cf1e12b9fc2d89ce9f0ba77a60f`
- series `21` 補設定：
  `0x0627ecd19c4168568fcc306316ef88f87e9ac8d75854676b6fb3afb6fbda08ab`
- series `24` 補設定：
  `0x5834def25275355b61c44b0de89c144c6396be17803c51e31b1510b69df413af`
- series `26` 補設定：
  `0xfed2cd00b9183080f968ee319ffe4513503798172c3648271424c5bf5d48e07f`
- series `27` 補設定：
  `0x26c8a5a01a5e93889a5cdf9178072902e5f955af0d82f9105098c0202a046687`
- 解除暫停交易：
  `0x257e98a914ee7308b4926010aeb4131c10e0b74da30373c56b32cae7e6f1033e`
- 所有交易 receipt status 均為成功，Core 最終 `paused == false`。
- 鏈上 storage 複核：series `21`、`24`、`26`、`27` 的
  `lastPrizeQuantity == 1`，series `30` 維持 `0`。
- points 與 VRF router wiring 未改變。
- 新 implementation 已完成區塊瀏覽器原始碼驗證。
