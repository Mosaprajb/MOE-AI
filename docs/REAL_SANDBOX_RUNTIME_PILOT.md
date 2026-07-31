# Real Sandbox Runtime Pilot & Observability

This stage deploys a separate Cloudflare Worker named `moerand-alerts-sandbox`. It uses a separate Durable Object namespace and never changes the production Worker.

## Safety contract

The committed pilot configuration is intentionally disarmed:

- `MOE_SANDBOX_PILOT_ENABLED=false`
- maximum total Sandbox submissions: `1`
- maximum quantity: `1`
- maximum notional: `$1000`
- long-only selected opportunities
- protected three-leg orders only
- all Live switches disabled
- Live kill switch enabled

Scheduled scanner work is skipped until the pilot is explicitly armed. Preview requests remain available, but confirmed orders are blocked while disarmed.

## Required Cloudflare secrets

Configure these secrets only for `moerand-alerts-sandbox`:

```bash
npx wrangler secret put MOE_WEBHOOK_SECRET --config wrangler.sandbox.jsonc
npx wrangler secret put WEBULL_APP_KEY --config wrangler.sandbox.jsonc
npx wrangler secret put WEBULL_APP_SECRET --config wrangler.sandbox.jsonc
npx wrangler secret put WEBULL_ACCESS_TOKEN --config wrangler.sandbox.jsonc
npx wrangler secret put WEBULL_ACCOUNT_ID --config wrangler.sandbox.jsonc
```

Do not store secret values in `wrangler.sandbox.jsonc`, `.env`, source files, issues, or logs.

## Validation and deployment

```bash
npm run test:worker
npx wrangler deploy --dry-run --config wrangler.sandbox.jsonc
npx wrangler deploy --config wrangler.sandbox.jsonc
```

The first deployment remains disarmed because `MOE_SANDBOX_PILOT_ENABLED` is `false`.

## Observability endpoints

Public health probe:

```text
GET /api/health
```

Authenticated probes require `x-moe-webhook-secret`:

```text
GET /api/readiness
GET /api/sandbox/audit
GET /api/sandbox/orders/status
```

Example:

```bash
curl -H "x-moe-webhook-secret: $MOE_WEBHOOK_SECRET" \
  https://moerand-alerts-sandbox.<workers-subdomain>.workers.dev/api/readiness
```

Readiness must report all of the following before arming:

- isolated Sandbox pilot environment
- Durable Object available
- Sandbox broker configuration enabled
- Webull Sandbox credentials configured
- Sandbox broker host is not `api.webull.com`
- quantity cap is one
- notional cap is at most $1000
- total pilot submission cap is one
- every Live lock is active

## Arming the pilot

After readiness is clean, change only this value in `wrangler.sandbox.jsonc`:

```json
"MOE_SANDBOX_PILOT_ENABLED": "true"
```

Then deploy the separate Sandbox Worker again:

```bash
npx wrangler deploy --config wrangler.sandbox.jsonc
```

The pilot wrapper automatically blocks any second submitted reservation after the first protected Sandbox order.

## Burn-in checks

Use `/api/sandbox/audit` during three complete market sessions. The audit must remain clean:

- no Live broker host access
- no Live funds used
- no unprotected submitted order
- duplicate orders blocked
- expired opportunities blocked before submission
- failed broker attempts release reservations
- Live kill switch remains active

The pilot does not authorize Live trading. Completing the burn-in only qualifies the project for a separate Production Readiness Gate.
