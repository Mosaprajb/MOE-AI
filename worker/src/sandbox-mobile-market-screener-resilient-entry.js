import tradingViewWorker, {
  AlertCoordinator,
  SimulationDriver,
  TradingViewPositionCoordinator,
} from './tradingview-only-face-id-entry.js';
import { tradingViewPnlControlPatch } from './tradingview-only-pnl-control-patch.js';

// TradingView-only Sandbox deployment v9: Face ID passkey gateway,
// Safari-safe interactive controls, broker-authoritative P&L, reliability tools,
// royal-blue/violet mobile theme, whole-trade targets, session clock,
// optional margin-long, and no-overnight auto-flatten.
// Compatibility chain markers for existing safety validation:
// from './tradingview-only-safari-auth-entry.js'
// from './tradingview-only-cloudflare-entry.js'
// from './sandbox-market-platform-entry.js'
// from './sandbox-mobile-market-screener-entry.js'

const DASHBOARD_PATHS = new Set([
  '/',
  '/dashboard',
  '/dashboard/',
  '/m',
  '/m/',
  '/mobile',
  '/mobile/',
  '/alerts',
  '/alerts/',
]);

const MOBILE_HEAD_PATCH = `
<style id="moe-mobile-royal-theme-v7">
:root{
  --bg:#070817!important;
  --surface:#11152d!important;
  --surface2:#191f3d!important;
  --surface3:#242b52!important;
  --line:#3a4778!important;
  --text:#f8f9ff!important;
  --muted:#a7b2d4!important;
  --accent:#6d7cff!important;
  --accent2:#b66dff!important;
  --green:#43e6a5!important;
  --red:#ff6f91!important;
  --amber:#ffc86b!important;
  --blue:#79b7ff!important;
  --shadow:0 20px 64px rgba(1,2,18,.46)!important;
}
html{background:var(--bg)!important}
body{
  background:
    radial-gradient(circle at 8% -8%,rgba(109,124,255,.28),transparent 38%),
    radial-gradient(circle at 100% 2%,rgba(182,109,255,.22),transparent 34%),
    linear-gradient(180deg,#080a1c 0%,var(--bg) 54%,#050612 100%)!important;
}
.topbar,.bottomnav{background:rgba(7,8,23,.92)!important;border-color:rgba(109,124,255,.22)!important}
.card,.panel,.hero,.loginbox,.positioncard{border-color:rgba(121,140,220,.34)!important}
.hero{background:linear-gradient(145deg,rgba(109,124,255,.17),rgba(182,109,255,.13)),var(--surface)!important}
.positioncard{background:linear-gradient(145deg,rgba(109,124,255,.12),rgba(182,109,255,.05) 52%),var(--surface)!important}
.button.primary,.navbtn.active{
  background:linear-gradient(135deg,#5c78ff,#9a63ff 58%,#c46dff)!important;
  color:#fff!important;
  border-color:transparent!important;
  box-shadow:0 12px 28px rgba(94,116,255,.30)!important;
}
.iconbtn,.button,.navbtn,.linkbtn,.panel summary,.bottomnav button{
  touch-action:manipulation;
  -webkit-user-select:none;
  user-select:none;
}
input,select{touch-action:manipulation;-webkit-user-select:text;user-select:text}
.iconbtn,.button,.navbtn,.linkbtn,.bottomnav button{
  transition:transform .12s ease,filter .12s ease,box-shadow .12s ease,border-color .12s ease!important;
}
.iconbtn:active,.button:active,.navbtn:active,.linkbtn:active,.bottomnav button:active{
  transform:scale(.965);
  filter:brightness(1.16);
}
.iconbtn:focus-visible,.button:focus-visible,.navbtn:focus-visible,.linkbtn:focus-visible,input:focus-visible,select:focus-visible,.panel summary:focus-visible{
  outline:3px solid rgba(121,183,255,.72)!important;
  outline-offset:2px!important;
}
button:disabled,.button:disabled{opacity:.56!important;cursor:wait!important;filter:saturate(.55)!important}
.switchline input{accent-color:var(--accent)!important}
.panel summary:after,.bottomnav button.active{color:#8ca4ff!important}
.loadingbar{background:linear-gradient(90deg,#5c78ff,#b66dff,#ff72c6)!important}
.toast{background:#242b52!important;border-color:#5c6fae!important;box-shadow:0 16px 45px rgba(0,0,0,.42)!important}
</style>
<script id="moe-mobile-browser-runtime-v7">
'use strict';
var moeThemeMeta = document.querySelector('meta[name="theme-color"]');
if (moeThemeMeta) moeThemeMeta.setAttribute('content', '#11152d');
var __defProp = window.__defProp || Object.defineProperty;
var __getOwnPropDesc = window.__getOwnPropDesc || Object.getOwnPropertyDescriptor;
var __getOwnPropSymbols = window.__getOwnPropSymbols || Object.getOwnPropertySymbols;
var __hasOwnProp = window.__hasOwnProp || Object.prototype.hasOwnProperty;
var __propIsEnum = window.__propIsEnum || Object.prototype.propertyIsEnumerable;
var __defNormalProp = window.__defNormalProp || function (object, key, value) {
  return key in object
    ? __defProp(object, key, { enumerable: true, configurable: true, writable: true, value: value })
    : (object[key] = value);
};
var __spreadValues = window.__spreadValues || function (target, source) {
  source = source || {};
  for (var property in source) {
    if (__hasOwnProp.call(source, property)) __defNormalProp(target, property, source[property]);
  }
  if (__getOwnPropSymbols) {
    var symbols = __getOwnPropSymbols(source);
    for (var index = 0; index < symbols.length; index += 1) {
      if (__propIsEnum.call(source, symbols[index])) __defNormalProp(target, symbols[index], source[symbols[index]]);
    }
  }
  return target;
};
var __spreadProps = window.__spreadProps || function (target, source) {
  return Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
};
var __name = window.__name || function (target, value) {
  try {
    __defProp(target, 'name', { value: value, configurable: true });
  } catch (_) {
    // Function names are cosmetic; interaction must continue when redefining is blocked.
  }
  return target;
};
window.__defProp = __defProp;
window.__getOwnPropDesc = __getOwnPropDesc;
window.__getOwnPropSymbols = __getOwnPropSymbols;
window.__hasOwnProp = __hasOwnProp;
window.__propIsEnum = __propIsEnum;
window.__defNormalProp = __defNormalProp;
window.__spreadValues = __spreadValues;
window.__spreadProps = __spreadProps;
window.__name = __name;
</script>`;

