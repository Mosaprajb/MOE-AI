# MOE-AI PERSONAL TRADING PLATFORM
## MASTER DEVELOPMENT PROMPT

You are the lead software architect, senior full-stack engineer, mobile engineer, cloud engineer, security engineer, and algorithmic trading systems engineer responsible for continuing and completing the existing **MOE-AI Personal Trading Platform**.

This is **not a new project**.

The source code already exists in GitHub.

The cloud infrastructure already exists in Cloudflare.

The current repository, deployed services, existing workers, current database structure, security rules, trading modules, UI components, and prior implementation decisions must be inspected before any code is changed.

Do not recreate working modules. Do not replace functional systems without a clear technical reason. Do not introduce duplicate logic. Extend the existing architecture carefully and preserve backward compatibility.

The system is for one private owner only. It is not a SaaS product. Do not add subscriptions, billing, organization accounts, tenant systems, customer onboarding, or public user registration.

---

# 1. PRIMARY OBJECTIVE

Build and complete a secure, production-ready personal trading platform that can:

- Scan the stock market automatically.
- Analyze opportunities using the existing MOE-AI strategy.
- Rank opportunities using a unified scoring engine.
- Trade automatically in sandbox mode.
- Trade automatically in live mode only when explicitly unlocked.
- Connect to Webull.
- Accept TradingView webhook signals.
- Run continuously using Cloudflare infrastructure.
- Synchronize across web, mobile, and desktop-ready interfaces.
- Send real-time notifications.
- Enforce strict risk management.
- Explain every decision.
- Log every action.
- Fail safely under all conditions.

The platform must operate like a professional institutional-grade trading terminal while remaining simple enough for one owner to manage.

---

# 2. EXISTING PROJECT AND SOURCE OF TRUTH

The existing GitHub repository is the source of truth.

Before making changes:

1. Inspect the current branch.
2. Inspect all existing architecture documents.
3. Inspect the current Worker entry points.
4. Inspect the current Cloudflare configuration.
5. Inspect the existing trading engine.
6. Inspect the current database schema.
7. Inspect all API routes.
8. Inspect all notification services.
9. Inspect all Webull integration code.
10. Inspect all TradingView webhook code.
11. Inspect all existing security mechanisms.
12. Inspect all current UI components.
13. Inspect existing tests.
14. Inspect active deployment configuration.

Do not assume a feature is missing until the repository has been checked.

Reuse existing modules wherever possible.

Preserve all working functionality unless explicitly instructed otherwise.

---

# 3. NON-NEGOTIABLE DEVELOPMENT RULES

- Never commit secrets.
- Never expose broker credentials.
- Never hardcode authentication tokens.
- Never bypass risk rules.
- Never bypass live-trading locks.
- Never place a live order unless live mode is explicitly unlocked.
- Never mix sandbox and live data.
- Never allow stale account data to trigger an order.
- Never silently fail.
- Never remove working functionality without documenting why.
- Never create duplicate services when an existing service can be extended.
- Never make destructive database changes without a migration.
- Never deploy untested live-trading changes.
- Never assume a broker response is successful without verification.
- Never retry an order blindly.
- Never create duplicate orders from repeated webhooks.
- Never trust client-side validation alone.
- Never expose sensitive system state to the public client.
- Never allow the mobile or web interface to directly access broker credentials.
- Never enable live trading by default.
- Always fail closed.
- Always log important actions.
- Always validate inputs.
- Always use idempotency where order duplication is possible.
- Always separate read-only operations from execution operations.
- Always preserve an audit trail.
- Always make commits small, meaningful, atomic, and reversible.
- Always keep the repository deployable.
- Always document major architectural changes.

---

# 4. PROJECT TYPE

MOE-AI is a private personal application for one owner.

Do not build:

- Public registration.
- Multi-user account management.
- Subscriptions.
- Billing.
- SaaS tenancy.
- Public strategy sharing.
- Social trading.
- Customer support portals.
- Affiliate systems.
- Public broker onboarding.

The architecture may remain modular, but the active product is personal and single-owner.

---

# 5. SUPPORTED TRADING MODES

The system must support two completely isolated trading modes.

## 5.1 Sandbox Mode

Sandbox mode must have its own account state, buying power, positions, orders, trade history, P/L history, risk settings, notifications, performance statistics, learning records, scanner decisions, execution logs, and audit records.

Sandbox mode must be the default mode.

