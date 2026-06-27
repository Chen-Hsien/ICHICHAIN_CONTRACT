# Mint Ticket 選號與 Floor Rebate 整合設計

日期：2026-06-27

## 目標

在不新增第二套使用者購買入口的前提下，讓 Bundle 的 `mintTickets` 同時支援：

- 使用者選擇 lucky numbers。
- 非選號系列依數量購買。
- `revealImmediately` 立即開獎。
- 依本次總抽數套用一次 floor rebate tier。
- 手機版購買 Dialog 可捲動，且 Mint 按鈕始終可操作。

## 單一合約入口

Bundle 對使用者保留唯一購買入口：

```solidity
mintTickets(
    uint256 seriesID,
    uint16[] luckyNumbers,
    bool revealImmediately
) external returns (uint256 firstTokenID)
```

`ticketQuantity` 一律由 `luckyNumbers.length` 推導，不再由呼叫端另外傳入。

- `useLuckyNumber = true`：陣列元素是使用者選擇的實際號碼。
- `useLuckyNumber = false`：陣列內容必須全部為 `0`，陣列長度代表購買數量。

這可避免 `quantity` 與陣列長度不一致，也確保 rebate、扣款、mint、立即開獎都使用同一個數量來源。

## Contract 設計

### Core

新增唯讀 getter：

```solidity
seriesUsesLuckyNumber(uint256 seriesID) external view returns (bool)
```

getter 必須在 series 不存在時 revert，避免把不存在的 series 誤判成非選號系列。

新增供 Bundle 使用的 module mint 方法，接收完整 `uint16[] luckyNumbers`。此方法沿用 Core 既有的：

- series 存在與庫存檢查。
- goods arrived / pre-order 規則。
- mint lock。
- wallet cap。
- lucky number 範圍與唯一性。
- `NewTicketStatus`、`UpdateSeriesRemainingTicketNumbers` 等 canonical events。

選號系列拒絕 `0`、超出 `[1, totalTicketNumbers]` 或已使用的號碼。非選號系列只接受 `0`；Core 寫入的 `TicketStatus.luckyNumber` 為 `0`。

Redraw 現有依 quantity 自動配號的 module mint 保留，不改變其對既有流程的語意。Core 原本的直接 `mint(seriesID, luckyNumbers)` 暫時保留，但 frontend/backend 不使用，且直接呼叫不會取得 Bundle rebate。

### Bundle

Bundle 以 `luckyNumbers.length` 產生 `ticketQuantity`，並依序執行：

1. 驗證陣列非空。
2. 若立即開獎，驗證數量不超過 10。
3. 從 Core 讀取每張票價格與 lucky-number mode。
4. 驗證選號系列不可含 `0`；非選號系列只能含 `0`。
5. 燃燒 `pricePerTicket * ticketQuantity` DOUDO points。
6. 透過 Core selected-number module mint 鑄造未開獎票券。
7. `revealImmediately = true` 時，針對本次連續 token IDs 呼叫 Core `reveal`。
8. 使用 `_rebateFor(seriesID, ticketQuantity)` 計算一次 floor tier rebate。
9. 發放 rebate 並發出既有事件。

`TicketPurchaseMinted.ticketQuantity` 繼續記錄推導後的數量。每張票的 lucky number 已由 Core `NewTicketStatus` 記錄，因此 Bundle event 不重複攜帶整個陣列。

### Upgrade 安全

- Core 與 Bundle storage layout 不新增或重排狀態欄位。
- `mintTickets(uint256,uint256,bool)` 會被新簽名取代，屬 ABI breaking change。
- Core 與 Bundle 必須在同一維護窗口升級，consumer ABI 也必須同步。
- upgrade 前後都要執行 OpenZeppelin storage validation 與 wiring 檢查。

## Backend 設計

### API 輸入

Reservation 與 mint intent 改以 `luckyNumbers: number[]` 為購買數量的唯一來源，不再接受獨立的 `ticketQuantity` 輸入。

Backend 仍可在內部資料與 response 中保留推導後的 `ticketQuantity`，供訂單、分析與 UI 顯示。

### Availability

公開 series availability response 新增：

```ts
useLuckyNumber: boolean
```

Backend 透過 Core `seriesUsesLuckyNumber(seriesID)` 取得 canonical mode。這可正確支援升級前已建立的 series，不依賴新 subgraph event 或資料回填。

既有 `unavailableLuckyNumbers`、`availableLuckyNumbers` 與 mint lock 資料繼續由 availability response 提供。

### Reservation 驗證

共通規則：

- 陣列不可為空。
- 長度不可超過單次購買上限、剩餘庫存與 wallet cap 可用量。
- reservation 與 intent 的 `luckyNumbers` 必須完全一致。

選號系列：