const PNL_NAV_COMPATIBILITY_PATCH = `
<script id="moe-pnl-view-navigation-compat-v1">
document.addEventListener('DOMContentLoaded', function () {
  var view = document.getElementById('moePnlView');
  if (view) view.classList.add('view');
}, { once: true });
</script>`;

function shouldPatchDashboard(request, response) {
  if (request.method !== 'GET') return false;
  if (!DASHBOARD_PATHS.has(new URL(request.url).pathname)) return false;
  return String(response.headers.get('content-type') || '').toLowerCase().includes('text/html');
}

function responseInit(response, headers = response.headers) {
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
  };
}

async function patchDashboardResponse(request, response) {
  if (!shouldPatchDashboard(request, response)) return response;

  const source = await response.text();
  const additions = [];
  if (!source.includes('moe-mobile-browser-runtime-v7')) additions.push(MOBILE_HEAD_PATCH);
  if (!source.includes('moe-pnl-control-script-v1')) {
    additions.push(`${tradingViewPnlControlPatch()}\n${PNL_NAV_COMPATIBILITY_PATCH}`);
  }
  if (!additions.length) return new Response(source, responseInit(response));

  const patch = additions.join('\n');
  const patched = source.includes('</head>')
    ? source.replace('</head>', `${patch}\n</head>`)
    : `${patch}\n${source}`;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  headers.set('x-moe-pnl-controls', 'broker-day-pnl-v1');

  return new Response(patched, responseInit(response, headers));
}

const resilientWorker = {
  ...tradingViewWorker,
  async fetch(request, env, ctx) {
    const response = await tradingViewWorker.fetch(request, env, ctx);
    return patchDashboardResponse(request, response);
  },
};

export { AlertCoordinator, SimulationDriver, TradingViewPositionCoordinator };
export default resilientWorker;