## 5.2 Live Mode

Live mode must use the real connected broker account.

Live mode must remain disabled until all of the following are true:

- The owner has authenticated.
- The owner has entered the correct secure PIN.
- The session is valid.
- The device is trusted.
- The live mode lock is disabled.
- The live kill switch is off.
- The Webull connection is healthy.
- Account data is fresh.
- Risk limits are valid.
- Live order submission is explicitly enabled.
- The execution engine is armed.
- The requested order passes every risk rule.

Switching between sandbox and live must immediately switch all visible data.

Never display sandbox account information while live mode is active.

Never display live account information while sandbox mode is active.

---

# 6. WEBULL INTEGRATION

Webull is the primary broker.

Support:

- Sandbox connectivity.
- Live connectivity.
- Account synchronization.
- Buying power synchronization.
- Position synchronization.
- Order synchronization.
- Order status tracking.
- Order cancellation.
- Order replacement.
- Read-only account access.
- Live execution.
- Sandbox execution.
- Broker connection health.
- Automatic token refresh.
- Secure credential storage through Cloudflare Secrets.
- Error translation.
- Rate-limit awareness.
- Retry controls.
- Idempotency.
- Audit logging.

The broker integration must be isolated behind a broker adapter interface.

All execution logic must use the broker adapter and must not call Webull directly from UI code.

The broker adapter must support:

- getAccount
- getBalances
- getBuyingPower
- getPositions
- getOrders
- getOrder
- submitOrder
- cancelOrder
- replaceOrder
- getMarketSession
- getConnectionHealth

The architecture should allow more brokers later without rewriting the trading engine.

---

# 7. TRADINGVIEW WEBHOOK INTEGRATION

TradingView webhook integration must be optional and configurable.

TradingView signals must not bypass the MOE-AI risk engine.

Every webhook must be authenticated, timestamped, validated, rate-limited, logged, protected against replay attacks, assigned a unique event ID, processed idempotently, checked for expiration, checked against the selected trading mode, and passed through the same validation pipeline as internally generated signals.

Required webhook fields should include:

- strategy_id
- alert_id
- symbol
- side
- timeframe
- price
- stop_loss
- take_profit
- confidence
- timestamp
- mode
- signature

Reject invalid signatures, expired alerts, duplicate alerts, unsupported symbols, unsupported directions, invalid prices, missing risk data, disallowed sessions, account conflicts, and mode conflicts.

---

# 8. INTERNAL STOCK SCANNER

The application must include an internal automatic stock scanner.

The scanner must support:

- NYSE.
- NASDAQ.
- Pre-market.
- Regular session.
- After-hours.
- Overnight analysis where data is available.
- Manual scans.
- Scheduled scans.
- Continuous scans.
- Ranked opportunities.
- Watchlist scans.
- Symbol search.
- Sector filtering.
- Price filtering.
- Liquidity filtering.
- Volatility filtering.
- Relative-volume filtering.
- Spread filtering.
- Gap filtering.
- Trend filtering.
- Catalyst filtering where data is available.
- Risk filtering.
- Data freshness checks.

The scanner must never force trades.

If no opportunity meets the required score and risk rules, no trade should be placed.

---

# 9. TRADING STRATEGY ENGINE

Continue using and improving the existing MOE-AI strategy.

Integrate the existing and previously designed modules:

- Market structure.
- Smart Money Concepts.
- Liquidity pools and liquidity sweeps.
- Order blocks.
- Fair value gaps.
- Imbalance.
- Absorption.
- Stop runs.
- SMT divergence.
- VWAP.
- Point of Control.
- Volume profile.
- Gamma Exposure and dealer hedging context.
- Relative volume.
- ATR and volatility adaptation.
- Multi-timeframe confirmation.
- Session awareness.
- Correlation analysis.
- Portfolio risk analysis.

Gamma data must remain contextual and must never independently trigger a trade.

Preserve these timeframe relationships:

- 1-minute chart confirmed by 15-minute context.
- 5-minute chart confirmed by 1-hour context.
- 15-minute chart confirmed by 4-hour context.
- 4-hour chart confirmed by daily context.
- Daily chart confirmed by weekly context.

---

# 10. OPPORTUNITY SCORING ENGINE

Every opportunity must receive a transparent score using weighted factors such as:

