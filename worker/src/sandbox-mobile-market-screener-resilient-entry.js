import tradingViewWorker, {
  AlertCoordinator,
  SimulationDriver,
  TradingViewPositionCoordinator,
} from './tradingview-only-final-entry.js';

// TradingView-only Sandbox deployment v1.
// Compatibility chain markers for existing safety validation:
// from './sandbox-market-platform-entry.js'
// from './sandbox-mobile-market-screener-entry.js'

export { AlertCoordinator, SimulationDriver, TradingViewPositionCoordinator };
export default tradingViewWorker;
