import worker, { AlertCoordinator } from './session-notification-entry.js';

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

async function revealSessionControls(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  if (html.includes('moerandSessionControlsVisibilityFix')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: secureHeaders(response),
    });
  }

  const style = `<style id="moerandSessionControlsVisibilityFix">
  .live-actions > #sessionPolicyPanel {
    display: block !important;
    width: 100% !important;
    visibility: visible !important;
    opacity: 1 !important;
  }
  #sessionPolicyPanel > #sessionNotificationControls {
    display: grid !important;
    visibility: visible !important;
    opacity: 1 !important;
  }
  </style>`;

  const enhanced = html.replace('</head>', `${style}</head>`);
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers: secureHeaders(response),
  });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const response = await worker.fetch(request, env, ctx);
    const path = new URL(request.url).pathname;
    return DASHBOARD_PATHS.has(path) ? revealSessionControls(response) : response;
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