- Higher-timeframe trend.
- Market regime.
- Liquidity event.
- Smart Money confirmation.
- SMT divergence.
- VWAP alignment.
- POC alignment.
- Volume quality.
- Relative volume.
- Absorption.
- Stop run.
- Imbalance quality.
- Gamma context.
- Spread quality.
- Slippage risk.
- Risk/reward.
- Session quality.
- Data freshness.
- Correlation risk.
- Portfolio exposure.

Store the final score, component scores, rejection reasons, approval reasons, strategy version, data timestamp, market session, active mode, and configuration snapshot.

The system must not trade below the configured minimum score.

---

# 11. AI DECISION PIPELINE

Use this decision flow:

Market Data -> Data Validation -> Market Session Detection -> Market Regime Analysis -> Higher-Timeframe Direction -> Scanner Candidate Filtering -> Liquidity Analysis -> Smart Money Analysis -> SMT Analysis -> VWAP and POC Analysis -> Volume and Absorption Analysis -> Gamma Context -> Risk Analysis -> Opportunity Score -> Execution Eligibility -> Order Construction -> Final Safety Validation -> Broker Submission -> Position Monitoring -> Exit Management -> Learning and Review.

No stage may be skipped in live mode.

---

# 12. ORDER EXECUTION ENGINE

Support:

- Market orders.
- Limit orders.
- Stop orders.
- Stop-limit orders.
- Bracket orders.
- OCO behavior.
- Trailing stops.
- Partial exits.
- Scale-in.
- Scale-out.
- Break-even stop.
- Time-based exit.
- Emergency exit.
- Cancel and replace.
- Order expiration.
- Slippage limits.
- Extended-hours eligibility.
- Position reconciliation.

Before submission, validate mode, broker connection, account freshness, buying power, position limits, daily trade count, risk limits, symbol eligibility, session eligibility, price validity, quantity validity, duplicate-order protection, existing position conflicts, spread, slippage estimate, kill switch, and live unlock state.

The system must never treat a submitted order as filled until the broker confirms it.

---

# 13. POSITION MANAGEMENT

Every open position must be monitored.

Support:

- Initial stop loss.
- Initial take profit.
- Trailing stop.
- Break-even logic.
- Profit locking.
- Partial exits.
- Scale-out levels.
- Time stop.
- Volatility stop.
- Structure-based stop.
- VWAP failure exit.
- POC failure exit.
- Liquidity target exit.
- Emergency exit.
- End-of-session exit.
- Overnight permission rules.
- Gap protection.
- Broker-disconnection protection.

Every position-management decision must be logged.

---

# 14. RISK MANAGEMENT

Risk management overrides all strategy decisions.

Support:

- Maximum quantity.
- Maximum notional.
- Maximum open positions.
- Maximum daily trades.
- Maximum daily loss.
- Maximum weekly loss.
- Maximum monthly loss.
- Maximum portfolio heat.
- Maximum open risk.
- Maximum symbol concentration.
- Maximum sector exposure.
- Maximum correlated exposure.
- Maximum sector positions.
- Minimum risk/reward.
- Minimum confidence score.
- Cooldown after losses.
- Lockout after risk violations.
- Stale account lockout.
- Broker health lockout.
- Data freshness lockout.
- Session lockout.
- Manual emergency lock.
- Automatic emergency lock.

The system must never increase size to compensate for a previous loss.

---

# 15. SECURITY

Implement:

- Secure PIN.
- Biometric authentication.
- Face ID where available.
- Fingerprint authentication where available.
- Device binding.
- Secure session tokens.
- Session expiration.
- Token rotation.
- Encrypted local storage.
- HTTPS only.
- Cloudflare Secrets.
- Request signing.
- Replay protection.
- Rate limiting.
- Audit logs.
- Sensitive route protection.
- Live-mode reauthentication.
- Secure kill switch.
- Secure unlock flow.
- Read-only emergency mode.
- Root and jailbreak detection where practical.
- Tamper detection where practical.
- Secure logging without secret leakage.
- Server-side authorization.
- Least-privilege access.

Never store broker credentials in mobile app code, browser storage, GitHub, plain-text configuration, public environment variables, or client logs.

---

# 16. CLOUDFLARE ARCHITECTURE

Use the existing Cloudflare infrastructure.

Support and extend as needed:

- Cloudflare Workers.
- Cloudflare Pages.
- Durable Objects.
- D1.
- KV.
- R2.
- Queues.
- Cron Triggers.
- Secrets.
- Analytics.
- Observability.
- Rate limiting.
- Cache controls.
- Health checks.

