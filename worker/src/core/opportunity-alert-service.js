import { eventBus } from './event-bus.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function opportunityKey(opportunity = {}) {
  return [
    String(opportunity.symbol || '').toUpperCase(),
    String(opportunity.direction || ''),
    round(opportunity.entryPrice),
    round(opportunity.stopLoss),
    round(opportunity.takeProfit),
    number(opportunity.expiresAt),
  ].join(':');
}

export function buildOpportunityAlert(opportunity = {}, eventType = 'created') {
  const symbol = String(opportunity.symbol || '').toUpperCase();
  const direction = String(opportunity.direction || '').toLowerCase() === 'short' ? 'SELL' : 'BUY';
  const confidence = Math.round(number(opportunity.confidence));
  const lowerZone = round(opportunity.lowerZone);
  const upperZone = round(opportunity.upperZone);
  const entryPrice = round(opportunity.entryPrice);
  const stopLoss = round(opportunity.stopLoss);
  const takeProfit = round(opportunity.takeProfit);
  const riskReward = number(opportunity.riskReward).toFixed(2);

  return {
    id: opportunityKey(opportunity),
    type: eventType === 'replaced' ? 'OPPORTUNITY_REPLACED' : 'OPPORTUNITY_CREATED',
    title: `${symbol} · ${eventType === 'replaced' ? 'Better setup' : 'New setup'} · ${direction}`,
    body: `Zone ${lowerZone}-${upperZone} · Entry ${entryPrice} · SL ${stopLoss} · TP ${takeProfit} · RR ${riskReward} · Score ${confidence}`,
    symbol,
    direction,
    timeframe: opportunity.timeframe,
    confidence,
    entryPrice,
    lowerZone,
    upperZone,
    stopLoss,
    takeProfit,
    riskReward: number(opportunity.riskReward),
    liquidity: opportunity.liquidity || null,
    zoneAnchor: opportunity.zoneAnchor || null,
    createdAt: number(opportunity.createdAt, Date.now()),
    expiresAt: number(opportunity.expiresAt),
    replaced: eventType === 'replaced',
  };
}

export class OpportunityAlertService {
  constructor({ storage, deliver, cooldownMs = 0 } = {}) {
    if (typeof deliver !== 'function') throw new Error('Opportunity alert service requires a deliver function');
    this.storage = storage;
    this.deliver = deliver;
    this.cooldownMs = Math.max(0, number(cooldownMs));
    this.memory = new Map();
    this.unsubscribers = [];
  }

  async read(key) {
    if (this.storage?.get) return this.storage.get(key);
    return this.memory.get(key);
  }

  async write(key, value) {
    if (this.storage?.put) return this.storage.put(key, value);
    this.memory.set(key, value);
  }

  async dispatch(opportunity, eventType) {
    if (!opportunity?.accepted) return { sent: false, reason: 'OPPORTUNITY_NOT_ACCEPTED' };

    const alert = buildOpportunityAlert(opportunity, eventType);
    const stateKey = `opportunity-alert:${alert.symbol}`;
    const previous = await this.read(stateKey);
    const now = Date.now();

    if (previous?.id === alert.id) {
      return { sent: false, reason: 'DUPLICATE_OPPORTUNITY', alert };
    }
    if (this.cooldownMs > 0 && previous?.sentAt && now - previous.sentAt < this.cooldownMs && eventType !== 'replaced') {
      return { sent: false, reason: 'ALERT_COOLDOWN', alert };
    }

    await this.deliver(alert);
    await this.write(stateKey, { id: alert.id, sentAt: now, expiresAt: alert.expiresAt });
    await eventBus.emit('opportunity:alert-sent', { ...alert, sentAt: now });
    return { sent: true, alert };
  }

  start() {
    if (this.unsubscribers.length) return this;
    this.unsubscribers.push(
      eventBus.on('opportunity:created', (opportunity) => this.dispatch(opportunity, 'created')),
      eventBus.on('opportunity:replaced', (opportunity) => this.dispatch(opportunity, 'replaced')),
    );
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  }
}

export function initializeOpportunityAlerts(options = {}) {
  return new OpportunityAlertService(options).start();
}
