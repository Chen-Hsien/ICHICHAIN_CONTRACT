# DOUDO Points Reason Codes

Reason codes are emitted as `bytes32` values in `PointsMinted`, `PointsBurned`, and budget issuer events.

| Reason string | Direction | Use |
| --- | --- | --- |
| `PURCHASE` | Mint | Settled fiat purchase points. |
| `LOTTERY_MINT` | Burn | Regular DOUDOCHAINV2 ticket mint. |
| `LOTTERY_BUNDLE` | Burn | Bundle ticket mint. |
| `BUNDLE_REBATE` | Mint | Bundle rebate points. |
| `REFUND` | Mint | Refunded unrevealed tickets. |
| `COLLECTION_BOOK_REWARD` | Mint | Collection Book point reward. |
| `REFERRAL_REWARD` | Mint | Budgeted referral reward. |
| `PROMOTION_REWARD` | Mint | Budgeted promotion reward. |
| `CHARGEBACK_CLAWBACK` | Burn | Clawback for disputed settled payments when points remain. |

Use `ethers.id("<reason string>")` off-chain and `keccak256("<reason string>")` in Solidity.