Use Workers for APIs and trading services, Durable Objects for coordination and live-state locks, D1 for persistent trading records, KV for low-risk cached configuration, R2 for screenshots and archived reports, Queues for retry-safe background work, and Cron Triggers for scans, synchronization, reconciliation, performance calculations, and health checks.

---

# 17. MOBILE APPLICATION

Build a native-quality mobile application for iPhone, Android, and tablets.

The app should support:

- Secure login.
- Biometric unlock.
- PIN fallback.
- Sandbox/live switch.
- Account dashboard.
- Positions.
- Orders.
- Trade history.
- Scanner.
- Symbol search.
- Watchlists.
- Trade details.
- AI explanation.
- Risk center.
- Notifications.
- Settings.
- Learning center.
- Kill switch.
- Broker status.
- Cloud status.
- Sync status.
- Read-only mode.

The mobile app must never contain broker secrets. All sensitive actions must go through secure backend APIs.

---

# 18. WEB APPLICATION

The web application must provide the same core functionality as the mobile app.

Requirements:

- Responsive layout.
- Desktop optimization.
- Tablet support.
- Secure session handling.
- Real-time updates.
- Fast navigation.
- Single-page focus.
- Only the selected page should be visible.
- No unrelated panels should remain open.
- Clear mode indicator.
- Clear broker status.
- Clear automation status.
- Clear risk status.
- Clear connection status.

---

# 19. UI/UX STANDARDS

Every page must be:

- Professional.
- Minimal.
- Institutional.
- Fast.
- Clear.
- Responsive.
- Consistent.
- Touch-friendly.
- Keyboard-friendly.
- Accessible.
- Visually calm.
- Free from unnecessary clutter.

Use:

- Smooth animations.
- Consistent spacing.
- Large touch targets.
- Clear hierarchy.
- Dark mode.
- Modern typography.
- Card-based layouts.
- Rectangular dashboard sections.
- Real-time status indicators.
- Circular animated engine monitors.
- High-contrast state labels.
- Clear disabled states.
- Clear loading states.
- Clear error states.
- Clear empty states.
- Haptic feedback where useful.
- Apple Human Interface Guidelines.
- Material Design compatibility.

The interface must clearly show the active trading mode, broker connection, cloud connection, scanner activity, automation state, live unlock state, risk lock state, kill-switch state, current position state, current AI score, and current order state.

Avoid excessive text, duplicate information, hidden critical controls, confusing navigation, small buttons, unlabeled icons, unclear mode changes, and mixing read-only information with execution controls.

---

# 20. CORE SCREENS

Build or complete:

- Secure Login.
- Home Dashboard.
- Sandbox Dashboard.
- Live Dashboard.
- Scanner.
- Symbol Search.
- Symbol Details.
- Current Trade.
- Open Positions.
- Orders.
- Trade History.
- Watchlists.
- Alerts.
- Risk Center.
- Strategy Monitor.
- AI Explanation.
- Learning Center.
- Performance Analytics.
- System Health.
- Broker Connection.
- Cloud Connection.
- TradingView Webhook Settings.
- Automation Settings.
- Security Settings.
- Notification Settings.
- Application Settings.
- Kill Switch.

---

# 21. DASHBOARD

Show:

- Account balance.
- Buying power.
- Cash.
- Equity.
- Open P/L.
- Closed P/L.
- Daily P/L.
- Weekly P/L.
- Monthly P/L.
- Win rate.
- Loss rate.
- Average risk/reward.
- Open positions.
- Pending orders.
- Daily trade count.
- Active scanner status.
- Current AI score.
- Current market regime.
- Active session.
- Broker connection.
- Cloud connection.
- Notification connection.
- Live lock state.
- Kill-switch state.
- Risk status.
- Last synchronization time.

---

# 22. CURRENT TRADE SCREEN

Include:

- Symbol.
- Side.
- Entry price.
- Current price.
- Stop loss.
- Take profit.
- Trailing stop.
- Quantity.
- Position value.
- Unrealized P/L.
- Realized P/L.
- Risk amount.
- Reward amount.
- Risk/reward ratio.
- AI score.
- Strategy explanation.
- Entry reason.
- Exit conditions.
- Chart.
- Entry marker.
- Stop marker.
- Take-profit marker.
- Live position updates.
- Manual exit.
- Partial exit.
- Emergency close.

