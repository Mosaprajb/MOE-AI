// Cloudflare runtime wrapper for Sandbox Simulation Mode.
//
// The historical simulation worker remains testable in Node, while the exported
// Durable Object class used by Wrangler inherits from Cloudflare's required base
// class so its public control methods can be invoked through Durable Object RPC.

import { DurableObject } from 'cloudflare:workers';
import simulationWorker, { AlertCoordinator } from './sandbox-simulation-entry.js';
import { SimulationDriver as SimulationDriverCore } from './simulation/simulation-server-runtime.js';

export { AlertCoordinator };

export class SimulationDriver extends DurableObject {
  #core;

  constructor(ctx, env) {
    super(ctx, env);
    this.#core = new SimulationDriverCore(ctx, env);
  }

  async arm(override) {
    return this.#core.arm(override);
  }

  async ensureArmed() {
    return this.#core.ensureArmed();
  }

  async disarm(reason = 'SIMULATION_STOPPED') {
    return this.#core.disarm(reason);
  }

  async alarm() {
    return this.#core.alarm();
  }
}

export default simulationWorker;
