const MIN_TICK_INTERVAL_MS = 1_000;
const MAX_TICK_INTERVAL_MS = 60_000;
const STATUS_ACTIVE_TRADE_LIMIT = 20;
const STATUS_COMPLETED_TRADE_LIMIT = 100;
const STATUS_TIMELINE_LIMIT = 60;
const STATUS_SCANNER_ROW_LIMIT = 20;

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
}

export function simulationTickInterval(simulation = {}, override) {
  return boundedInteger(
    override ?? simulation.tickIntervalMs,
    5_000,
    MIN_TICK_INTERVAL_MS,
    MAX_TICK_INTERVAL_MS,
  );
}

export function compactSimulationLiveScanner(liveScanner) {
  if (!liveScanner || typeof liveScanner !== 'object') return liveScanner;
  return {
    ...liveScanner,
    rows: Array.isArray(liveScanner.rows)
      ? liveScanner.rows.slice(0, STATUS_SCANNER_ROW_LIMIT)
      : [],
    opportunities: [],
    serverDriven: true,
  };
}

export function compactSimulationState(simulation) {
  if (!simulation || typeof simulation !== 'object') return simulation;
  const report = simulation.report && typeof simulation.report === 'object'
    ? { ...simulation.report, trades: [] }
    : simulation.report;
  return {
    ...simulation,
    opportunities: [],
    activeTrades: Array.isArray(simulation.activeTrades)
      ? simulation.activeTrades.slice(0, STATUS_ACTIVE_TRADE_LIMIT)
      : [],
    completedTrades: Array.isArray(simulation.completedTrades)
      ? simulation.completedTrades.slice(-STATUS_COMPLETED_TRADE_LIMIT)
      : [],
    timeline: Array.isArray(simulation.timeline)
      ? simulation.timeline.slice(0, STATUS_TIMELINE_LIMIT)
      : [],
    liveScanner: compactSimulationLiveScanner(simulation.liveScanner),
    report,
    serverDriven: true,
    tickSource: 'DURABLE_OBJECT_ALARM',
  };
}

const SAFE_DECORATE = `function decorateLiveScanner(){if(!latest.active)return;const table=document.querySelector('#dashboard-live-scanner table');if(!table)return;const head=table.querySelector('thead tr');if(head&&!head.querySelector('.dls-sim-heading')){const th=document.createElement('th');th.className='dls-sim-heading';th.textContent='STRATEGY';head.children[1]?.after(th);}const sourceRows=latest.liveScanner?.rows||[];[...table.querySelectorAll('tbody tr')].forEach((row,index)=>{let td=row.querySelector('.dls-sim-strategy');if(!td){td=document.createElement('td');td.className='dls-sim-strategy';row.children[1]?.after(td);}const next=sourceRows[index]?badge(sourceRows[index].sourceStrategy):badge('SIMULATION');if(td.innerHTML!==next)td.innerHTML=next;});}`;
const SAFE_BOOTSTRAP = `ensureBanner();ensurePanel();refresh();setInterval(refresh,5000);let decorateQueued=false;const observer=new MutationObserver(()=>{if(decorateQueued)return;decorateQueued=true;requestAnimationFrame(()=>{decorateQueued=false;decorateLiveScanner();});});observer.observe(document.documentElement,{subtree:true,childList:true});`;

export function stabilizeSimulationDashboardHtml(html) {
  const source = String(html || '');
  return source
    .replace(
      /function decorateLiveScanner\(\)\{.*?\}\n\n  ensureBanner\(\)/s,
      `${SAFE_DECORATE}\n\n  ensureBanner()`,
    )
    .replace(
      "ensureBanner();ensurePanel();refresh();setInterval(refresh,3000);setInterval(maybeTick,500);const observer=new MutationObserver(()=>decorateLiveScanner());observer.observe(document.documentElement,{subtree:true,childList:true});",
      SAFE_BOOTSTRAP,
    );
}

export async function stabilizeSimulationDashboardResponse(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = stabilizeSimulationDashboardHtml(await response.text());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  headers.set('x-moe-simulation-ui', 'stabilized');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export class SimulationDriver {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  coordinator() {
    return this.env.ALERT_COORDINATOR.getByName('global');
  }

  async schedule(simulation, override) {
    const intervalMs = simulationTickInterval(simulation, override);
    const dueAt = Date.now() + intervalMs;
    await this.ctx.storage.put({
      runId: simulation.runId || null,
      nextDueAt: dueAt,
      intervalMs,
      armed: true,
    });
    await this.ctx.storage.setAlarm(dueAt);
    return {
      ok: true,
      armed: true,
      runId: simulation.runId || null,
      dueAt,
      intervalMs,
    };
  }

  async arm(override) {
    const simulation = await this.coordinator().historicalSimulationStatus();
    if (!simulation?.active) return this.disarm('SIMULATION_NOT_ACTIVE');
    return this.schedule(simulation, override);
  }

  async ensureArmed() {
    const simulation = await this.coordinator().historicalSimulationStatus();
    if (!simulation?.active) return this.disarm('SIMULATION_NOT_ACTIVE');
    const existingAlarm = await this.ctx.storage.getAlarm();
    if (existingAlarm) {
      return {
        ok: true,
        armed: true,
        alreadyArmed: true,
        runId: simulation.runId || null,
        dueAt: existingAlarm,
      };
    }
    return this.schedule(simulation);
  }

  async disarm(reason = 'SIMULATION_STOPPED') {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.delete(['runId', 'nextDueAt', 'intervalMs', 'armed']);
    return { ok: true, armed: false, reason };
  }

  async alarm() {
    const dueAt = Number(await this.ctx.storage.get('nextDueAt') || 0);
    if (dueAt > Date.now() + 250) {
      await this.ctx.storage.setAlarm(dueAt);
      return { ok: true, skipped: 'ALARM_FIRED_EARLY', dueAt };
    }

    const coordinator = this.coordinator();
    const before = await coordinator.historicalSimulationStatus();
    if (!before?.active) return this.disarm('SIMULATION_NOT_ACTIVE');

    const simulation = await coordinator.tickHistoricalSimulation();
    if (!simulation?.active) return this.disarm('SIMULATION_COMPLETED');
    return this.schedule(simulation);
  }
}
