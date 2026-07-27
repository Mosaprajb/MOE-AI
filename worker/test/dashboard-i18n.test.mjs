import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DASHBOARD_LOCALE,
  SUPPORTED_DASHBOARD_LOCALES,
  dashboardLanguageToggleMarkup,
  dashboardLocaleBootstrapScript,
  getDashboardDirection,
  getDashboardMessages,
  normalizeDashboardLocale,
} from '../src/dashboard-i18n.js';

test('supports Arabic and English with Arabic as the default locale', () => {
  assert.deepEqual(SUPPORTED_DASHBOARD_LOCALES, ['ar', 'en']);
  assert.equal(DEFAULT_DASHBOARD_LOCALE, 'ar');
});

test('normalizes regional locale variants and rejects unsupported locales safely', () => {
  assert.equal(normalizeDashboardLocale('ar-US'), 'ar');
  assert.equal(normalizeDashboardLocale('en-US'), 'en');
  assert.equal(normalizeDashboardLocale('EN-gb'), 'en');
  assert.equal(normalizeDashboardLocale('fr-FR'), 'ar');
  assert.equal(normalizeDashboardLocale(null), 'ar');
});

test('returns the correct document direction for each supported locale', () => {
  assert.equal(getDashboardDirection('ar'), 'rtl');
  assert.equal(getDashboardDirection('en'), 'ltr');
  assert.equal(getDashboardDirection('unsupported'), 'rtl');
});

test('Arabic and English dictionaries expose the same translation keys', () => {
  const Arabic = getDashboardMessages('ar');
  const English = getDashboardMessages('en');

  assert.deepEqual(Object.keys(Arabic).sort(), Object.keys(English).sort());
  assert.equal(Arabic.overview, 'الرئيسية');
  assert.equal(English.overview, 'Overview');
  assert.equal(Arabic.scanner, 'الماسح');
  assert.equal(English.scanner, 'Scanner');
});

test('translation dictionaries and supported locale definitions are immutable', () => {
  const Arabic = getDashboardMessages('ar');
  const English = getDashboardMessages('en');

  assert.ok(Object.isFrozen(SUPPORTED_DASHBOARD_LOCALES));
  assert.ok(Object.isFrozen(Arabic));
  assert.ok(Object.isFrozen(English));
});

test('bootstrap script persists locale and updates html language and direction', () => {
  const script = dashboardLocaleBootstrapScript();

  assert.match(script, /moerand\.locale/);
  assert.match(script, /localStorage\.setItem/);
  assert.match(script, /document\.documentElement\.lang/);
  assert.match(script, /document\.documentElement\.dir/);
  assert.match(script, /moerand:locale-change/);
  assert.match(script, /Intl\.DateTimeFormat/);
  assert.match(script, /Intl\.NumberFormat/);
});

test('language toggle markup is accessible and exposes a stable element id', () => {
  const markup = dashboardLanguageToggleMarkup();

  assert.match(markup, /id="languageToggle"/);
  assert.match(markup, /aria-label="Switch language"/);
  assert.match(markup, />English<\/button>/);
});
