export const SUPPORTED_DASHBOARD_LOCALES = Object.freeze(['ar', 'en']);
export const DEFAULT_DASHBOARD_LOCALE = 'ar';

const translations = Object.freeze({
  ar: Object.freeze({
    languageName: 'العربية',
    switchLabel: 'English',
    mainNavigation: 'التنقل الرئيسي',
    overview: 'الرئيسية',
    activeTrade: 'الصفقة النشطة',
    scanner: 'الماسح',
    trades: 'الصفقات',
    analytics: 'التحليلات',
    liveControl: 'التحكم الحقيقي',
    learningCenter: 'مركز التعلم',
    platformSubtitle: 'منصة التداول الآلي والتحكم بالمخاطر',
    mode: 'الوضع',
    system: 'النظام',
    broker: 'الوسيط',
    data: 'البيانات',
    refresh: 'تحديث',
    connecting: 'جاري الاتصال',
    checkingConnection: 'فحص الاتصال',
    waitingForSession: 'بانتظار الجلسة',
    loadingMarketSession: 'تحميل جلسة السوق',
    exchangeTimezone: 'توقيت البورصة: نيويورك',
    operatingStatus: 'حالة التشغيل',
    loadingSafeState: 'يتم تحميل حالة النظام الآمن.',
    automatedTradeManagement: 'إدارة الصفقة الآلية',
    decisionMonitoring: 'مراقبة القرار',
    waitingForTrade: 'بانتظار صفقة',
    noActiveTrade: 'لا توجد صفقة نشطة',
    scannerWatching: 'الماسح يراقب السوق وينتظر فرصة مطابقة للقواعد.',
    decisionConfidence: 'ثقة القرار',
    opportunityGrade: 'تصنيف الفرصة',
    riskRewardRatio: 'نسبة R/R',
    positionProtection: 'حماية المركز',
    nextAction: 'الإجراء التالي',
    inactive: 'غير نشطة',
    searchOpportunity: 'البحث عن فرصة',
    autoScannerCenter: 'مركز الماسح الآلي',
    loading: 'تحميل',
    automationStatus: 'حالة الأتمتة',
    session: 'الجلسة',
    lastHeartbeat: 'آخر نبضة',
    lastScan: 'آخر فحص',
    candidates: 'المرشحون',
    submittedOrders: 'الأوامر المرسلة',
    universe: 'الكون',
    profiles: 'الملفات',
    maxSubmissions: 'أقصى إرسال للفحص',
    dataSource: 'مصدر البيانات',
    liveTradingControl: 'التحكم بالتداول الحقيقي',
    locked: 'مقفل',
    productionSystem: 'نظام الإنتاج',
    liveTrading: 'التداول الحقيقي',
    liveAutomation: 'الأتمتة الحقيقية',
    emergencySwitch: 'مفتاح الطوارئ',
    loadingProductionGates: 'تحميل بوابات الإنتاج...',
    runAudit: 'تشغيل الفحص',
    testPin: 'اختبار PIN',
    enableSandbox: 'تشغيل Sandbox',
    disableSandbox: 'إيقاف Sandbox',
    lockAll: 'إيقاف وقفل الجميع',
    refreshStatus: 'تحديث الحالة',
    liveStillLocked: 'التداول الحقيقي ما زال مقفلًا.',
  }),
  en: Object.freeze({
    languageName: 'English',
    switchLabel: 'العربية',
    mainNavigation: 'Main navigation',
    overview: 'Overview',
    activeTrade: 'Active Trade',
    scanner: 'Scanner',
    trades: 'Trades',
    analytics: 'Analytics',
    liveControl: 'Live Control',
    learningCenter: 'Learning Center',
    platformSubtitle: 'Automated trading and risk control platform',
    mode: 'Mode',
    system: 'System',
    broker: 'Broker',
    data: 'Data',
    refresh: 'Refresh',
    connecting: 'Connecting',
    checkingConnection: 'Checking connection',
    waitingForSession: 'Waiting for session',
    loadingMarketSession: 'Loading market session',
    exchangeTimezone: 'Exchange time: New York',
    operatingStatus: 'Operating Status',
    loadingSafeState: 'Loading the safe system state.',
    automatedTradeManagement: 'Automated Trade Management',
    decisionMonitoring: 'Decision Monitoring',
    waitingForTrade: 'Waiting for trade',
    noActiveTrade: 'No active trade',
    scannerWatching: 'The scanner is monitoring the market for a rules-compliant opportunity.',
    decisionConfidence: 'Decision Confidence',
    opportunityGrade: 'Opportunity Grade',
    riskRewardRatio: 'R/R Ratio',
    positionProtection: 'Position Protection',
    nextAction: 'Next Action',
    inactive: 'Inactive',
    searchOpportunity: 'Search for opportunity',
    autoScannerCenter: 'Automated Scanner Center',
    loading: 'Loading',
    automationStatus: 'Automation Status',
    session: 'Session',
    lastHeartbeat: 'Last Heartbeat',
    lastScan: 'Last Scan',
    candidates: 'Candidates',
    submittedOrders: 'Submitted Orders',
    universe: 'Universe',
    profiles: 'Profiles',
    maxSubmissions: 'Maximum submissions per scan',
    dataSource: 'Data Source',
    liveTradingControl: 'Live Trading Control',
    locked: 'Locked',
    productionSystem: 'Production System',
    liveTrading: 'Live Trading',
    liveAutomation: 'Live Automation',
    emergencySwitch: 'Emergency Switch',
    loadingProductionGates: 'Loading production gates...',
    runAudit: 'Run Audit',
    testPin: 'Test PIN',
    enableSandbox: 'Enable Sandbox',
    disableSandbox: 'Disable Sandbox',
    lockAll: 'Stop and Lock All',
    refreshStatus: 'Refresh Status',
    liveStillLocked: 'Live trading remains locked.',
  }),
});

