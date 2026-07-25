function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resultFor(opportunity, metadata = {}) {
  return {
    ...opportunity,
    accepted: metadata.accepted === true,
    replaced: metadata.replaced === true,
    reason: metadata.reason || null,
    previous: metadata.previous ? { ...metadata.previous } : null,
    active: metadata.active ? { ...metadata.active } : null,
  };
}

export class OpportunityEngine {
  constructor() {
    this.active = new Map();
  }

  evaluate(candidate, now = Date.now()) {
    const symbol = String(candidate?.symbol || '').toUpperCase();
    if (!symbol) throw new Error('Opportunity requires symbol');

    const expiresAt = number(candidate.expiresAt, now + 30 * 60 * 1000);
    const normalized = {
      ...candidate,
      symbol,
      confidence: number(candidate.confidence),
      createdAt: number(candidate.createdAt, now),
      expiresAt,
    };

    if (expiresAt <= now) {
      return resultFor(normalized, {
        accepted: false,
        replaced: false,
        reason: 'Candidate expired',
        active: this.get(symbol, now),
      });
    }

    const current = this.get(symbol, now);
    if (!current) {
      this.active.set(symbol, normalized);
      return resultFor(normalized, {
        accepted: true,
        replaced: false,
        reason: 'First valid opportunity',
        active: normalized,
      });
    }

    const confidenceDelta = normalized.confidence - number(current.confidence);
    const minImprovement = number(candidate.minimumImprovement, 3);
    if (confidenceDelta < minImprovement) {
      return resultFor(normalized, {
        accepted: false,
        replaced: false,
        reason: 'Existing opportunity is equal or stronger',
        previous: current,
        active: current,
      });
    }

    this.active.set(symbol, normalized);
    return resultFor(normalized, {
      accepted: true,
      replaced: true,
      reason: 'Stronger opportunity replaced previous setup',
      previous: current,
      active: normalized,
    });
  }

  get(symbol, now = Date.now()) {
    const key = String(symbol || '').toUpperCase();
    const value = this.active.get(key);
    if (!value) return null;
    if (number(value.expiresAt) <= now) {
      this.active.delete(key);
      return null;
    }
    return { ...value };
  }

  remove(symbol) {
    return this.active.delete(String(symbol || '').toUpperCase());
  }

  clearExpired(now = Date.now()) {
    let removed = 0;
    for (const [symbol, opportunity] of this.active.entries()) {
      if (number(opportunity.expiresAt) <= now) {
        this.active.delete(symbol);
        removed += 1;
      }
    }
    return removed;
  }
}

export const opportunityEngine = new OpportunityEngine();