- 全部元素必須為整數且落在 `[1, totalTicketNumbers]`。
- 不可重複。
- 不可包含 Graph 已鑄造或其他有效 reservation 已保留的號碼。

非選號系列：

- 全部元素必須為 `0`。
- `0` 可重複，長度代表數量。

Backend reservation 只能降低選號衝突機率；鏈上 Core 仍是最終一致性來源。若 Graph lag 或同區塊競態造成號碼已被使用，交易應 revert，frontend 重新取得 availability 後提示使用者重選。

### Calldata 與訂單

MINT contract action 改為：

```text
mintTickets(uint256,uint16[],bool)
```

intent `argsJson` 保存 `luckyNumbers` 與推導後的 `ticketQuantity`。`/v1/user/mint/orders` 繼續回傳數量與 rebate，並可回傳本次選擇的 lucky numbers。

## Frontend 設計

### 雙模式 UI

Frontend 從 availability response 取得 `useLuckyNumber`：

- `true`：顯示 `LuckyNumberPicker`，購買數量等於已選號碼數。
- `false`：顯示目前的數量 stepper，送出 `Array(quantity).fill(0)`。

兩種模式最後都呼叫同一套 purchase hook 與 backend API，payload 為 `luckyNumbers`、`seriesId`、`revealImmediately`。

選號區使用既有已售出與 reservation 中的 unavailable numbers。提交失敗若屬號碼衝突，重新抓 availability 並保留仍可用的選取項目。

### RWD

保留目前 rebate branch 的 Dialog 結構：

- Dialog：`max-h` 使用 `100dvh` 並設 `overflow-hidden`。
- Form：垂直 flex 且具有相同 `max-h`。
- Body：`flex-1 overflow-y-auto`，圖片、選號區與商品資訊可捲動。
- Footer：`shrink-0` 並包含總價與 Mint 按鈕。

不可回復 dev 舊版單一 `space-y-6`、無高度限制的 Dialog。手機 viewport 必須能捲動選號區，同時底部 Mint 按鈕維持可見且可點擊。

## Subgraph 與 Events

本次不修改 subgraph schema：

- lucky-number mode 由 backend 直接讀 Core getter，支援既有 series。
- 每張票的實際號碼沿用 `NewTicketStatus.luckyNumber`。
- rebate 沿用 `TicketPurchaseRebatePaid`。
- 購買數量沿用 `TicketPurchaseMinted.ticketQuantity`。

Bundle ABI 必須同步到 backend、subgraph ABI artifact 與部署 handoff，即使 event signature 不變。

## Edge Cases

- 空陣列：frontend/backend 阻擋，Bundle revert。
- 選號系列含 `0`、重複、越界或已使用號碼：backend 阻擋，Core 再次防守。
- 非選號系列含非零值：backend 與 Bundle 阻擋。
- 立即開獎超過 10 張：frontend 自動關閉或阻擋，backend 與 Bundle 再次防守。
- 購買數量超過庫存、wallet cap 或餘額：既有三層檢查保留。
- rebate tier 未設定：回饋為 0。
- floor tier：使用整個陣列長度只計算一次，不依號碼拆包。
- Graph lag／reservation race：鏈上失敗後刷新 availability，不將失敗 intent 顯示為成功訂單。
- `totalTicketNumbers > uint16.max` 且啟用選號：建立 series 時必須拒絕，避免 lucky-number 型別溢位。

## 測試與驗收

### Contract

- 選號 Bundle mint 會保留使用者指定號碼。
- 重複、越界、已使用與模式不符輸入會 revert。
- 非選號系列接受重複 `0`。
- rebate 使用陣列長度套用 floor tier。
- immediate reveal 仍正常且限制 10 張。
- Redraw 自動配號行為不變。
- storage upgrade validation 通過。

### Backend

- DTO、reservation、intent 與 calldata 都以陣列為唯一數量來源。
- 選號與非選號驗證完整。
- availability 回傳 canonical `useLuckyNumber`。
- 訂單顯示推導數量、選號與實際 rebate。
- Graph lag 與 chain read 失敗有明確錯誤，不默認錯誤模式。

### Frontend

- 選號系列顯示 picker 並送出實際陣列。
- 非選號系列顯示 stepper 並送出 `0` 陣列。
- 總價、餘額檢查、tracking 與立即開獎上限皆使用陣列長度。
- desktop 與 mobile viewport 都可完成購買流程。
- mobile body 可捲動，footer 與 Mint 按鈕可見、無重疊或 scroll trap。

## 不在本次範圍

- 移除 Core 直接 `mint` 入口。
- 改變 rebate tier 規則或新增多次回饋。
- 改變 VRF、獎項抽選或 reveal event。
- 重新設計購買 Dialog 的視覺語言。
