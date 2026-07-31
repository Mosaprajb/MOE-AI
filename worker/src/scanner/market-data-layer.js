import { MarketDataService } from '../market-data/market-data-service.js';

export class MarketDataLayer extends MarketDataService {
  constructor(options = {}) {
    super({
      minimumBars: options.minimumBars ?? 0,
      requirePrice: options.requirePrice ?? false,
      rejectStale: options.rejectStale ?? false,
      minimumQualityScore: options.minimumQualityScore ?? 0,
      ...options,
    });
  }
}

export function createMarketDataLayer(options) {
  return new MarketDataLayer(options);
}
