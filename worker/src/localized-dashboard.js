import { dashboardHtml as unifiedDashboardHtml } from './unified-dashboard.js';
import {
  dashboardLanguageToggleMarkup,
  dashboardLocaleBootstrapScript,
  getDashboardMessages,
} from './dashboard-i18n.js';

const Arabic = getDashboardMessages('ar');
const English = getDashboardMessages('en');

const staticTextPairs = Object.freeze([
  [Arabic.overview, English.overview],
  [Arabic.activeTrade, English.activeTrade],
  [Arabic.scanner, English.scanner],
  [Arabic.trades, English.trades],
  [Arabic.analytics, English.analytics],
  [Arabic.liveControl, English.liveControl],
  [Arabic.learningCenter, English.learningCenter],
  [Arabic.platformSubtitle, English.platformSubtitle],
  [Arabic.mode, English.mode],
  [Arabic.system, English.system],
  [Arabic.broker, English.broker],
  [Arabic.data, English.data],
  [Arabic.refresh, English.refresh],
  [Arabic.connecting, English.connecting],
  [Arabic.checkingConnection, English.checkingConnection],
  [Arabic.waitingForSession, English.waitingForSession],
  [Arabic.loadingMarketSession, English.loadingMarketSession],
  [Arabic.exchangeTimezone, English.exchangeTimezone],
  [Arabic.operatingStatus, English.operatingStatus],
  [Arabic.loadingSafeState, English.loadingSafeState],
  [Arabic.automatedTradeManagement, English.automatedTradeManagement],
  [Arabic.decisionMonitoring, English.decisionMonitoring],
  [Arabic.waitingForTrade, English.waitingForTrade],
  [Arabic.noActiveTrade, English.noActiveTrade],
  [Arabic.scannerWatching, English.scannerWatching],
  [Arabic.decisionConfidence, English.decisionConfidence],
  [Arabic.opportunityGrade, English.opportunityGrade],
  [Arabic.riskRewardRatio, English.riskRewardRatio],
  [Arabic.positionProtection, English.positionProtection],
  [Arabic.nextAction, English.nextAction],
  [Arabic.inactive, English.inactive],
  [Arabic.searchOpportunity, English.searchOpportunity],
  [Arabic.autoScannerCenter, English.autoScannerCenter],
  [Arabic.loading, English.loading],
  [Arabic.automationStatus, English.automationStatus],
  [Arabic.session, English.session],
  [Arabic.lastHeartbeat, English.lastHeartbeat],
  [Arabic.lastScan, English.lastScan],
  [Arabic.candidates, English.candidates],
  [Arabic.submittedOrders, English.submittedOrders],
  [Arabic.universe, English.universe],
  [Arabic.profiles, English.profiles],
  [Arabic.maxSubmissions, English.maxSubmissions],
  [Arabic.dataSource, English.dataSource],
  [Arabic.liveTradingControl, English.liveTradingControl],
  [Arabic.locked, English.locked],
  [Arabic.productionSystem, English.productionSystem],
  [Arabic.liveTrading, English.liveTrading],
  [Arabic.liveAutomation, English.liveAutomation],
  [Arabic.emergencySwitch, English.emergencySwitch],
  [Arabic.loadingProductionGates, English.loadingProductionGates],
  [Arabic.runAudit, English.runAudit],
  [Arabic.testPin, English.testPin],
  [Arabic.enableSandbox, English.enableSandbox],
  [Arabic.disableSandbox, English.disableSandbox],
  [Arabic.lockAll, English.lockAll],
  [Arabic.refreshStatus, English.refreshStatus],
  [Arabic.liveStillLocked, English.liveStillLocked],
]);

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function dashboardLocalizationRuntimeScript() {
  const pairs = escapeScriptJson(staticTextPairs);
  return `
  (() => {
    const pairs = ${pairs};
    const i18n = window.MOERAND_I18N;
    if (!i18n) return;
    const ArabicToEnglish = new Map(pairs);
    const EnglishToArabic = new Map(pairs.map(([ar, en]) => [en, ar]));
    const translateText = (value, locale) => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return value;
      const translated = locale === 'en' ? ArabicToEnglish.get(trimmed) : EnglishToArabic.get(trimmed);
      if (!translated) return value;
      const leading = String(value).match(/^\\s*/)?.[0] || '';
      const trailing = String(value).match(/\\s*$/)?.[0] || '';
      return leading + translated + trailing;
    };
    const applyLocale = () => {
      const locale = i18n.locale();
      document.querySelectorAll('body *').forEach(element => {
        if (element.id === 'languageToggle') return;
        [...element.childNodes].forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) node.nodeValue = translateText(node.nodeValue, locale);
        });
      });
      const toggle = document.getElementById('languageToggle');
      if (toggle) {
        toggle.textContent = i18n.t('switchLabel');
        toggle.setAttribute('aria-label', locale === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
      }
      const nav = document.querySelector('.terminal-nav');
      if (nav) nav.setAttribute('aria-label', i18n.t('mainNavigation'));
    };
    const toggle = document.getElementById('languageToggle');
    if (toggle) toggle.addEventListener('click', () => i18n.setLocale(i18n.locale() === 'ar' ? 'en' : 'ar'));
    window.addEventListener('moerand:locale-change', applyLocale);
    const observer = new MutationObserver(() => applyLocale());
    observer.observe(document.body, { childList: true, subtree: true });
    applyLocale();
  })();`;
}

export function dashboardHtml() {
  return unifiedDashboardHtml()
    .replace('<div class="terminal-status-strip">', `<div class="terminal-status-strip">${dashboardLanguageToggleMarkup()}`)
    .replace('</style>', '.language-toggle{height:46px;min-width:92px;font-weight:850}[dir="ltr"] .trade-summary-panel{border-left:0;border-right:1px solid rgba(55,91,126,.42)}[dir="ltr"] .trade-level-label{right:auto;left:8px}[dir="ltr"] .trade-level-price{left:auto;right:-48px}</style>')
    .replace('<script>', `<script>${dashboardLocaleBootstrapScript()}`)
    .replace('</script></body></html>', `${dashboardLocalizationRuntimeScript()}</script></body></html>`);
}

export function htmlResponse() {
  return new Response(dashboardHtml(), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    },
  });
}