export function normalizeDashboardLocale(locale) {
  const normalized = String(locale ?? '').trim().toLowerCase().split('-')[0];
  return SUPPORTED_DASHBOARD_LOCALES.includes(normalized) ? normalized : DEFAULT_DASHBOARD_LOCALE;
}

export function getDashboardMessages(locale) {
  return translations[normalizeDashboardLocale(locale)];
}

export function getDashboardDirection(locale) {
  return normalizeDashboardLocale(locale) === 'ar' ? 'rtl' : 'ltr';
}

export function dashboardLocaleBootstrapScript() {
  const serialized = JSON.stringify(translations);
  return `
  (() => {
    const messages = ${serialized};
    const supported = ['ar', 'en'];
    const storageKey = 'moerand.locale';
    const normalize = value => {
      const locale = String(value || '').toLowerCase().split('-')[0];
      return supported.includes(locale) ? locale : 'ar';
    };
    const state = { locale: normalize(localStorage.getItem(storageKey) || document.documentElement.lang || 'ar') };
    window.MOERAND_I18N = {
      locale: () => state.locale,
      t: key => messages[state.locale]?.[key] || messages.en[key] || key,
      setLocale(locale) {
        state.locale = normalize(locale);
        localStorage.setItem(storageKey, state.locale);
        document.documentElement.lang = state.locale;
        document.documentElement.dir = state.locale === 'ar' ? 'rtl' : 'ltr';
        window.dispatchEvent(new CustomEvent('moerand:locale-change', { detail: { locale: state.locale } }));
      },
      formatDate(value, options = {}) {
        return new Intl.DateTimeFormat(state.locale === 'ar' ? 'ar-US' : 'en-US', options).format(new Date(value));
      },
      formatNumber(value, options = {}) {
        return new Intl.NumberFormat(state.locale === 'ar' ? 'ar-US' : 'en-US', options).format(value);
      },
    };
    window.MOERAND_I18N.setLocale(state.locale);
  })();`;
}

export function dashboardLanguageToggleMarkup() {
  return '<button type="button" id="languageToggle" class="language-toggle" aria-label="Switch language">English</button>';
}
