import alertsWorker, { AlertCoordinator } from './index.js';
import { handleWebullSandboxOrder } from './webull-sandbox.js';

export { AlertCoordinator };

const WEBULL_WEBHOOK_PATH = '/api/tradingview/webull-preview';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === WEBULL_WEBHOOK_PATH) {
      return handleWebullSandboxOrder(request, env);
    }

    return alertsWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return alertsWorker.scheduled(controller, env, ctx);
  }
};
