import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SimulationDriver,
  compactSimulationState,
  stabilizeSimulationDashboardHtml,
} from '../src/simulation/simulation-server-runtime.js';

function storageMock() {
  const values = new Map();
  let alarm = null;
  return {
    values,
    async get(key) { return values.get(key); },
    async put(input, value) {
      if (input && typeof input === 'object') {
        for (const [key, item] of Object.entries(input)) values.set(key, item);
      } else values.set(input, value);
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    async setAlarm(value) { alarm = value; },
    async getAlarm() { return alarm; },
    async deleteAlarm() { alarm = null; },
  };
}

test('status compaction removes duplicated heavy arrays while preserving dashboard fields', () => {
  const compacted = compactSimulationState({
    status: 'RUNNING',
    active: true,
    opportunities: Array.from({ length: 200 }, (_, id) => ({ id })),
    activeTrades: Array.from({ length: 30 }, (_, id) => ({ id })),
    completedTrades: Array.from({ length: 150 }, (_, id) => ({ id })),
    timeline: Array.from({ length: 100 }, (_, id) => ({ id })),
    liveScanner: {
      rows: Array.from({ length: 30 }, (_, id) => ({ id })),
      opportunities: Array.from({ length: 200 }, (_, id) => ({ id })),
    },
    report: { byStrategy: {}, trades: Array.from({ length: 200 }, (_, id) => ({ id })) },
  });
  assert.equal(compacted.opportunities.length, 0);
  assert.equal(compacted.activeTrades.length, 20);
  assert.equal(compacted.completedTrades.length, 100);
  assert.equal(compacted.timeline.length, 60);
  assert.equal(compacted.liveScanner.rows.length, 20);
  assert.equal(compacted.liveScanner.opportunities.length, 0);
  assert.equal(compacted.report.trades.length, 0);
  assert.equal(compacted.serverDriven, true);
  assert.equal(compacted.tickSource, 'DURABLE_OBJECT_ALARM');
});

test('dashboard stabilization removes browser ticking and makes scanner decoration idempotent', () => {
  const html = `<script>
  function decorateLiveScanner(){if(!latest.active)return;const table=document.querySelector('#dashboard-live-scanner table');if(!table)return;const head=table.querySelector('thead tr');if(head&&!head.querySelector('.dls-sim-heading')){const th=document.createElement('th');th.className='dls-sim-heading';th.textContent='STRATEGY';head.children[1]?.after(th);}const sourceRows=latest.liveScanner?.rows||[];[...table.querySelectorAll('tbody tr')].forEach((row,index)=>{row.querySelector('.dls-sim-strategy')?.remove();const td=document.createElement('td');td.className='dls-sim-strategy';td.innerHTML=sourceRows[index]?badge(sourceRows[index].sourceStrategy):badge('SIMULATION');row.children[1]?.after(td);});}

  ensureBanner();ensurePanel();refresh();setInterval(refresh,3000);setInterval(maybeTick,500);const observer=new MutationObserver(()=>decorateLiveScanner());observer.observe(document.documentElement,{subtree:true,childList:true});
</script>`;
  const patched = stabilizeSimulationDashboardHtml(html);
  assert.equal(patched.includes('setInterval(maybeTick,500)'), false);
  assert.equal(patched.includes("row.querySelector('.dls-sim-strategy')?.remove()"), false);
  assert.match(patched, /let td=row\.querySelector/);
  assert.match(patched, /requestAnimationFrame/);
  assert.match(patched, /setInterval\(refresh,5000\)/);
});

test('Durable Object driver advances and then disarms a simulation without a browser', async () => {
  const storage = storageMock();
  let tickCalls = 0;
  let state = { active: true, runId: 'run-1', tickIntervalMs: 1000 };
  const coordinator = {
    async historicalSimulationStatus() { return state; },
    async tickHistoricalSimulation() {
      tickCalls += 1;
      state = { ...state, cursor: tickCalls, active: tickCalls < 2 };
      return state;
    },
  };
  const driver = new SimulationDriver(
    { storage },
    { ALERT_COORDINATOR: { getByName: () => coordinator } },
  );

  const armed = await driver.arm(1000);
  assert.equal(armed.armed, true);
  storage.values.set('nextDueAt', 0);
  await driver.alarm();
  assert.equal(tickCalls, 1);
  assert.ok(await storage.getAlarm());

  storage.values.set('nextDueAt', 0);
  const completed = await driver.alarm();
  assert.equal(tickCalls, 2);
  assert.equal(completed.armed, false);
  assert.equal(await storage.getAlarm(), null);
});
