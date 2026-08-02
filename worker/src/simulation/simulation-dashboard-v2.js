// Post-process the existing simulation dashboard enhancement with the extended strategy registry.
// Keeping this layer separate avoids duplicating the stable dashboard implementation.

function copyHeaders(headers) {
  const output = new Headers(headers);
  output.set('cache-control', 'no-store, no-cache, must-revalidate');
  return output;
}

export async function enhanceSimulationStrategyDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;

  const html = await response.text();
  if (!html.includes('moeSimulationScript')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: copyHeaders(response.headers),
    });
  }

  let output = html;
  output = output.replace(
    "new Set(['FUSION_V2','MOERAND_SIMPLE_INTERNAL'])",
    "new Set(['FUSION_V2','MOERAND_SIMPLE_INTERNAL','MOERAND_SCALP_INTERNAL'])",
  );
  output = output.replace(
    '> MOERAND_SIMPLE_INTERNAL</label></div></div>',
    '> MOERAND_SIMPLE_INTERNAL</label><label class="sim-option"><input type="checkbox" name="sim-strategy" value="MOERAND_SCALP_INTERNAL" \'+checked(\'MOERAND_SCALP_INTERNAL\')+\' \'+(active?\'disabled\':\'\')+\'> MOERAND_SCALP_INTERNAL</label></div></div>',
  );
  output = output.replace(
    "+metric('AVG R',Number(m.averageR||0).toFixed(3))",
    "+metric('AVG R',Number(m.averageR||0).toFixed(3))+metric('SESSION LIMIT',Number(m.executed||0)+' / '+Number(m.maxDailyTrades||0))",
  );

  return new Response(output, {
    status: response.status,
    statusText: response.statusText,
    headers: copyHeaders(response.headers),
  });
}
