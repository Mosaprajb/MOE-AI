import assert from 'node:assert/strict';
import test from 'node:test';

import { enhanceSimulationStrategyDashboard } from '../src/simulation/simulation-dashboard-v2.js';

const DASHBOARD_FIXTURE = `<!doctype html>
<html>
<body>
<script id="moeSimulationScript">
(function(){
  let latest={status:'IDLE',active:false};let ticking=false;let lastTickAt=0;let errorText='';
  const draft={strategies:new Set(['FUSION_V2','MOERAND_SIMPLE_INTERNAL']),range:'LAST_SESSION',speedMultiplier:60};

  function bindDraftControls(){
    document.getElementById('sim-speed')?.addEventListener('change',event=>{draft.speedMultiplier=Number(event.target.value||60);});
  }

  function render(){
    syncDraftFromRun();ensureBanner();
  }

  const markup='<input class="sim-pin" id="sim-pin" type="password" autocomplete="one-time-code" placeholder="Not stored in browser">';
  async function start(){
    const pin=document.getElementById('sim-pin')?.value||'';
    await jsonRequest('/session',{method:'POST',body:JSON.stringify({pin})});
    const pinNode=document.getElementById('sim-pin');if(pinNode)pinNode.value='';
  }
})();
</script>
</body>
</html>`;

test('iPhone keyboard dismissal and scrolling preserve the PIN only in page memory until session acceptance', async () => {
  const response = new Response(DASHBOARD_FIXTURE, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const enhanced = await enhanceSimulationStrategyDashboard(response);
  const html = await enhanced.text();

  assert.match(html, /let pinDraft='';/);
  assert.match(html, /const currentPin=document\.getElementById\('sim-pin'\);if\(currentPin\)pinDraft=currentPin\.value;/);
  assert.match(html, /pinNode\.value=pinDraft/);
  assert.match(html, /addEventListener\('input',rememberPin\)/);
  assert.match(html, /addEventListener\('blur',rememberPin\)/);
  assert.match(html, /pinDraft='';const pinNode=document\.getElementById\('sim-pin'\)/);
  assert.match(html, /autocomplete="off"/);
  assert.match(html, /enterkeyhint="done"/);
  assert.match(html, /autocapitalize="none"/);
  assert.equal(html.includes('localStorage'), false);
  assert.equal(html.includes('sessionStorage'), false);
});
