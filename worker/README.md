# MOE-AI Cloudflare Worker

Hono-based Cloudflare Worker serving all backend API routes for the MOE-AI Personal Trading Platform.

## Setup

### 1. Install dependencies
```bash
cd worker
pnpm install
```

### 2. Configure Cloudflare resources
Edit `wrangler.toml` and replace the placeholder IDs:
```bash
# Create KV namespace
wrangler kv namespace create "CONFIG"
# → copy the ID into wrangler.toml [[kv_namespaces]]

# Create D1 database
wrangler d1 create moe-db
# → copy the ID into wrangler.toml [[d1_databases]]

# Run schema migration
wrangler d1 execute moe-db --file=src/db/schema.sql
```

### 3. Set secrets
```bash
wrangler secret put WEBULL_SANDBOX_APP_KEY
wrangler secret put WEBULL_SANDBOX_APP_SECRET
wrangler secret put WEBULL_SANDBOX_ACCESS_TOKEN
wrangler secret put WEBULL_SANDBOX_ACCOUNT_ID
wrangler secret put MOE_WEBHOOK_SECRET

# Live trading (only when ready)
wrangler secret put WEBULL_LIVE_APP_KEY
wrangler secret put WEBULL_LIVE_APP_SECRET
wrangler secret put WEBULL_LIVE_ACCESS_TOKEN
wrangler secret put WEBULL_LIVE_ACCOUNT_ID
```

### 4. Update CORS allowed origins
After deploying the Replit frontend, add your `*.replit.app` domain to `wrangler.toml`:
```toml
[vars]
ALLOWED_ORIGINS = "https://moerand-alerts.mosaprajb.workers.dev,https://your-app.replit.app"
```

### 5. Deploy
```bash
# Local dev
pnpm dev

# Deploy to production
pnpm deploy

# Deploy sandbox environment
pnpm deploy:sandbox
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Worker info + route list |
| GET | `/api/health` | System health (all services) |
| GET | `/api/system/health` | Alias for health |
| POST | `/api/tradingview/webhook` | TradingView alert receiver |
| GET | `/api/tradingview/decisions` | Recent signal decisions |
| GET | `/api/trading/sandbox/dashboard` | Full sandbox dashboard |
| GET | `/api/trading/live/dashboard` | Full live dashboard |
| GET | `/api/trading/live/readiness` | 12-gate live safety check |
| GET | `/api/trading/:mode/account` | Account data |
| GET | `/api/trading/:mode/positions` | Open positions |
| GET | `/api/trading/:mode/orders` | Orders |
| POST | `/api/trading/orders` | Place order |
| GET | `/api/trading/trades` | Trade history |
| GET | `/api/trading/kill-switch` | Kill switch status |
| POST | `/api/trading/kill-switch` | Toggle kill switch |

## Safety Design

- **Kill switch defaults to ON** — no orders execute until explicitly armed
- **Sandbox is always default** — live mode requires all 12 safety gates
- **Idempotency keys** — all orders use idempotency to prevent duplicates
- **Risk checks** — score threshold, daily loss, daily trade count, position count
- **CORS** — only allows configured frontend origins

## GitHub Actions

The following workflows are pre-configured:
- `deploy-cloudflare-worker.yml` — deploys on push to `main`
- `deploy-cloudflare-sandbox.yml` — deploys sandbox on push to `develop`
- `worker-safety-tests.yml` — runs safety checks on all PRs
- `deploy-pages.yml` — verifies frontend build

Required GitHub Secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
