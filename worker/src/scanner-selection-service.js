const SETTINGS_KEY = 'scanner-selection-settings:v1';

export const SCANNER_SELECTION_LEVELS = Object.freeze({
  DISCOVERY: Object.freeze({ level: 'DISCOVERY', minimumScore: 58, labelAr: 'استكشاف', descriptionAr: 'يوسّع البحث ويعرض فرصًا أولية أكثر، مع بقاء جميع فلاتر القرار والمخاطر.' }),
  ACTIVE: Object.freeze({ level: 'ACTIVE', minimumScore: 65, labelAr: 'نشط', descriptionAr: 'بحث أوسع من الوضع المتوازن لزيادة عدد الأسهم التي تصل إلى التقييم المتقدم.' }),
  BALANCED: Object.freeze({ level: 'BALANCED', minimumScore: 70, labelAr: 'متوازن', descriptionAr: 'الإعداد الافتراضي الحالي بين عدد الفرص وجودتها.' }),
  CONSERVATIVE: Object.freeze({ level: 'CONSERVATIVE', minimumScore: 75, labelAr: 'حذر', descriptionAr: 'يركز على الإشارات الأعلى درجة ويقلل عدد المرشحين.' }),
});

function normalizeLevel(value) {
  const level = String(value || 'BALANCED').trim().toUpperCase();
  return SCANNER_SELECTION_LEVELS[level] ? level : 'BALANCED';
}

function publicSettings(record = {}) {
  const level = normalizeLevel(record.level);
  const definition = SCANNER_SELECTION_LEVELS[level];
  return {
    ...definition,
    updatedAt: record.updatedAt || null,
    updatedBy: record.updatedBy || null,
    sandboxOnly: true,
    executionSafetyFiltersUnchanged: true,
  };
}

export async function getScannerSelectionSettings(storage) {
  const stored = await storage.get(SETTINGS_KEY);
  return publicSettings(stored || { level: 'BALANCED' });
}

export async function updateScannerSelectionSettings(storage, patch = {}) {
  const level = normalizeLevel(patch.level);
  const record = {
    level,
    updatedAt: new Date().toISOString(),
    updatedBy: String(patch.updatedBy || 'DASHBOARD_OWNER').slice(0, 80),
  };
  await storage.put(SETTINGS_KEY, record);
  return publicSettings(record);
}

export function applyScannerSelectionSettings(env = {}, settings = {}) {
  const safeSandbox = String(env.WEBULL_ENVIRONMENT || '').toLowerCase() === 'sandbox'
    && String(env.WEBULL_LIVE_TRADING || '').toLowerCase() !== 'true';
  if (!safeSandbox) return env;

  const definition = SCANNER_SELECTION_LEVELS[normalizeLevel(settings.level)];
  const minimumScore = String(definition.minimumScore);
  return {
    ...env,
    AUTO_SCANNER_MIN_SCORE: minimumScore,
    AUTO_SCANNER_MIN_SCORE_EXTENDED: minimumScore,
    AUTO_SCANNER_MIN_SCORE_NIGHT: minimumScore,
    MOE_SCANNER_SELECTION_LEVEL: definition.level,
  };
}
