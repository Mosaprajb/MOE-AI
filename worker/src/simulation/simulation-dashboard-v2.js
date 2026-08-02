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

  // Safari on iPhone blurs the password field when the keyboard Done button is pressed
  // or while the page is being scrolled. The simulation dashboard refresh then rebuilds
  // the panel with innerHTML. Keep the draft only in this page's JavaScript memory, copy
  // it before every rebuild, and clear it immediately after the control session succeeds.
  output = output.replace(
    "let latest={status:'IDLE',active:false};let ticking=false;let lastTickAt=0;let errorText='';",
    "let latest={status:'IDLE',active:false};let ticking=false;let lastTickAt=0;let errorText='';let pinDraft='';",
  );
  output = output.replace(
    'type="password" autocomplete="one-time-code" placeholder="Not stored in browser"',
    'type="password" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="Not stored in browser"',
  );
  output = output.replace(
    "    document.getElementById('sim-speed')?.addEventListener('change',event=>{draft.speedMultiplier=Number(event.target.value||60);});",
    "    document.getElementById('sim-speed')?.addEventListener('change',event=>{draft.speedMultiplier=Number(event.target.value||60);});\n    const pinNode=document.getElementById('sim-pin');\n    if(pinNode){pinNode.value=pinDraft;const rememberPin=()=>{pinDraft=pinNode.value||'';};pinNode.addEventListener('input',rememberPin);pinNode.addEventListener('change',rememberPin);pinNode.addEventListener('blur',rememberPin);}",
  );
  output = output.replace(
    "  function render(){\n    syncDraftFromRun();ensureBanner();",
    "  function render(){\n    const currentPin=document.getElementById('sim-pin');if(currentPin)pinDraft=currentPin.value;\n    syncDraftFromRun();ensureBanner();",
  );
  output = output.replace(
    "const pinNode=document.getElementById('sim-pin');if(pinNode)pinNode.value='';",
    "pinDraft='';const pinNode=document.getElementById('sim-pin');if(pinNode)pinNode.value='';",
  );

  return new Response(output, {
    status: response.status,
    statusText: response.statusText,
    headers: copyHeaders(response.headers),
  });
}
