const DEFAULT_KEY = 'scanner-observation:latest';

function acceptedCandidates(scanResult) {
  return (scanResult?.candidates || []).filter((candidate) => candidate.accepted === true && candidate.observationOnly === true && candidate.executionEnabled === false);
}

export function createObservationService({ storage, notifier, dashboardPublisher, candidateForwarder, storageKey = DEFAULT_KEY } = {}) {
  return Object.freeze({
    async publish(scanResult, context = {}) {
      if (!scanResult || scanResult.observationOnly !== true || scanResult.executionEnabled !== false) {
        throw new Error('Observation service accepts observation-only scanner results.');
      }

      const topCandidates = acceptedCandidates(scanResult);
      const envelope = Object.freeze({
        version: 1,
        observationOnly: true,
        executionEnabled: false,
        scanned: Number(scanResult.scanned || 0),
        accepted: topCandidates.length,
        candidates: Object.freeze(topCandidates),
        generatedAt: scanResult.completedAt || new Date().toISOString(),
      });

      if (storage && typeof storage.put === 'function') await storage.put(storageKey, envelope);
      if (typeof dashboardPublisher === 'function') await dashboardPublisher(envelope, context);
      if (typeof notifier === 'function' && topCandidates.length > 0) await notifier(envelope, context);
      if (typeof candidateForwarder === 'function' && topCandidates.length > 0) {
        await candidateForwarder(Object.freeze({
          ...envelope,
          executionRequested: false,
          requiresTradingControlApproval: true,
        }), context);
      }

      return envelope;
    },

    async latest() {
      if (!storage || typeof storage.get !== 'function') return null;
      return storage.get(storageKey);
    },
  });
}
