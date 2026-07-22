# Fiat Points Issuance Runbook

Mint `PURCHASE` points only after the payment processor marks the order as settled or captured.

For each settled order, verify:

- Order wallet equals the `PointsMinted.to` event.
- Order point amount equals the `PointsMinted.amount` event.
- Reason equals `PURCHASE`.
- Exactly one mint transaction exists for the order.

## Chargeback Policy

If points are unspent, burn the remaining disputed amount with reason `CHARGEBACK_CLAWBACK`.

If points are already spent, mark the disputed amount as business loss and flag the wallet for manual review before future issuance. Do not create negative point balances or automatic debt collection in V2.

## Alerts

Alert when:

- A settled order has no mint transaction after 10 minutes.
- A mint transaction exists for an unsettled order.
- Minted amount differs from the order amount.
- One wallet has more than 3 chargebacks in 30 days.
