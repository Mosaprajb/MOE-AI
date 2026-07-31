# Unified MarketSnapshot

Every scanner analyzer receives one immutable `MOE.MarketSnapshot` object from `MarketDataService`.

The snapshot contains:

- normalized OHLCV bars and latest candle
- ATR, VWAP, point of control, and relative volume
- bid/ask spread and liquidity measurements
- float, sector, industry, market capitalization, and company profile
- normalized regular, pre-market, after-hours, overnight, or extended session state
- normalized news events and sentiment metadata
- normalized options volume, put/call ratio, implied volatility, open interest, gamma exposure, and unusual activity
- quality, freshness, schema validation, and optional-data completeness diagnostics

Missing optional data remains `null`, an empty array, or `available: false`; the normalizer does not invent values. Core price and timestamp quality failures remain fail-closed before analysis.

The snapshot is observation-only and cannot grant order-execution authority. Sandbox and Live execution gates remain outside the market-data layer.
