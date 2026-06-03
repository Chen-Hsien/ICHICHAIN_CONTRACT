# Points Economy Analytics Checklist

Track these metrics by reason code and wallet:

- Paid issuance: `PURCHASE`.
- Point spending: `LOTTERY_MINT`, `LOTTERY_BUNDLE`.
- Reward issuance: `BUNDLE_REBATE`, `COLLECTION_BOOK_REWARD`, `REFERRAL_REWARD`, `PROMOTION_REWARD`.
- Refund issuance: `REFUND`.
- Chargeback clawbacks: `CHARGEBACK_CLAWBACK`.
- Referral rewards per referrer.
- Bundle rebate redemption rate.

## Launch Thresholds

- Referral rewards should stay below 5% of paid issuance.
- Chargebacks above 2% of paid issuance trigger manual issuance review.
- Reward issuance above budget triggers immediate pause of the affected campaign.
