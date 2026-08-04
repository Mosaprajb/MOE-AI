import tradingViewWorker, {
  AlertCoordinator,
  SimulationDriver,
  TradingViewPositionCoordinator,
} from './tradingview-only-safari-auth-entry.js';

// TradingView-only Sandbox deployment v6: Safari-safe native session handoff plus whole-trade targets,
// session clock, optional margin-long, and no-overnight auto-flatten.
// Compatibility chain markers for existing safety validation:
// from './tradingview-only-cloudflare-entry.js'
// from './sandbox-market-platform-entry.js'
// from './sandbox-mobile-market-screener-entry.js'

export { AlertCoordinator, SimulationDriver, TradingViewPositionCoordinator };
export default tradingViewWorker;
