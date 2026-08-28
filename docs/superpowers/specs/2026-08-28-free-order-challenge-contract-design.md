# 免單挑戰合約設計

日期：2026-08-28  
狀態：Implemented（尚未部署）

## 規則定義

1. 每個 series 可設定「最後 N 抽」為免單挑戰區間。
2. 使用者每輪可選 1–10 抽，整輪會立即送出 reveal。
3. 該輪開始購買前的 `remainingTicketNumbers` 必須小於或等於 N；跨入區間的購買不算挑戰輪。
4. 該輪任一票揭曉為設定的 `subPrizeID`，整輪即中獎，最多退款一次。
5. 退款金額為 `grossPriceInPoints - rebatePoints`，最低為 0；開幕價已反映在 gross price，多抽回饋不會重複退款。
6. 設定以 version 保存。挑戰成立後，即使營運人員修改目前設定，既有輪次仍使用購買當下的 trigger prize version。

例：總共 1,000 抽，設定最後 100 抽可挑戰。當購買前剩餘抽數已小於或等於 100 時，使用者購買 5 抽並命中指定獎項，退款該 5 抽的淨花費。第 920–925 抽位於最後 100 抽區間內，因此符合資格。

## 合約入口

營運設定：

```solidity
setSeriesFreeOrderChallenge(
    uint256 seriesID,
    uint256 eligibleLastTicketCount,
    uint256[] triggerPrizeIDs
)

clearSeriesFreeOrderChallenge(uint256 seriesID)
```

使用者購買：

```solidity
mintFreeOrderChallenge(
    uint256 seriesID,
    uint16[] luckyNumbers,
    uint256 maxTotalPriceInPoints
) returns (uint256 firstTokenID, uint256 requestId)
```

揭曉完成後結算：

```solidity
settleFreeOrderChallenge(uint256 requestId)
claimFreeOrderChallengeRefund(uint256 requestId)
```

`settleFreeOrderChallenge` 可由任何地址呼叫，但退款地址固定為購買時記錄的 buyer。若點數 MINTER 角色暫時不可用，輪次會保留為未領取狀態，buyer 可在角色修復後呼叫 `claimFreeOrderChallengeRefund`。

## 兩階段結算

免單退款不放在 Chainlink VRF callback 內，避免點數合約或角色設定異常使 reveal callback 失敗：

1. 購買交易扣點、套用 rebate、mint 票券、送出 reveal，並保存 request ID 與版本快照。
2. VRF callback 只負責揭曉票券。
3. 前端在 reveal 完成後由購買者送出 claim intent（同時完成結果判定）；Backend 也保留 permissionless settle intent。Bundle 直接讀 Core 的 `ticketStatusDetail` 判定是否命中。
4. 中獎時 mint 淨花費點數給原 buyer；失敗時保留補領狀態。

## 事件

- `FreeOrderChallengeConfigured`
- `FreeOrderChallengeCleared`
- `FreeOrderChallengePurchased`
- `FreeOrderChallengeResult`
- `FreeOrderChallengeRefunded`
- `FreeOrderChallengeRefundDeferred`

## 跨系統責任

- Backend：提供系列設定投影，建立挑戰購買、permissionless settle 與 buyer claim intent。
- Admin：提供最後 N 抽與 trigger prize ID 的緊急操作 preset；送出前須由營運人員核對 trigger prize 屬於該 series。
- The Graph：索引設定、購買、結果、退款與 deferred 事件。
- Frontend：只在進入最後 N 抽時切換挑戰入口；VRF 完成且獎項結果可讀後，自動送出 buyer claim intent。若結算暫時失敗，顯示待重試提示。

合約仍會拒絕 N 大於設定當下剩餘抽數、空 trigger list、0 prize ID、重複 prize ID、0 抽與超過 10 抽；trigger prize 的 series 歸屬由 Backend/Admin 在建立營運交易前做完整驗證。
