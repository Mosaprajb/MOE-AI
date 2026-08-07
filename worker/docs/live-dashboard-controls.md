# Live dashboard controls

The dashboard treats `SANDBOX` and `LIVE` as **view modes**, not execution permissions.

## Server-owned policy

The client polls `GET /api/trading/live/status` and trusts the returned policy. It never enables Live view from local storage alone and it does not call `POST /api/trading/mode` when the operator opens the Live account view.

Live observation is available only when:

- the Worker identifies itself as the Production deployment; and
- all four Webull Live broker secrets are configured.

The dedicated Live PIN and Live session secret remain execution-control requirements, not read-only observation requirements.

## Read-only behavior

When Live observation is available, the dashboard:

- labels the account `LIVE ACCOUNT · READ ONLY`;
- keeps the server execution mode visible as `SANDBOX`;
- disables Scanner navigation;
- locks kill-switch changes from the Live view;
- redirects an open Scanner page to Positions;
- shows server blocker codes without exposing secret values;
- returns to Demo automatically if policy verification fails or observation becomes unavailable.

Orders, TradingView Live execution, automated scans, and authenticated mobile close actions remain blocked by the Worker even if a client is modified.

## CI contract

`mobile-live-dashboard-controls.test.mjs` validates the observation policy and verifies that the dashboard consumes the status endpoint without mutating the Worker trading mode. The Mobile Worker workflow also type-checks the dashboard package when these controls change.
