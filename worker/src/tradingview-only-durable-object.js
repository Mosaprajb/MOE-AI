import { DurableObject } from 'cloudflare:workers';
import { TradingViewPositionCoordinator as TradingViewPositionRuntime } from './tradingview-only-runtime-final.js';

export class TradingViewPositionCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.runtime = new TradingViewPositionRuntime(ctx, env);
  }

  snapshot() {
    return this.runtime.snapshot();
  }

  processAlert(alert, settings, globalRuntime) {
    return this.runtime.processAlert(alert, settings, globalRuntime);
  }

  emergencyClose(reason = 'KILL_SWITCH') {
    return this.runtime.emergencyClose(reason);
  }

  monitor(trigger = 'RPC') {
    return this.runtime.monitor(trigger);
  }

  alarm() {
    return this.runtime.alarm();
  }
}