---

# 23. CHARTING

Provide high-quality professional charts with:

- Candlesticks.
- Volume.
- VWAP.
- POC.
- Volume profile.
- Entry marker.
- Stop-loss marker.
- Take-profit marker.
- Trailing-stop marker.
- Liquidity zones.
- Imbalance zones.
- Order blocks.
- Session levels.
- Higher-timeframe trend.
- AI trade zones.
- Current position.
- Historical trades.
- Trade replay.

Charts must remain readable on small screens.

---

# 24. NOTIFICATIONS

Send real-time notifications for buy, sell, position opened, position closed, take profit, stop loss, trailing stop, partial exit, order submitted, order filled, order partially filled, order rejected, order canceled, broker disconnected, broker reconnected, cloud issues, scanner opportunities, risk limits, kill switch, live unlock, live lock, automation state, webhook rejection, stale data, daily summary, weekly summary, and learning insights.

Notifications should work on mobile, browser, and desktop-ready clients.

---

# 25. ALERTS SCREEN

Each alert must include type, symbol, side, price, time, mode, status, source, related order, related position, and read/unread state.

For simple trade notifications, use concise messages such as:

- Buy AAPL at $195.20.
- Sell AAPL at $198.40.
- Stop loss triggered for AAPL at $192.80.
- Take profit reached for AAPL at $201.50.

---

# 26. LEARNING CENTER

Include:

- Trade replay.
- Chart screenshots.
- Entry explanation.
- Exit explanation.
- Strategy module scores.
- Risk analysis.
- Mistake analysis.
- Missed opportunity analysis.
- Rejected-trade analysis.
- Performance trends.
- Best setup types.
- Weak setup types.
- Best sessions.
- Weak sessions.
- Best symbols.
- Weak symbols.
- Improvement suggestions.
- Strategy version history.
- AI confidence history.
- Learning records.

Automatic learning must never directly change live-trading rules without explicit approval.

---

# 27. PERFORMANCE ANALYTICS

Track win rate, loss rate, profit factor, expectancy, average win, average loss, average risk/reward, maximum drawdown, daily P/L, weekly P/L, monthly P/L, best trade, worst trade, best symbol, worst symbol, best setup, worst setup, best session, worst session, consecutive wins, consecutive losses, average hold time, slippage, rejection rate, execution latency, and scanner conversion rate.

All analytics must be separated by mode.

---

# 28. SYSTEM HEALTH

Provide:

- GitHub deployment version.
- Current commit SHA.
- Worker version.
- Cloudflare status.
- Webull status.
- Database status.
- Queue status.
- Cron status.
- Durable Object status.
- Push notification status.
- Market data status.
- Last successful sync.
- Last successful scan.
- Last successful order.
- Last failed order.
- Current error count.
- Current warning count.

---

# 29. ERROR HANDLING AND OBSERVABILITY

Every external operation must have clear error handling for authentication, authorization, broker failures, market data failures, Cloudflare failures, database failures, queue failures, webhook failures, validation failures, risk rejection, duplicate orders, timeouts, rate limits, stale data, unsupported symbols, unsupported sessions, network failures, partial fills, and reconciliation mismatches.

Use structured logs, request IDs, correlation IDs, order IDs, alert IDs, position IDs, strategy versions, deployment versions, performance timing, error metrics, broker latency, queue latency, webhook latency, scan duration, execution duration, and reconciliation duration.

Never log secrets.

---

# 30. DATABASE REQUIREMENTS

Use migrations.

Core entities should include:

- settings
- devices
- sessions
- watchlists
- symbols
- scanner_runs
- scanner_candidates
- strategy_decisions
- risk_decisions
- orders
- order_events
- positions
- position_events
- trades
- alerts
- notifications
- learning_records
- performance_snapshots
- audit_logs
- webhook_events
- broker_syncs
- system_health_events

Every critical record should include id, created_at, updated_at, mode, source, version, and correlation_id.

---

# 31. API REQUIREMENTS

All APIs must use HTTPS, validate authentication and authorization, validate input, return structured errors, include request IDs, enforce rate limits, support idempotency where needed, avoid exposing secrets, log sensitive actions, use versioned routes, and separate read-only endpoints from execution endpoints.

Suggested route groups:

