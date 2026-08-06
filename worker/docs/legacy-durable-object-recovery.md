# Legacy Durable Object recovery guard

The deployed `moerand-alerts-sandbox` Worker currently owns these Durable Object namespaces:

- `AlertCoordinator`
- `SimulationDriver`
- `TradingViewPositionCoordinator`

The original implementations are not present in the current source tree. To avoid namespace retirement or data loss, the Worker exports compatibility-only classes with the same names.

These compatibility classes:

- do not read, write, delete, or migrate Durable Object storage;
- return HTTP 503 for direct requests;
- do not execute alarm work;
- keep the existing Cloudflare declarative `exports` lifecycle intact.

They are temporary quarantine adapters. Replacing them with recovered implementations requires a separate reviewed change with storage-schema and behavior validation.
