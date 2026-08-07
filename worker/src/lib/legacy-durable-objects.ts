type DurableObjectRequestContext = {
  waitUntil?(promise: Promise<unknown>): void;
};

function unavailableResponse(className: string): Response {
  return new Response(JSON.stringify({
    ok: false,
    code: 'LEGACY_DURABLE_OBJECT_QUARANTINED',
    error: `${className} is preserved for namespace compatibility but is not active in this Worker build.`,
  }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Compatibility-only Durable Object base.
 *
 * These classes intentionally do not read, write, delete, or migrate storage.
 * Exporting the historic class names keeps Cloudflare's existing namespaces
 * attached while the original implementation is recovered and reviewed.
 */
class QuarantinedLegacyDurableObject {
  constructor(
    protected readonly state: unknown,
    protected readonly env: unknown,
  ) {}

  fetch(_request: Request): Response {
    return unavailableResponse(this.constructor.name);
  }

  alarm(_context?: DurableObjectRequestContext): void {
    // Preserve namespace lifecycle without executing legacy scheduled work.
  }
}

export class AlertCoordinator extends QuarantinedLegacyDurableObject {}

export class SimulationDriver extends QuarantinedLegacyDurableObject {}

export class TradingViewPositionCoordinator extends QuarantinedLegacyDurableObject {}
