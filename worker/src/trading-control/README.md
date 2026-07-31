# Trading Control Integration

`opportunity-sandbox-control.js` is the only bridge from Opportunity Manager selections to the protected Webull Sandbox order pipeline.

## Contract

- The opportunity must be present in the current Dashboard Live Scanner `rows` and in `opportunitySelection.selected`.
- The opportunity must still be `ACTIVE`, unexpired, long-only, non-`REJECT`, and above the configured score and confidence thresholds.
- The order symbol must match the selected opportunity.
- A protected limit order requires a positive entry, stop below entry, and target above entry.
- Preview is the default. Submission requires `confirm: true` and a valid `x-moe-webhook-secret`.
- Every confirmed attempt acquires a Durable Object order reservation before broker submission.
- Submitted reservations are finalized; rejected or failed attempts release their reservations.
- Duplicate, concurrent, expired, inactive, unselected, short, weak, or malformed opportunities fail closed before broker submission.

## Sandbox-only safety

The bridge runs only when all Sandbox switches are enabled and the runtime Sandbox control is active. It additionally requires all Live switches to remain disabled and the Live kill switch to remain active.

The existing endpoint is restricted to selected opportunities:

```text
POST /api/trading/orders/execute
x-moe-webhook-secret: <secret>
```

Preview body:

```json
{
  "mode": "sandbox",
  "opportunityId": "managed-opportunity-id",
  "confirm": false,
  "order": {
    "limitPrice": 120,
    "stopLoss": 118,
    "takeProfit": 124
  }
}
```

Setting `confirm` to `true` permits the protected Sandbox pipeline to attempt submission after every gate passes. The client cannot supply a different symbol, a short side, a signal ID, a Live flag, or execution authority.

The dashboard remains read-only and exposes no execution controls.
