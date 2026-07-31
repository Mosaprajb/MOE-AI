# Dashboard Live Scanner

The Dashboard Live Scanner is a read-only presentation layer for the Opportunity Manager.

- Stores the latest selected opportunities in the global `AlertCoordinator` Durable Object.
- Adapts accepted legacy auto-scanner observations into Opportunity Manager inputs.
- Displays only active, non-expired, non-duplicate opportunities.
- Polls the read-only API every five seconds and updates expiry countdowns every second.
- Exposes Symbol, Grade, Score, Confidence, Status, Expiry, and Rank.
- Never exposes order submission or execution controls.

Endpoint: `GET /api/scanner/opportunities/live`