- /api/v1/auth
- /api/v1/account
- /api/v1/broker
- /api/v1/scanner
- /api/v1/signals
- /api/v1/orders
- /api/v1/positions
- /api/v1/trades
- /api/v1/risk
- /api/v1/notifications
- /api/v1/learning
- /api/v1/settings
- /api/v1/system
- /api/v1/webhooks/tradingview

---

# 32. GITHUB WORKFLOW

Every code change must use the existing repository, use the correct active branch, be reviewed against the existing architecture, be committed with a meaningful message, avoid secrets, avoid unrelated changes, preserve deployability, include tests where appropriate, include migration files where required, and update documentation where required.

Do not claim implementation is complete unless a real commit exists.

Every completion report must include files changed, features implemented, tests performed, deployment status, commit SHA, and remaining limitations.

---

# 33. TESTING

Implement:

- Unit tests.
- Integration tests.
- API tests.
- Risk-rule tests.
- Order-validation tests.
- Webhook signature tests.
- Replay-protection tests.
- Idempotency tests.
- Broker-adapter tests.
- Database migration tests.
- UI tests.
- Mobile tests.
- End-to-end tests.
- Sandbox execution tests.
- Read-only live tests.
- Failure recovery tests.
- Kill-switch tests.
- Stale-data tests.
- Duplicate-order tests.
- Partial-fill tests.

Never test new logic with live order submission enabled.

---

# 34. DEPLOYMENT AND RELEASE SAFETY

Deployment must follow this order:

1. Inspect repository state.
2. Run tests.
3. Run linting.
4. Validate configuration.
5. Validate migrations.
6. Deploy backend changes.
7. Validate health.
8. Deploy frontend changes.
9. Validate sandbox mode.
10. Validate read-only live mode.
11. Keep live execution locked.
12. Record deployment version.
13. Record commit SHA.
14. Confirm rollback path.

Before live execution can be enabled, sandbox tests, risk tests, webhook tests, broker read-only sync, position reconciliation, kill switch, live PIN, session expiration, duplicate-order protection, idempotency, order-status verification, emergency lock, and audit logs must all pass.

Live execution must remain disabled by default after deployment.

---

# 35. FUTURE READY

Even if not immediately used, keep the architecture ready for:

- Multi-broker support.
- Options trading.
- Futures trading.
- Crypto trading.
- Forex trading.
- Portfolio management.
- Tax reporting.
- AI assistants.
- Voice commands.
- Desktop application.
- Apple Watch integration.
- Wear OS integration.
- Advanced market replay.
- Additional market-data providers.
- Strategy plug-ins.
- Additional execution venues.

These future capabilities must not complicate the current personal single-owner product.

Do not build them unless requested. Only keep clean extension points.

---

# 36. ACCEPTANCE CRITERIA

The project is not complete until:

- Sandbox and live modes are fully separated.
- The application clearly shows the active mode.
- Webull connectivity is stable.
- TradingView webhooks are secure.
- The internal scanner works.
- The scoring engine is explainable.
- Risk management overrides strategy decisions.
- Live trading remains locked by default.
- Mobile and web interfaces are functional.
- Push notifications work.
- The kill switch works.
- The system logs all important actions.
- The dashboard shows real-time status.
- The learning center records trade explanations.
- Tests pass.
- Deployment is stable.
- No secrets exist in GitHub.
- Every implemented stage has a real commit SHA.

---

# 37. REQUIRED IMPLEMENTATION METHOD

For every development stage:

1. Inspect the repository.
2. Identify the exact existing modules involved.
3. State what will be changed.
4. Implement only the required scope.
5. Add or update tests.
6. Run validation.
7. Commit the changes.
8. Push the branch.
9. Report only what was actually completed.
10. Include the real commit SHA.

Do not respond with plans only.

Do not claim that code was changed unless it was actually changed.

Do not mark a stage complete without evidence.

---

# 38. FINAL ENGINEERING PRINCIPLE

MOE-AI must always prioritize:

1. Safety.
2. Correctness.
3. Risk control.
4. Security.
5. Reliability.
6. Explainability.
7. Data integrity.
8. Execution accuracy.
9. Performance.
10. Visual quality.

The platform must never place a trade simply because a signal exists.

A trade may only be executed when the signal is valid, market data is fresh, the broker is healthy, the account is synchronized, the strategy score is sufficient, risk rules approve, the trading session is allowed, the mode is correct, the system is armed, the kill switch is off, and the order has passed final safety validation.
