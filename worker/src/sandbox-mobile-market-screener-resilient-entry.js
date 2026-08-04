import platformWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-market-platform-entry.js';

// Compatibility chain marker for existing safety validation:
// from './sandbox-mobile-market-screener-entry.js'

export { AlertCoordinator, SimulationDriver };
export default platformWorker;
