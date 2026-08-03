// Generated from moe-mobile.html. Keep both files synchronized.
export const MOBILE_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="MOE">
<title>MOE Control</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=IBM+Plex+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<style>
/* ============================================================
   MOE Control — mobile trading console
   Signature: the instrument changes temperature by account mode.
   PAPER = cold cyan (rehearsal).  LIVE = hot amber (real money).
   ============================================================ */
:root{
  --ink:#0B0F14; --panel:#131A22; --panel-2:#1B242E; --line:#2A3642;
  --text:#EDF2F7; --muted:#8A9BAB;
  --green:#4ADE80; --red:#E5484D; --amber:#FFB020;
  --accent:#3DD6D0; --accent-dim:#1B4F55; --accent-ink:#04211F;
}
[data-mode="LIVE"]{ --accent:#FFB020; --accent-dim:#5A3B08; --accent-ink:#241601; }
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0;background:var(--ink);color:var(--text)}
body{
  font-family:'Archivo',system-ui,-apple-system,sans-serif;font-size:18px;line-height:1.45;
  padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
  -webkit-font-smoothing:antialiased;overscroll-behavior-y:none;
}
.mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:520px;margin:0 auto;padding:0 18px 150px}

/* ---------- lock screen ---------- */
#lock{position:fixed;inset:0;z-index:900;background:var(--ink);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;padding:32px}
#lock[hidden]{display:none}
.lock-brand{font-size:44px;font-weight:900;letter-spacing:-.03em}
.lock-brand span{color:var(--accent)}
.lock-hint{color:var(--muted);font-size:17px;text-align:center;margin:-14px 0 0}
.dots{display:flex;gap:16px}
.dot{width:19px;height:19px;border-radius:50%;border:2px solid var(--line);transition:.15s}
.dot[data-on="true"]{background:var(--accent);border-color:var(--accent)}
.pad{display:grid;grid-template-columns:repeat(3,86px);gap:18px;justify-content:center}
.key{height:86px;border-radius:50%;border:1.5px solid var(--line);background:var(--panel-2);color:var(--text);font-family:'IBM Plex Mono',monospace;font-size:32px;font-weight:600;cursor:pointer}
.key:active{background:var(--accent-dim);border-color:var(--accent)}
.key.blank{border:none;background:none;cursor:default}
.key.fn{font-family:'Archivo',sans-serif;font-size:16px;font-weight:700;color:var(--muted)}
.lock-err{color:var(--red);font-size:16px;min-height:24px;text-align:center}

/* ---------- header ---------- */
header.top{position:sticky;top:0;z-index:40;background:linear-gradient(180deg,var(--ink) 72%,transparent);padding:14px 0 12px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.brand{font-weight:900;font-size:24px;letter-spacing:-.02em}
.brand span{color:var(--accent)}
.hdr-right{display:flex;align-items:center;gap:9px}
.modeflag{font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;padding:8px 14px;border-radius:999px;border:1.5px solid var(--accent);color:var(--accent);background:var(--accent-dim);letter-spacing:.08em}
.lockbtn{all:unset;width:38px;height:38px;border-radius:50%;background:var(--panel-2);border:1.5px solid var(--line);display:grid;place-items:center;font-size:17px;cursor:pointer}

/* ---------- cards ---------- */
.card{background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:20px;margin-bottom:16px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}
.card-title{font-size:15px;font-weight:700;letter-spacing:.12em;color:var(--muted);text-transform:uppercase}
.info{flex:none;width:34px;height:34px;border-radius:50%;border:1.5px solid var(--line);background:var(--panel-2);color:var(--muted);font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:700;cursor:pointer;display:grid;place-items:center}
.info:active{background:var(--accent-dim);color:var(--accent);border-color:var(--accent)}

/* ---------- account slabs ---------- */
.slabbtn{appearance:none;border:2px solid var(--line);background:var(--panel-2);color:var(--muted);border-radius:18px;padding:20px 12px;font-family:'Archivo',sans-serif;font-size:19px;font-weight:900;letter-spacing:-.01em;cursor:pointer;text-align:center;line-height:1.2}
.slabbtn small{display:block;font-size:12px;font-weight:500;letter-spacing:.06em;margin-top:6px;opacity:.75}
.slabbtn[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}

/* ---------- live position ---------- */
.pos{background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:20px;margin-bottom:14px}
.pos-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:4px}
.pos-sym{font-family:'IBM Plex Mono',monospace;font-size:30px;font-weight:700;letter-spacing:-.01em}
.pos-pnl{font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:700}
.pos-sub{display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:14px;color:var(--muted);margin-bottom:20px}
.track{position:relative;height:16px;border-radius:99px;background:var(--panel-2);border:1px solid var(--line);overflow:hidden}
.track-fill{position:absolute;inset:0 auto 0 0;border-radius:99px;transition:width .5s ease,background-color .5s ease}
.track-entry{position:absolute;top:-5px;bottom:-5px;width:2px;background:var(--muted);opacity:.9}
.track-mark{position:absolute;top:50%;width:26px;height:26px;border-radius:50%;transform:translate(-50%,-50%);border:4px solid var(--panel);transition:left .5s ease,background-color .5s ease;box-shadow:0 0 0 1px var(--line)}
.track-legend{display:flex;justify-content:space-between;margin-top:11px;font-family:'IBM Plex Mono',monospace;font-size:13px}
.lg{display:flex;flex-direction:column;gap:2px}
.lg-k{font-size:10px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase}
.lg.mid{align-items:center}.lg.end{align-items:flex-end}
.pos-foot{display:flex;justify-content:space-between;gap:10px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line);font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--muted)}
.tag{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;border:1.5px solid var(--green);color:var(--green);background:#0E2A18}

/* ---------- session clock ---------- */
.clock{display:flex;align-items:center;justify-content:space-between;gap:14px}
.clock-name{font-size:24px;font-weight:900;letter-spacing:-.01em}
.clock-sub{font-size:14px;color:var(--muted);margin-top:2px}
.clock-time{font-family:'IBM Plex Mono',monospace;font-size:30px;font-weight:700;color:var(--accent);letter-spacing:-.02em}
.clock-lbl{font-size:10px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;text-align:right;margin-top:3px}

/* ---------- checkbox rows ---------- */
.check{display:flex;align-items:center;gap:15px;padding:17px;border-radius:15px;background:var(--panel-2);border:1.5px solid var(--line);cursor:pointer;margin-bottom:10px}
.check[data-on="true"]{border-color:var(--accent);background:var(--accent-dim)}
.box{flex:none;width:30px;height:30px;border-radius:9px;border:2px solid var(--line);display:grid;place-items:center;font-size:18px;color:transparent}
.check[data-on="true"] .box{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.check-txt{flex:1}
.check-n{font-size:18px;font-weight:700;display:block}
.check-d{font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--muted);margin-top:2px;display:block}

/* ---------- form ---------- */
label.fld{display:block;font-size:13px;font-weight:700;letter-spacing:.1em;color:var(--muted);text-transform:uppercase;margin-bottom:9px}
select.big,input.big{width:100%;padding:18px 16px;border-radius:16px;border:1.5px solid var(--line);background:var(--panel-2);color:var(--text);font-family:'Archivo',sans-serif;font-size:19px;font-weight:700;outline:none;appearance:none}
select.big{background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' fill='none' stroke='%238A9BAB' stroke-width='2.5'><path d='M5 8l6 6 6-6'/></svg>");background-repeat:no-repeat;background-position:right 16px center;padding-right:52px}
input.big:focus,select.big:focus{border-color:var(--accent)}
input.big::placeholder{color:#5C6C7A}

/* ---------- sliders ---------- */
.alloc + .alloc{margin-top:22px}
.alloc-top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px}
.alloc-name{font-size:17px;font-weight:700}
.alloc-val{font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:700;color:var(--accent)}
.alloc-sub{font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--muted);margin-bottom:12px}
input[type=range]{-webkit-appearance:none;width:100%;height:44px;background:transparent;margin:0}
input[type=range]::-webkit-slider-runnable-track{height:10px;border-radius:99px;background:var(--panel-2);border:1px solid var(--line)}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:34px;height:34px;border-radius:50%;background:var(--accent);border:4px solid var(--ink);margin-top:-13px}
input[type=range]:disabled::-webkit-slider-thumb{background:var(--muted)}

/* ---------- chips ---------- */
.chips{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px;min-height:10px}
.chip{font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:700;padding:11px 14px;border-radius:13px;background:var(--accent-dim);color:var(--accent);border:1.5px solid var(--accent);display:flex;align-items:center;gap:10px}
.chip button{all:unset;cursor:pointer;font-size:19px;line-height:1;opacity:.7;padding:0 2px}
.empty{color:var(--muted);font-size:16px;padding:14px 0;line-height:1.5}

/* ---------- buttons ---------- */
.btn{width:100%;padding:19px;border-radius:16px;border:1.5px solid var(--line);background:var(--panel-2);color:var(--text);font-family:'Archivo',sans-serif;font-size:18px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left}
.btn:active{background:var(--line)}
.btn .arrow{color:var(--muted);font-size:22px}
.btn.ghost{background:transparent}
.btn.mid{justify-content:center}
.btn.go{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn.stop{background:var(--red);color:#fff;border-color:var(--red)}
.btn:disabled{opacity:.4}
.stack>*+*{margin-top:11px}
.startbar{position:fixed;left:0;right:0;bottom:0;z-index:50;padding:14px 18px calc(14px + env(safe-area-inset-bottom));background:linear-gradient(0deg,var(--ink) 74%,transparent)}
.start{max-width:484px;margin:0 auto;width:100%;padding:23px;border-radius:20px;border:none;cursor:pointer;background:var(--accent);color:var(--accent-ink);font-family:'Archivo',sans-serif;font-size:23px;font-weight:900;letter-spacing:-.01em}
.start[data-running="true"]{background:var(--red);color:#fff}
.start:disabled{opacity:.4}

/* ---------- status ---------- */
.status{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.status div{background:var(--panel);padding:16px}
.status dt{font-size:12px;letter-spacing:.1em;color:var(--muted);text-transform:uppercase;margin:0 0 5px}
.status dd{margin:0;font-family:'IBM Plex Mono',monospace;font-size:19px;font-weight:700}
.ok{color:var(--green)}.warn{color:var(--amber)}.bad{color:var(--red)}.off{color:var(--muted)}
.meter{margin-top:16px}
.meter+.meter{margin-top:13px}
.meter-top{display:flex;justify-content:space-between;font-size:14px;margin-bottom:7px}
.meter-top b{font-family:'IBM Plex Mono',monospace;font-weight:700}
.meter-bar{height:9px;border-radius:99px;background:var(--panel-2);border:1px solid var(--line);overflow:hidden}
.meter-fill{height:100%;border-radius:99px;transition:width .4s,background-color .4s}

/* ---------- sheets ---------- */
.sheet{position:fixed;inset:0;z-index:100;background:var(--ink);transform:translateY(100%);transition:transform .34s cubic-bezier(.32,.72,0,1);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:env(safe-area-inset-top) 0 calc(40px + env(safe-area-inset-bottom))}
.sheet[data-open="true"]{transform:translateY(0)}
.sheet-head{position:sticky;top:0;background:var(--ink);z-index:5;padding:16px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:14px}
.sheet-head h2{margin:0;font-size:23px;font-weight:900;letter-spacing:-.02em;flex:1}
.close{all:unset;width:44px;height:44px;border-radius:50%;background:var(--panel-2);border:1.5px solid var(--line);display:grid;place-items:center;font-size:24px;color:var(--muted);cursor:pointer;flex:none}
.sheet-body{padding:20px 18px}
.sheet-body p{font-size:17px;line-height:1.6;color:#C8D4DF}
.sheet-body p strong{color:var(--text)}

/* ---------- trade rows ---------- */
.row{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:11px}
.row-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.sym{font-family:'IBM Plex Mono',monospace;font-size:22px;font-weight:700}
.pill{font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;padding:6px 11px;border-radius:999px;border:1.5px solid}
.pill.win{color:var(--green);border-color:var(--green);background:#0E2A18}
.pill.loss{color:var(--red);border-color:var(--red);background:#2A0E10}
.pill.open{color:var(--accent);border-color:var(--accent);background:var(--accent-dim)}
.row-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.row-grid dt{font-size:11px;letter-spacing:.1em;color:var(--muted);text-transform:uppercase;margin:0 0 3px}
.row-grid dd{margin:0;font-family:'IBM Plex Mono',monospace;font-size:17px;font-weight:600}

/* ---------- strategy ranking ---------- */
.rank{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:18px;margin-bottom:12px}
.rank[data-best="true"]{border-color:var(--green)}
.rank-top{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.rank-no{font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:700;color:var(--muted);width:26px}
.rank-name{flex:1;font-size:19px;font-weight:700}
.rank-badge{font-size:11px;font-weight:700;letter-spacing:.1em;padding:5px 10px;border-radius:999px;background:#0E2A18;color:var(--green);border:1.5px solid var(--green)}
.rank-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.rank-grid dt{font-size:10px;letter-spacing:.09em;color:var(--muted);text-transform:uppercase;margin:0 0 3px}
.rank-grid dd{margin:0;font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:700}
.spark{display:flex;align-items:flex-end;gap:3px;height:38px}
.spark i{flex:1;border-radius:2px;min-height:3px}

/* ---------- misc ---------- */
.spec{border-top:1px solid var(--line);padding:15px 0;display:flex;justify-content:space-between;gap:16px}
.spec-k{color:var(--muted);font-size:16px}
.spec-v{font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:600;text-align:right}
.rule{padding:15px;border-radius:14px;background:var(--panel-2);border-left:4px solid var(--accent);margin-bottom:10px;font-size:16px;line-height:1.5}
.note{font-size:15px;color:var(--muted);line-height:1.55;margin-top:14px}
.danger-note{border:1.5px solid var(--red);background:#2A0E10;color:#FFC9CB;padding:15px;border-radius:14px;font-size:16px;line-height:1.5;margin-top:14px}
.log{font-family:'IBM Plex Mono',monospace;font-size:13px;line-height:1.7;color:var(--muted);border-left:2px solid var(--line);padding-left:14px}
.log b{color:var(--text);font-weight:600}
@media (prefers-reduced-motion:reduce){.sheet,.track-fill,.track-mark,.meter-fill{transition:none}}
</style>
</head>
<body data-mode="PAPER">

<!-- ══════════ LOCK ══════════ -->
<div id="lock">
  <div class="lock-brand">MOE<span>.</span></div>
  <p class="lock-hint">Enter your passcode</p>
  <div class="dots" id="dots"><i class="dot"></i><i class="dot"></i><i class="dot"></i><i class="dot"></i><i class="dot"></i><i class="dot"></i></div>
  <div class="lock-err" id="lockErr"></div>
  <div class="pad" id="pad">
    <button class="key">1</button><button class="key">2</button><button class="key">3</button>
    <button class="key">4</button><button class="key">5</button><button class="key">6</button>
    <button class="key">7</button><button class="key">8</button><button class="key">9</button>
    <button class="key blank"></button><button class="key">0</button><button class="key fn" data-del>Delete</button>
  </div>
</div>

<div class="wrap">

  <header class="top">
    <div class="brand">MOE<span>.</span></div>
    <div class="hdr-right">
      <div class="modeflag" id="modeFlag">PAPER</div>
      <button class="lockbtn" id="lockNow" aria-label="Lock">🔒</button>
    </div>
  </header>



  <!-- MARKET CLOCK -->
  <section class="card">
    <div class="card-head">
      <div class="card-title">Market</div>
      <button class="info" data-info="session" aria-label="About the market clock">i</button>
    </div>
    <div class="clock">
      <div>
        <div class="clock-name" id="sessName">Closed</div>
        <div class="clock-sub" id="sessSub">Waiting for the next session</div>
      </div>
      <div>
        <div class="clock-time mono" id="sessTime">—</div>
        <div class="clock-lbl" id="sessLbl">until open</div>
      </div>
    </div>
  </section>

  <!-- OPEN POSITIONS -->
  <section>
    <div class="card-head" style="padding:0 4px">
      <div class="card-title">Open now</div>
      <button class="info" data-info="position" aria-label="About the position bar">i</button>
    </div>
    <div id="posList"></div>
  </section>

  <!-- ACCOUNT -->
  <section class="card">
    <div class="card-head">
      <div class="card-title">Account</div>
      <button class="info" data-info="mode" aria-label="About account modes">i</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <button class="slabbtn" id="btnPaper" aria-pressed="true">Paper Trading<small>Practice money</small></button>
      <button class="slabbtn" id="btnLive" aria-pressed="false">Live Trading<small>Real money</small></button>
    </div>
  </section>

  <!-- TRADE SETTINGS -->
  <section class="card">
    <div class="card-head">
      <div class="card-title">Trade settings</div>
      <button class="info" data-info="settings" aria-label="About trade settings">i</button>
    </div>
    <dl class="status">
      <div><dt>Cash used</dt><dd class="mono" id="sumCash">25%</dd></div>
      <div><dt>Margin used</dt><dd class="mono" id="sumMargin">0%</dd></div>
      <div><dt>Take profit</dt><dd class="mono" id="sumTp">2.0R</dd></div>
      <div><dt>Stop loss</dt><dd class="mono" id="sumSl">1%</dd></div>
      <div><dt>Max trades / day</dt><dd class="mono" id="sumMax">3</dd></div>
      <div><dt>Daily loss cap</dt><dd class="mono" id="sumCap">2.0%</dd></div>
    </dl>
    <div class="stack" style="margin-top:12px">
      <button class="btn" id="openSettings"><span>Change trade settings</span><span class="arrow">›</span></button>
      <button class="btn ghost" id="openSessions"><span>Sessions allowed</span><span class="arrow" id="sessCount">›</span></button>
    </div>
  </section>

  <!-- STRATEGY -->
  <section class="card">
    <div class="card-head">
      <div class="card-title">Strategy</div>
      <button class="info" data-info="strategy" aria-label="About strategies">i</button>
    </div>
    <select class="big" id="strategySelect">
      <option value="MOERAND_CLEAN_INTERNAL">MOERAND Clean</option>
      <option value="MOERAND_SIMPLE_INTERNAL">MOERAND Simple</option>
      <option value="MOERAND_SCALP_INTERNAL">MOERAND Scalp</option>
      <option value="FUSION_V2">Fusion V2</option>
    </select>
    <div class="stack" style="margin-top:11px">
      <button class="btn ghost" id="openStrategy"><span>How this strategy trades</span><span class="arrow">›</span></button>
      <button class="btn ghost" id="openCompare"><span>Compare all strategies</span><span class="arrow">›</span></button>
    </div>
  </section>

  <!-- SYMBOLS -->
  <section class="card">
    <div class="card-head">
      <div class="card-title">Symbols to watch</div>
      <button class="info" data-info="symbols" aria-label="About symbols">i</button>
    </div>
    <label class="fld" for="symInput">Add a ticker</label>
    <input class="big mono" id="symInput" placeholder="NVDA" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done">
    <div class="chips" id="chips"></div>
    <div class="stack" style="margin-top:14px">
      <button class="btn ghost" id="openSymbols"><span>Manage full list</span><span class="arrow">›</span></button>
    </div>
  </section>

  <!-- STATUS -->
  <section class="card">
    <div class="card-head">
      <div class="card-title">Status</div>
      <button class="info" data-info="status" aria-label="About status">i</button>
    </div>
    <dl class="status">
      <div><dt>Engine</dt><dd class="off" id="stEngine">Stopped</dd></div>
      <div><dt>Broker</dt><dd class="off" id="stBroker">Checking</dd></div>
      <div><dt>Open trades</dt><dd id="stOpen">0</dd></div>
      <div><dt>Day result</dt><dd id="stPnl">—</dd></div>
    </dl>
    <div class="meter">
      <div class="meter-top"><span>Trades used today</span><b id="mTradesTxt">0 / 3</b></div>
      <div class="meter-bar"><i class="meter-fill" id="mTrades" style="width:0%;background:var(--accent)"></i></div>
    </div>
    <div class="meter">
      <div class="meter-top"><span>Daily loss budget</span><b id="mLossTxt">0% / 2.0%</b></div>
      <div class="meter-bar"><i class="meter-fill" id="mLoss" style="width:0%;background:var(--green)"></i></div>
    </div>
    <div class="stack" style="margin-top:16px">
      <button class="btn" id="openScanner"><span>Scanner &amp; trade history</span><span class="arrow">›</span></button>
      <button class="btn ghost" id="openActivity"><span>Activity log</span><span class="arrow">›</span></button>
      <button class="btn stop mid" id="panicBtn">Close everything now</button>
    </div>
  </section>

</div>

<div class="startbar">
  <button class="start" id="startBtn" data-running="false">Start trading</button>
</div>

<!-- ══════════ SHEETS ══════════ -->

<section class="sheet" id="sheetSettings" aria-hidden="true">
  <div class="sheet-head"><button class="close" data-close>✕</button><h2>Trade settings</h2><button class="info" data-info="settings">i</button></div>
  <div class="sheet-body">
    <div class="card-title" style="margin-bottom:16px">Capital to trade</div>
    <div class="alloc">
      <div class="alloc-top"><div class="alloc-name">Cash account</div><div class="alloc-val mono" id="cashPct">25%</div></div>
      <div class="alloc-sub" id="cashAmt">— of —</div>
      <input type="range" id="cashRange" min="0" max="100" step="5" value="25">
    </div>
    <div class="alloc">
      <div class="alloc-top"><div class="alloc-name">Margin account</div><div class="alloc-val mono" id="marginPct">0%</div></div>
      <div class="alloc-sub" id="marginAmt">— of —</div>
      <input type="range" id="marginRange" min="0" max="100" step="5" value="0">
    </div>
    <div class="danger-note">Margin positions are always closed before the session ends. Nothing is held overnight.</div>

    <div class="card-title" style="margin:34px 0 16px">Exit each trade</div>
    <div class="alloc">
      <div class="alloc-top"><div class="alloc-name">Take profit</div><div class="alloc-val mono" id="tpVal">2.0R</div></div>
      <div class="alloc-sub" id="tpNote">Closes at twice what the trade risked</div>
      <input type="range" id="tpRange" min="0.5" max="5" step="0.5" value="2">
    </div>
    <div class="alloc">
      <div class="alloc-top"><div class="alloc-name">Stop loss</div><div class="alloc-val mono" id="slVal">1%</div></div>
      <div class="alloc-sub" id="slNote">Most you can lose on one trade</div>
      <input type="range" id="slRange" min="0.25" max="5" step="0.25" value="1">
    </div>

    <div class="card-title" style="margin:34px 0 16px">Daily limits</div>
    <div class="alloc">
      <div class="alloc-top"><div class="alloc-name">Max trades per day</div><div class="alloc-val mono" id="maxVal">3</div></div>
      <div class="alloc-sub">No new trades open after this</div>
      <input type="range" id="maxRange" min="1" max="30" step="1" value="3">
    </div>
    <div class="alloc">
      <div class="alloc-top"><div class="alloc-name">Daily loss cap</div><div class="alloc-val mono" id="capVal">2.0%</div></div>
      <div class="alloc-sub" id="capNote">Trading halts for the day at this loss</div>
      <input type="range" id="capRange" min="0.5" max="10" step="0.5" value="2">
    </div>

    <div class="danger-note" id="riskMath">Worst realistic day: —</div>
    <button class="btn go mid" id="saveSettings" style="margin-top:22px">Save settings</button>
    <p class="note" id="saveNote">These apply to both paper and live trading, and can only be changed while the engine is stopped.</p>
  </div>
</section>

<section class="sheet" id="sheetSessions" aria-hidden="true">
  <div class="sheet-head"><button class="close" data-close>✕</button><h2>Sessions allowed</h2><button class="info" data-info="sessions">i</button></div>
  <div class="sheet-body">
    <p>Pick which parts of the trading day the engine may open new trades in. Open positions are always closed before the last allowed session ends.</p>
    <div id="sessionList" style="margin-top:22px"></div>
    <div class="danger-note" id="sessWarn" hidden></div>
    <button class="btn go mid" id="saveSessions" style="margin-top:22px">Save sessions</button>
  </div>
</section>

<section class="sheet" id="sheetScanner" aria-hidden="true">
  <div class="sheet-head"><button class="close" data-close>✕</button><h2>Scanner &amp; trades</h2><button class="info" data-info="scanner">i</button></div>
  <div class="sheet-body">
    <dl class="status" style="margin-bottom:18px">
      <div><dt>Scanned</dt><dd class="mono" id="scScanned">—</dd></div>
      <div><dt>Signals taken</dt><dd class="mono" id="scTaken">—</dd></div>
      <div><dt>Scan time</dt><dd class="mono" id="scLast">—</dd></div>
      <div><dt>Day result</dt><dd class="mono" id="scPnl">—</dd></div>
    </dl>
    <div class="card-title" style="margin-bottom:12px">Trades today</div>
    <div id="tradeList"><div class="empty">No trades yet. Trades appear here as they open and close.</div></div>
  </div>
</section>

<section class="sheet" id="sheetCompare" aria-hidden="true">
  <div class="sheet-head"><button class="close" data-close>✕</button><h2>Which strategy works</h2><button class="info" data-info="compare">i</button></div>
  <div class="sheet-body">
    <p>Ranked by expectancy — the average R won or lost per trade. It rewards a strategy for winning bigger than it loses, not just for winning often.</p>
    <div id="compareList" style="margin-top:22px"></div>
    <div id="compareVerdict"></div>
  </div>
</section>

<section class="sheet" id="sheetActivity" aria-hidden="true">
  <div class="sheet-head"><button class="close" data-close>✕</button><h2>Activity log</h2><button class="info" data-info="activity">i</button></div>
  <div class="sheet-body"><div id="activityList"><div class="empty">Nothing logged yet.</div></div></div>
</section>

<section class="sheet" id="sheetSymbols" aria-hidden="true">
  <div class="sheet-head"><button class="close" data-close>✕</button><h2>Symbols</h2><button class="info" data-info="symbols">i</button></div>
  <div class="sheet-body">
    <label class="fld" for="symInput2">Add a ticker</label>
    <input class="big mono" id="symInput2" placeholder="AAPL" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done">
    <div class="chips" id="chips2" style="margin-top:16px"></div>
    <p class="note">The scanner only looks at these symbols. It never picks stocks on its own. Add at least one before starting.</p>
  </div>
</section>

<section class="sheet" id="sheetStrategy" aria-hidden="true">
  <div class="sheet-head"><button class="close" data-close>✕</button><h2 id="stratTitle">Strategy</h2></div>
  <div class="sheet-body" id="stratBody"></div>
</section>

<section class="sheet" id="sheetInfo" aria-hidden="true">
  <div class="sheet-head"><button class="close" data-close>✕</button><h2 id="infoTitle">About</h2></div>
  <div class="sheet-body" id="infoBody"></div>
</section>

<script>
/* ============================================================
   API — every path below already exists in the Worker.
   ============================================================ */
const API = {
  health:'/api/health', config:'/api/config', mode:'/api/trading/mode',
  session:'/api/market/session', sessionPolicy:'/api/trading/session-policy',
  scanMode:'/api/scanner/source-mode', diagnostic:'/api/scanner/diagnostic',
  activity:'/api/scanner/live-activity', trades:'/api/trades',
  analytics:'/api/trades/analytics', portfolio:'/api/trading-intelligence/portfolio-risk',
  position:'/api/trading-intelligence/active-position', closeAll:'/api/trades/close'
};

const state = {
  mode:'PAPER', symbols:[], running:false, unlocked:false,
  equity:{cash:null,margin:null},
  cfg:{cashPct:25,marginPct:0,takeProfitR:2,stopLossPct:1,maxTrades:3,dailyLossPct:2},
  sessions:['REGULAR'],
  today:{trades:0,lossPct:0,pnl:0},
  positions:[], sessionEndsAt:null
};

const $ = id => document.getElementById(id);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
const money = n => n==null ? '—' : '$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
const money2 = n => (Number(n)<0?'−':'')+'$'+Math.abs(Number(n)).toFixed(2);

async function api(url,opts={}){
  const r = await fetch(url,{cache:'no-store',credentials:'same-origin',
    headers:{'content-type':'application/json','x-moe-mobile-client':'1',...(opts.headers||{})},...opts});
  const j = await r.json().catch(()=>({}));
  if(!r.ok || j.ok===false) throw new Error(j.error||j.code||('HTTP '+r.status));
  return j;
}

/* ============================================================
   PASSCODE LOCK
   Verified by the Worker — never stored in the browser.
   Auto-locks after 3 minutes idle and whenever the app is
   backgrounded, so an unlocked phone doesn't expose the account.
   ============================================================ */
let pin='';
const LOCK_MS = 3*60*1000;
let idleTimer;

function paintDots(){ document.querySelectorAll('#dots .dot').forEach((d,i)=> d.dataset.on = String(i < pin.length)); }
function lock(){
  state.unlocked=false; pin=''; paintDots();
  $('lockErr').textContent=''; $('lock').hidden=false; document.body.style.overflow='hidden';
}
function unlock(){
  state.unlocked=true; pin=''; paintDots();
  $('lock').hidden=true; document.body.style.overflow='';
  boot();
}
async function submitPin(){
  try{
    await api(API.mode,{method:'POST',body:JSON.stringify({action:'verifyPasscode',passcode:pin})});
    unlock();
  }catch(err){
    $('lockErr').textContent=err.message||'Invalid passcode';
    pin=''; paintDots();
    if(navigator.vibrate) navigator.vibrate(80);
  }
}
$('pad').addEventListener('click', e=>{
  const k=e.target.closest('.key'); if(!k||k.classList.contains('blank')) return;
  if(k.dataset.del!==undefined){ pin=pin.slice(0,-1); paintDots(); return; }
  if(pin.length>=6) return;
  pin += k.textContent.trim(); $('lockErr').textContent=''; paintDots();
  if(pin.length===6) submitPin();
});
$('lockNow').onclick = lock;
function resetIdle(){ clearTimeout(idleTimer); idleTimer=setTimeout(lock,LOCK_MS); }
['touchstart','click','keydown'].forEach(ev=> document.addEventListener(ev,()=>{ if(state.unlocked) resetIdle(); },{passive:true}));
document.addEventListener('visibilitychange',()=>{ if(document.hidden && state.unlocked) lock(); });

/* ============================================================
   MODE
   ============================================================ */
function setMode(m){
  state.mode=m; document.body.dataset.mode=m; $('modeFlag').textContent=m;
  $('btnPaper').setAttribute('aria-pressed', m==='PAPER');
  $('btnLive').setAttribute('aria-pressed', m==='LIVE');
  syncSettings();
}
$('btnPaper').onclick = ()=> setMode('PAPER');
$('btnLive').onclick  = ()=> openInfo('liveConfirm');

/* ============================================================
   OPEN POSITION BAR
   Stop ── Entry ──────── Target, marker at the live price.
   Colour runs red → amber → green by where price sits between
   stop and target, so a glance tells you which side you're on.
   ============================================================ */
function barColor(t){
  const stops=[[0,229,72,77],[0.5,255,176,32],[1,74,222,128]];
  t=clamp(t,0,1);
  let a=stops[0], b=stops[stops.length-1];
  for(let i=0;i<stops.length-1;i++){ if(t>=stops[i][0]&&t<=stops[i+1][0]){ a=stops[i]; b=stops[i+1]; break; } }
  const f=(t-a[0])/((b[0]-a[0])||1);
  const mix=i=>Math.round(a[i+1]+(b[i+1]-a[i+1])*f);
  return \`rgb(\${mix(0)},\${mix(1)},\${mix(2)})\`;
}
function renderPositions(){
  const list=state.positions;
  if(!list.length){
    $('posList').innerHTML=\`<div class="card"><div class="empty">No open position. When the engine takes a trade it appears here with its stop, target, and live progress.</div></div>\`;
    return;
  }
  $('posList').innerHTML=list.map(p=>{
    const stop=+p.stopPrice, tgt=+p.targetPrice, entry=+p.entryPrice, now=+p.currentPrice;
    if(![stop,tgt,entry,now].every(Number.isFinite)){
      return \`<div class="pos"><div class="pos-top"><span class="pos-sym">\${esc(p.symbol||'—')}</span></div><div class="empty">Waiting for price data on this position.</div></div>\`;
    }
    const span=(tgt-stop)||1;
    const t=clamp((now-stop)/span,0,1);
    const entryT=clamp((entry-stop)/span,0,1);
    const col=barColor(t);
    const qty=+p.quantity||0;
    const pnl=(now-entry)*qty;
    const r=(now-entry)/((entry-stop)||1);
    const beLocked=p.breakevenLocked || stop>=entry;
    return \`<div class="pos">
      <div class="pos-top">
        <span class="pos-sym">\${esc(p.symbol)}</span>
        <span class="pos-pnl" style="color:\${col}">\${pnl>=0?'+':''}\${money2(pnl)}</span>
      </div>
      <div class="pos-sub">
        <span>\${qty||'—'} sh @ \${entry.toFixed(2)}</span>
        <span>\${r>=0?'+':''}\${r.toFixed(2)}R</span>
      </div>
      <div class="track">
        <div class="track-fill" style="width:\${t*100}%;background:\${col};opacity:.28"></div>
        <div class="track-entry" style="left:\${entryT*100}%"></div>
        <div class="track-mark" style="left:\${t*100}%;background:\${col}"></div>
      </div>
      <div class="track-legend">
        <span class="lg"><span class="lg-k">Stop</span><b style="color:var(--red)">\${stop.toFixed(2)}</b></span>
        <span class="lg mid"><span class="lg-k">Now</span><b style="color:\${col}">\${now.toFixed(2)}</b></span>
        <span class="lg end"><span class="lg-k">Target</span><b style="color:var(--green)">\${tgt.toFixed(2)}</b></span>
      </div>
      <div class="pos-foot">
        <span>Held \${fmtHeld(p.holdingSeconds)}</span>
        \${beLocked ? '<span class="tag">CAN\\'T LOSE</span>' : '<span>Risking '+money2(Math.abs((entry-stop)*qty))+'</span>'}
        <span>\${esc((p.source||p.strategy||'').replace('_INTERNAL',''))}</span>
      </div>
    </div>\`;
  }).join('');
}

/* ============================================================
   SESSION CLOCK
   ============================================================ */
const SESSION_LABEL={PREMARKET:'Pre-market',REGULAR:'Regular session',CORE:'Regular session',
  EXTENDED:'Extended hours',AFTER_HOURS:'After hours',NIGHT:'Overnight',CLOSED:'Closed'};
function fmtCountdown(ms){
  if(ms==null||ms<0) return '—';
  const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor(s%3600/60);
  return h>0 ? h+'h '+String(m).padStart(2,'0')+'m' : m+'m '+String(s%60).padStart(2,'0')+'s';
}
function paintClock(){ if(state.sessionEndsAt) $('sessTime').textContent=fmtCountdown(state.sessionEndsAt-Date.now()); }
setInterval(paintClock,1000);

/* ============================================================
   SESSIONS ALLOWED
   ============================================================ */
const SESSION_OPTIONS=[
  {id:'PREMARKET',name:'Pre-market',time:'4:00 – 9:30 AM ET',note:'Thin volume, wider spreads'},
  {id:'REGULAR',name:'Regular session',time:'9:30 AM – 4:00 PM ET',note:'Full liquidity'},
  {id:'AFTER_HOURS',name:'After hours',time:'4:00 – 8:00 PM ET',note:'Thin volume, gap risk'}
];
function renderSessions(){
  $('sessionList').innerHTML=SESSION_OPTIONS.map(s=>\`
    <div class="check" data-sess="\${s.id}" data-on="\${state.sessions.includes(s.id)}">
      <span class="box">✓</span>
      <span class="check-txt"><span class="check-n">\${s.name}</span><span class="check-d">\${s.time} · \${s.note}</span></span>
    </div>\`).join('');
  document.querySelectorAll('[data-sess]').forEach(el=>{
    el.onclick=()=>{
      const id=el.dataset.sess;
      state.sessions = state.sessions.includes(id) ? state.sessions.filter(x=>x!==id) : [...state.sessions,id];
      renderSessions(); paintSessWarn();
    };
  });
  $('sessCount').textContent = state.sessions.length ? state.sessions.length+' ›' : 'none ›';
}
function paintSessWarn(){
  const w=$('sessWarn');
  const extended=state.sessions.some(s=>s!=='REGULAR');
  if(!state.sessions.length){ w.hidden=false; w.textContent='No sessions selected — the engine cannot open any trades.'; return; }
  if(extended && state.cfg.marginPct>0){ w.hidden=false; w.textContent='Margin is not available outside the regular session. Trades in pre-market and after hours will use cash only.'; return; }
  if(extended){ w.hidden=false; w.textContent='Extended hours have thinner volume and wider spreads. Fills can be worse than the price you see.'; return; }
  w.hidden=true;
}
$('openSessions').onclick=()=>{ renderSessions(); paintSessWarn(); openSheet('sheetSessions'); };
$('saveSessions').onclick=async()=>{
  const b=$('saveSessions'); b.disabled=true; b.textContent='Saving…';
  try{
    await api(API.sessionPolicy,{method:'PUT',body:JSON.stringify({sessions:state.sessions})});
    b.textContent='Saved'; setTimeout(()=>{b.textContent='Save sessions';b.disabled=false;closeSheet($('sheetSessions'));},700);
  }catch(err){
    b.textContent='Save sessions'; b.disabled=false;
    openInfoRaw('Could not save',\`<div class="danger-note">\${esc(err.message)}</div>\`);
  }
};

/* ============================================================
   TRADE SETTINGS
   ============================================================ */
function tradableCapital(){
  const c=state.equity.cash, m=state.equity.margin;
  if(c==null && m==null) return null;
  return (c||0)*state.cfg.cashPct/100 + (m||0)*state.cfg.marginPct/100;
}
function syncSettings(){
  const g=state.cfg;
  $('cashPct').textContent=g.cashPct+'%';
  $('marginPct').textContent=g.marginPct+'%';
  $('tpVal').textContent=g.takeProfitR.toFixed(1)+'R';
  $('slVal').textContent=(+g.stopLossPct)+'%';
  $('maxVal').textContent=g.maxTrades;
  $('capVal').textContent=g.dailyLossPct.toFixed(1)+'%';

  const c=state.equity.cash, m=state.equity.margin;
  $('cashAmt').textContent   = c==null?'Balance unavailable':money(c*g.cashPct/100)+' of '+money(c);
  $('marginAmt').textContent = m==null?'Balance unavailable':money(m*g.marginPct/100)+' of '+money(m);

  const pool=tradableCapital();
  const risk=pool==null?null:pool*g.stopLossPct/100;
  $('slNote').textContent = risk==null?'Most you can lose on one trade':'Up to '+money(risk)+' on one trade';
  $('tpNote').textContent = risk==null?'Closes at '+g.takeProfitR.toFixed(1)+'× what the trade risked'
                                      :'Targets '+money(risk*g.takeProfitR)+' per winning trade';
  $('capNote').textContent = pool==null?'Trading halts for the day at this loss':'Halts the day at '+money(pool*g.dailyLossPct/100);

  const lossesToCap=Math.ceil(g.dailyLossPct/g.stopLossPct);
  const binding = lossesToCap<=g.maxTrades ? 'loss cap' : 'trade limit';
  const worst = Math.min(g.dailyLossPct, g.maxTrades*g.stopLossPct);
  $('riskMath').textContent='Worst realistic day: '+worst.toFixed(1)+'% of traded capital'
    +(pool==null?'':' (about '+money(pool*worst/100)+')')
    +' — '+Math.min(lossesToCap,g.maxTrades)+' losing trades in a row hits your '+binding+'.';

  $('sumCash').textContent=g.cashPct+'%'; $('sumMargin').textContent=g.marginPct+'%';
  $('sumTp').textContent=g.takeProfitR.toFixed(1)+'R'; $('sumSl').textContent=(+g.stopLossPct)+'%';
  $('sumMax').textContent=g.maxTrades; $('sumCap').textContent=g.dailyLossPct.toFixed(1)+'%';
  paintBudgets();
}
const BIND={cashRange:'cashPct',marginRange:'marginPct',tpRange:'takeProfitR',slRange:'stopLossPct',maxRange:'maxTrades',capRange:'dailyLossPct'};
Object.entries(BIND).forEach(([el,key])=>{ $(el).oninput=e=>{ state.cfg[key]=+e.target.value; syncSettings(); }; });

$('openSettings').onclick=()=>{
  const locked=state.running;
  document.querySelectorAll('#sheetSettings input[type=range]').forEach(r=> r.disabled=locked);
  $('saveSettings').disabled=locked;
  $('saveNote').textContent = locked
    ? 'Stop trading first — settings are locked while the engine is running.'
    : 'These apply to both paper and live trading, and can only be changed while the engine is stopped.';
  openSheet('sheetSettings');
};
$('saveSettings').onclick=async()=>{
  const b=$('saveSettings'); b.disabled=true; b.textContent='Saving…';
  try{
    await api(API.config,{method:'PUT',body:JSON.stringify({
      cashAllocationPercent:state.cfg.cashPct, marginAllocationPercent:state.cfg.marginPct,
      takeProfitR:state.cfg.takeProfitR, riskPerTradePercent:state.cfg.stopLossPct,
      maxDailyTrades:state.cfg.maxTrades, maxDailyLossPercent:state.cfg.dailyLossPct
    })});
    b.textContent='Saved'; setTimeout(()=>{b.textContent='Save settings';b.disabled=false;closeSheet($('sheetSettings'));},700);
  }catch(err){
    b.textContent='Save settings'; b.disabled=false;
    openInfoRaw('Could not save',\`<div class="danger-note">\${esc(err.message)}</div><p class="note">Your settings were not changed.</p>\`);
  }
};
function paintBudgets(){
  const g=state.cfg, t=state.today;
  const tp=clamp(t.trades/g.maxTrades,0,1);
  $('mTrades').style.width=(tp*100)+'%';
  $('mTrades').style.background = tp>=1?'var(--red)':tp>=.7?'var(--amber)':'var(--accent)';
  $('mTradesTxt').textContent = t.trades+' / '+g.maxTrades;
  const lp=clamp(t.lossPct/g.dailyLossPct,0,1);
  $('mLoss').style.width=(lp*100)+'%';
  $('mLoss').style.background = lp>=1?'var(--red)':lp>=.6?'var(--amber)':'var(--green)';
  $('mLossTxt').textContent = t.lossPct.toFixed(2)+'% / '+g.dailyLossPct.toFixed(1)+'%';
}

/* ============================================================
   SYMBOLS
   ============================================================ */
function renderChips(){
  const html = state.symbols.length
    ? state.symbols.map(s=>\`<span class="chip">\${esc(s)}<button data-rm="\${esc(s)}" aria-label="Remove \${esc(s)}">×</button></span>\`).join('')
    : '<div class="empty">No symbols yet. Add one above.</div>';
  $('chips').innerHTML=html; $('chips2').innerHTML=html;
  document.querySelectorAll('[data-rm]').forEach(b=>{
    b.onclick=()=>{ state.symbols=state.symbols.filter(x=>x!==b.dataset.rm); renderChips(); saveSymbols(); };
  });
  $('startBtn').disabled = !state.symbols.length && !state.running;
}
function addSymbol(el){
  const v=(el.value||'').trim().toUpperCase().replace(/[^A-Z.]/g,'');
  el.value='';
  if(!v||v.length>6) return;
  if(!state.symbols.includes(v)) state.symbols.push(v);
  renderChips(); saveSymbols();
}
['symInput','symInput2'].forEach(id=>{
  const el=$(id);
  el.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); addSymbol(el); }});
  el.addEventListener('blur',()=>addSymbol(el));
});
async function saveSymbols(){
  try{ await api(API.scanMode,{method:'PUT',body:JSON.stringify({mode:'CURATED_UNIVERSE',symbols:state.symbols})}); }catch(_){}
}

/* ============================================================
   SHEETS
   ============================================================ */
function openSheet(id){ $(id).dataset.open='true'; $(id).setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; }
function closeSheet(el){ el.dataset.open='false'; el.setAttribute('aria-hidden','true'); document.body.style.overflow=''; }
document.querySelectorAll('[data-close]').forEach(b=> b.onclick=()=>closeSheet(b.closest('.sheet')));
$('openScanner').onclick =()=>{ openSheet('sheetScanner'); loadScanner(); };
$('openSymbols').onclick =()=> openSheet('sheetSymbols');
$('openStrategy').onclick=()=> showStrategy($('strategySelect').value);
$('openCompare').onclick =()=>{ openSheet('sheetCompare'); loadCompare(); };
$('openActivity').onclick=()=>{ openSheet('sheetActivity'); loadActivity(); };

/* ============================================================
   INFO COPY
   ============================================================ */
const INFO={
  mode:{t:'Account modes',b:\`
    <p><strong>Paper Trading</strong> runs the full system against a practice account. Orders go to the broker's simulator, so nothing you own is at risk. Use it to see how a strategy behaves before it touches your money.</p>
    <p><strong>Live Trading</strong> places real orders with real funds. It stays locked until you confirm, and every limit you set still applies.</p>
    <p>Switching modes never carries positions across. Each account keeps its own trades.</p>\`},

  settings:{t:'Trade settings',b:\`
    <p>These six numbers decide how much you can win or lose. They apply to both paper and live trading, and can only be changed while the engine is stopped.</p>
    <p><strong>Cash used</strong> and <strong>Margin used</strong> cap how much of each account the engine may touch. Everything above the line stays untouched.</p>
    <p><strong>Take profit</strong> is set in R — a multiple of what the trade risked. At 2.0R a winner makes twice what it had at risk.</p>
    <p><strong>Stop loss</strong> is the most a single trade can lose, as a percentage of the capital you allowed the engine to trade. Position size is calculated backwards from this, so the loss stays the same whether the stock is $12 or $300.</p>
    <p><strong>Max trades per day</strong> stops new entries once reached. <strong>Daily loss cap</strong> halts trading for the rest of the day. Whichever is reached first wins.</p>
    <p>Read the line at the bottom of the settings page before saving — it shows your worst realistic day with these numbers.</p>\`},

  session:{t:'Market clock',b:\`
    <p>Shows which part of the trading day is running now, and how long until it changes.</p>
    <p>The engine only opens trades during the sessions you allow. As the last allowed session nears its close, any open position is closed — margin trades are never carried overnight.</p>\`},

  sessions:{t:'Sessions allowed',b:\`
    <p>Choose when the engine may open new trades.</p>
    <p><strong>Regular session</strong> has the most volume and the tightest spreads. Most strategies are designed around it.</p>
    <p><strong>Pre-market</strong> and <strong>after hours</strong> have far fewer buyers and sellers. Prices move further on smaller orders, spreads are wider, and your fill can be meaningfully worse than the quote. Margin is not available in these windows.</p>
    <p>Whatever you allow, positions are still closed before the last allowed session ends.</p>\`},

  position:{t:'The position bar',b:\`
    <p>Each open trade shows one bar running from your <strong>stop</strong> on the left to your <strong>target</strong> on the right. The dot is the live price. The faint vertical line is where you entered.</p>
    <p>The colour tracks the dot: red near the stop, amber in the middle, green as it approaches the target. You can read the state of a trade without reading a number.</p>
    <p><strong>R</strong> is the result measured against what the trade risked. +1.00R means it has made exactly what it had at risk.</p>
    <p><strong>Can't lose</strong> appears once the stop has been raised to your entry price. From that point the trade can still win, but it can no longer end below breakeven.</p>\`},

  strategy:{t:'Strategies',b:\`
    <p>One strategy runs at a time. It decides when to enter and when to exit — nothing else.</p>
    <p>Position size, risk per trade, the daily loss cut-off, and the live lock are handled separately and always apply, whichever strategy you pick.</p>
    <p>Tap <strong>How this strategy trades</strong> for the exact rules, or <strong>Compare all strategies</strong> to see which has actually worked on your account.</p>\`},

  compare:{t:'Comparing strategies',b:\`
    <p>Strategies are ranked by <strong>expectancy</strong>: the average R won or lost per trade. A strategy that wins 40% of the time but wins twice what it loses beats one that wins 70% of the time in tiny amounts.</p>
    <p><strong>Win rate</strong> alone is misleading, which is why it is shown but not ranked on.</p>
    <p><strong>Trades</strong> matters more than either. Under about 30 trades, differences are mostly luck. Treat early rankings as a hint, not an answer.</p>
    <p><strong>Worst run</strong> is the deepest peak-to-trough drop. A strategy you cannot sit through is not usable, however good its average looks.</p>\`},

  symbols:{t:'Symbols',b:\`
    <p>The scanner only watches the symbols you list. It never picks stocks on its own.</p>
    <p>Add one symbol to focus on a single stock, or several to let the strategy choose among them. Your list is saved and reloads next time.</p>
    <p>Fewer symbols means faster scans and results that are easier to read.</p>\`},

  status:{t:'Status',b:\`
    <p><strong>Engine</strong> — whether the system is scanning and allowed to trade.</p>
    <p><strong>Broker</strong> — the account connection. Trading will not start unless this is connected.</p>
    <p>The two meters show how much of today's budget is used. When either fills, no new trades open until tomorrow. Open trades still run to their own exit.</p>
    <p><strong>Close everything now</strong> exits every open position immediately at market and stops the engine. Use it when something looks wrong.</p>\`},

  scanner:{t:'Scanner and trades',b:\`
    <p><strong>Scanned</strong> counts symbols checked in the last pass. <strong>Signals taken</strong> counts how many became orders — most scans produce none, which is normal.</p>
    <p>Each row shows entry, exit, how long it was held, and the result in dollars and in R.</p>\`},

  activity:{t:'Activity log',b:\`
    <p>A plain record of what the engine did and why: scans run, signals accepted or rejected, orders placed, limits reached.</p>
    <p>When a trade you expected did not happen, the reason is here.</p>\`},

  liveConfirm:{t:'Switch to live trading?',b:\`
    <p>Live trading places <strong>real orders with real money</strong>. Losses are permanent.</p>
    <p>Your current settings allow the engine to lose up to <strong id="liveWorst">—</strong> in a single day before it halts.</p>
    <p>Only switch once you have watched this strategy run in paper trading long enough to know how it behaves on both good and bad days.</p>
    <div class="danger-note">This app cannot give financial advice. You are responsible for every order the system places on your behalf.</div>
    <button class="btn mid" id="confirmLive" style="margin-top:20px;background:var(--amber);color:#241601;border-color:var(--amber)">Continue to live trading</button>
    <button class="btn ghost mid" id="stayPaper" style="margin-top:10px">Stay in paper trading</button>\`}
};
function openInfo(key){
  const d=INFO[key]; if(!d) return;
  $('infoTitle').innerHTML=d.t; $('infoBody').innerHTML=d.b; openSheet('sheetInfo');
  const lw=$('liveWorst');
  if(lw){
    const pool=tradableCapital();
    const worst=Math.min(state.cfg.dailyLossPct, state.cfg.maxTrades*state.cfg.stopLossPct);
    lw.textContent = pool==null ? worst.toFixed(1)+'% of traded capital' : money(pool*worst/100);
  }
  const cl=$('confirmLive'), sp=$('stayPaper');
  if(cl) cl.onclick=()=>{ setMode('LIVE'); closeSheet($('sheetInfo')); };
  if(sp) sp.onclick=()=>closeSheet($('sheetInfo'));
}
function openInfoRaw(title,body){ $('infoTitle').textContent=title; $('infoBody').innerHTML=body; openSheet('sheetInfo'); }
document.querySelectorAll('[data-info]').forEach(b=> b.onclick=()=>openInfo(b.dataset.info));

/* ============================================================
   STRATEGY DETAIL
   ============================================================ */
const STRATS={
  MOERAND_CLEAN_INTERNAL:{name:'MOERAND Clean',
    idea:'Buys strength that is breaking out on real volume, then trails the exit upward and never lets a winner turn into a loser.',
    entry:['Price is above its 50-bar trend average','Price closes above the highest high of the last 20 bars','Volume is at least 1.2× its recent average'],
    exit:['The trailing stop is hit','The session ends — the position is closed either way'],
    specs:[['Timeframe','Chart'],['Trend average','50 bars'],['Breakout window','20 bars'],['Minimum volume','1.2×'],['Stop distance','1.0 × ATR(2)'],['Breakeven lock','On, at +1R']],
    note:'Each session starts flat. Nothing carries over from the night before, so an overnight move can never trigger the morning entry.'},
  MOERAND_SIMPLE_INTERNAL:{name:'MOERAND Simple',
    idea:'Follows the trend with a volatility-based trailing line. Stays in while the trend holds, exits when the line is crossed.',
    entry:['Price crosses above the ATR trailing line','No position is currently open'],
    exit:['The ATR trailing line is crossed back down'],
    specs:[['Timeframe','5 min'],['ATR period','10'],['Sensitivity','1.0'],['Fixed stop','None — trailing only']],
    note:'No fixed target. Built to hold through a trend, so trades can run much longer than the others.'},
  MOERAND_SCALP_INTERNAL:{name:'MOERAND Scalp',
    idea:'Works only when the market is going sideways. Buys dips to the bottom of the range and takes profit back at the middle.',
    entry:['The higher timeframe is ranging, not trending','Price touches the lower band and closes back above it','RSI confirms oversold'],
    exit:['Price reaches the middle band','A tight stop is hit','The maximum holding time runs out'],
    specs:[['Timeframe','1 min'],['Bands','20, 2σ'],['Stop distance','0.5 × ATR(14)'],['Minimum reward','1.2 : 1'],['Max hold','10 bars']],
    note:'Trades are small and frequent, so spread and commission matter far more here. Check the numbers still work after costs.'},
  FUSION_V2:{name:'Fusion V2',
    idea:'Scores every candidate across several independent checks and trades only when enough of them agree. The most selective of the four.',
    entry:['Liquidity, trend, order flow, and market state all score well','Combined score clears the threshold','Reward-to-risk is at least 2:1'],
    exit:['Protective stop or target is reached','The session ends'],
    specs:[['Timeframe','5 min + 1 h context'],['Minimum score','68'],['Minimum confidence','68'],['Minimum reward','2 : 1']],
    note:'Expect long stretches with no trades. Rejecting most candidates is what it is designed to do — not a fault.'}
};
function showStrategy(id){
  const s=STRATS[id]; if(!s) return;
  $('stratTitle').textContent=s.name;
  $('stratBody').innerHTML=\`
    <p>\${s.idea}</p>
    <div class="card-title" style="margin:26px 0 12px">Enters when</div>
    \${s.entry.map(r=>\`<div class="rule">\${r}</div>\`).join('')}
    <div class="card-title" style="margin:26px 0 12px">Exits when</div>
    \${s.exit.map(r=>\`<div class="rule">\${r}</div>\`).join('')}
    <div class="card-title" style="margin:26px 0 4px">Settings</div>
    \${s.specs.map(([k,v])=>\`<div class="spec"><span class="spec-k">\${k}</span><span class="spec-v">\${v}</span></div>\`).join('')}
    <p class="note">\${s.note}</p>\`;
  openSheet('sheetStrategy');
}

/* ============================================================
   STRATEGY COMPARISON
   Ranked on expectancy, with an explicit warning when the
   sample is too small for the ranking to mean anything.
   ============================================================ */
async function loadCompare(){
  let rows=[];
  try{ const a=await api(API.analytics); rows=a.byStrategy||a.strategies||[]; }catch(_){}

  if(!rows.length){
    $('compareList').innerHTML='<div class="card"><div class="empty">No completed trades yet. Once each strategy has run, this page ranks them on how they actually performed on your account.</div></div>';
    $('compareVerdict').innerHTML='';
    return;
  }

  const norm=rows.map(r=>{
    const id=r.source||r.strategy||r.id||'—';
    const trades=+(r.trades??r.tradeCount??0);
    const wins=+(r.wins??0);
    const totalR=+(r.realizedR??r.totalR??0);
    return {
      id, name:(STRATS[id]||{}).name || String(id).replace('_INTERNAL',''),
      trades, wins,
      winRate: trades? wins/trades*100 : 0,
      expectancy: +(r.expectancy ?? (trades? totalR/trades : 0)),
      worstRun: +(r.maxDrawdownR ?? r.worstRun ?? 0),
      history: r.history || r.rHistory || []
    };
  }).sort((a,b)=> b.expectancy-a.expectancy);

  const reliable=norm.filter(s=>s.trades>=30);
  $('compareList').innerHTML=norm.map((s,i)=>{
    const thin=s.trades<30;
    const spark=(s.history.length? s.history : Array(12).fill(0)).slice(-12);
    const peak=Math.max(...spark.map(v=>Math.abs(+v||0)),1);
    return \`<div class="rank" data-best="\${i===0&&!thin}">
      <div class="rank-top">
        <span class="rank-no">\${String(i+1).padStart(2,'0')}</span>
        <span class="rank-name">\${esc(s.name)}</span>
        \${i===0&&!thin ? '<span class="rank-badge">BEST</span>'
          : thin ? '<span class="rank-badge" style="background:#2A1E08;color:var(--amber);border-color:var(--amber)">TOO EARLY</span>' : ''}
      </div>
      <dl class="rank-grid">
        <div><dt>Per trade</dt><dd style="color:\${s.expectancy>=0?'var(--green)':'var(--red)'}">\${s.expectancy>=0?'+':''}\${s.expectancy.toFixed(2)}R</dd></div>
        <div><dt>Win rate</dt><dd>\${s.winRate.toFixed(0)}%</dd></div>
        <div><dt>Trades</dt><dd\${thin?' style="color:var(--amber)"':''}>\${s.trades}</dd></div>
        <div><dt>Worst run</dt><dd style="color:var(--red)">−\${Math.abs(s.worstRun).toFixed(1)}R</dd></div>
      </dl>
      <div class="spark">\${spark.map(v=>{
        const h=Math.abs(+v||0)/peak*100;
        return \`<i style="height:\${Math.max(h,6)}%;background:\${(+v||0)>=0?'var(--green)':'var(--red)'};opacity:.75"></i>\`;
      }).join('')}</div>
    </div>\`;
  }).join('');

  const best=norm[0];
  let verdict;
  if(!reliable.length){
    verdict='Every strategy here is still under 30 trades, so this ranking is mostly noise. Keep running them in paper trading before drawing any conclusion.';
  }else if(best.trades<30){
    verdict=\`<strong>\${esc(best.name)}</strong> leads on paper, but only over \${best.trades} trades. <strong>\${esc(reliable[0].name)}</strong> is the most trustworthy result so far with \${reliable[0].trades} trades at \${reliable[0].expectancy>=0?'+':''}\${reliable[0].expectancy.toFixed(2)}R per trade.\`;
  }else if(best.expectancy<=0){
    verdict=\`No strategy is currently profitable on your account. The least bad is <strong>\${esc(best.name)}</strong> at \${best.expectancy.toFixed(2)}R per trade. Nothing here is ready for live money.\`;
  }else{
    verdict=\`<strong>\${esc(best.name)}</strong> is ahead at +\${best.expectancy.toFixed(2)}R per trade over \${best.trades} trades, with a worst run of −\${Math.abs(best.worstRun).toFixed(1)}R. Ask yourself whether you could sit through that drawdown before committing to it.\`;
  }
  $('compareVerdict').innerHTML=\`<div class="card" style="margin-top:20px"><div class="card-title" style="margin-bottom:10px">Reading this</div><p style="margin:0">\${verdict}</p></div>\`;
}

/* ============================================================
   START / STOP / PANIC
   ============================================================ */
$('startBtn').onclick=async()=>{
  if(!state.symbols.length){ openSheet('sheetSymbols'); return; }
  const b=$('startBtn'); b.disabled=true;
  try{
    if(!state.running){
      await api(API.mode,{method:'PUT',body:JSON.stringify({
        mode: state.mode==='LIVE'?'LIVE':'SANDBOX', armed:true,
        strategy:$('strategySelect').value, symbols:state.symbols,
        sessions:state.sessions, settings:state.cfg
      })});
      state.running=true;
    }else if(state.positions.length){
      b.disabled=false;
      openInfoRaw('Stop with open trades?',
        \`<p>You have <strong>\${state.positions.length}</strong> open \${state.positions.length===1?'position':'positions'}. Stopping the engine does not close \${state.positions.length===1?'it':'them'} — \${state.positions.length===1?'it':'they'} will still run to the stop, the target, or the session close.</p>
         <button class="btn mid" id="stopAnyway" style="margin-top:18px">Stop the engine, keep trades open</button>
         <button class="btn stop mid" id="stopAndClose" style="margin-top:10px">Stop and close everything</button>\`);
      $('stopAnyway').onclick=async()=>{ closeSheet($('sheetInfo')); await doStop(false); };
      $('stopAndClose').onclick=async()=>{ closeSheet($('sheetInfo')); await doStop(true); };
      return;
    }else{
      await doStop(false);
    }
  }catch(err){
    $('stEngine').textContent='Blocked'; $('stEngine').className='bad';
    openInfoRaw('Could not start',\`<p>The system refused to start:</p><div class="danger-note">\${esc(err.message)}</div><p class="note">Nothing was started. Fix the reason above and try again.</p>\`);
  }
  refreshStatus(); b.disabled=false;
};
async function doStop(closePositions){
  try{
    if(closePositions) await api(API.closeAll,{method:'POST',body:JSON.stringify({all:true,reason:'MANUAL_STOP'})});
    await api(API.mode,{method:'PUT',body:JSON.stringify({armed:false})});
    state.running=false;
  }catch(err){ openInfoRaw('Could not stop',\`<div class="danger-note">\${esc(err.message)}</div>\`); }
  refreshStatus();
}
$('panicBtn').onclick=()=>{
  openInfoRaw('Close everything now?',
    \`<p>This exits every open position immediately at market price and stops the engine.</p>
     <p>Market orders fill at whatever price is available, which can be worse than your stop. Use this when something looks wrong, not as a normal exit.</p>
     <button class="btn stop mid" id="panicYes" style="margin-top:18px">Close everything now</button>
     <button class="btn ghost mid" id="panicNo" style="margin-top:10px">Cancel</button>\`);
  $('panicYes').onclick=async()=>{ closeSheet($('sheetInfo')); await doStop(true); };
  $('panicNo').onclick =()=> closeSheet($('sheetInfo'));
};
function paintStart(){
  const b=$('startBtn');
  b.dataset.running=String(state.running);
  b.textContent = state.running?'Stop trading':'Start trading';
}

/* ============================================================
   REFRESH
   ============================================================ */
async function refreshStatus(){
  try{
    const h=await api(API.health);
    const ok=h.broker?.connected ?? h.readiness?.ok ?? true;
    $('stBroker').textContent = ok?'Connected':'Offline';
    $('stBroker').className = ok?'ok':'bad';
    if(h.armed!=null) state.running=!!h.armed;
  }catch(_){ $('stBroker').textContent='Offline'; $('stBroker').className='bad'; }

  try{
    const s=await api(API.session);
    const cur=s.session?.current ?? s.current ?? s.session ?? 'CLOSED';
    const id=String(cur.id||cur).toUpperCase();
    $('sessName').textContent = SESSION_LABEL[id]||'Closed';
    const open=s.session?.isOpen ?? s.isOpen ?? (id!=='CLOSED');
    const endsAt=s.session?.endsAt ?? s.endsAt ?? s.nextOpenAt ?? null;
    state.sessionEndsAt = endsAt? new Date(endsAt).getTime() : null;
    $('sessLbl').textContent = open?'until close':'until open';
    $('sessSub').textContent = open
      ? (state.sessions.includes(id)?'Trading allowed in this session':'Not in your allowed sessions')
      : 'Waiting for the next session';
    paintClock();
  }catch(_){}

  try{
    const p=await api(API.position);
    state.positions = p.positions || (p.position? [p.position] : []);
  }catch(_){ state.positions=[]; }
  renderPositions();

  try{
    const t=await api(API.trades);
    const list=t.trades||t.items||[];
    const closed=list.filter(x=>(x.status||'').toUpperCase()==='CLOSED');
    const net=closed.reduce((s,x)=>s+Number(x.realizedPnl??x.pnl??0),0);
    state.today.trades=closed.length;
    state.today.pnl=net;
    const pool=tradableCapital();
    state.today.lossPct = (net<0&&pool)? Math.abs(net)/pool*100 : 0;
    $('stOpen').textContent = list.length-closed.length;
    $('stPnl').textContent = closed.length? (net>=0?'+':'')+money2(net) : '—';
    $('stPnl').className='mono '+(net>0?'ok':net<0?'bad':'off');
    paintBudgets();
  }catch(_){}

  try{
    const p=await api(API.portfolio);
    state.equity.cash   = p.portfolio?.cashBalance   ?? p.cashBalance   ?? null;
    state.equity.margin = p.portfolio?.marginBalance ?? p.marginBalance ?? null;
    syncSettings();
  }catch(_){}

  $('stEngine').textContent = state.running?'Running':'Stopped';
  $('stEngine').className = state.running?'ok':'off';
  paintStart();
}

async function loadScanner(){
  try{
    const d=await api(API.diagnostic); const s=d.diagnostic||d;
    $('scScanned').textContent = s.scanned ?? '—';
    $('scTaken').textContent   = s.accepted ?? s.selected ?? '—';
    $('scLast').textContent    = s.durationMs? (s.durationMs/1000).toFixed(1)+'s' : '—';
  }catch(_){}
  try{
    const t=await api(API.trades);
    const list=(t.trades||t.items||[]).slice(0,40);
    let net=0;
    $('tradeList').innerHTML = list.length ? list.map(x=>{
      const closed=(x.status||'').toUpperCase()==='CLOSED';
      const pnl=Number(x.realizedPnl??x.pnl??0);
      if(closed) net+=pnl;
      const r=x.realizedR??x.r;
      const cls = !closed?'open': pnl>=0?'win':'loss';
      const label = !closed?'Open':(pnl>=0?'+':'')+money2(pnl).replace('−','');
      return \`<div class="row">
        <div class="row-top"><span class="sym">\${esc(x.symbol||'—')}</span><span class="pill \${cls}">\${label}</span></div>
        <dl class="row-grid">
          <div><dt>Entry</dt><dd>\${x.entryPrice!=null?(+x.entryPrice).toFixed(2):'—'}</dd></div>
          <div><dt>Exit</dt><dd>\${x.exitPrice!=null?(+x.exitPrice).toFixed(2):'—'}</dd></div>
          <div><dt>Held</dt><dd>\${fmtHeld(x.holdingSeconds??x.durationSeconds)}</dd></div>
          <div><dt>Result</dt><dd>\${r!=null?(r>=0?'+':'')+(+r).toFixed(2)+'R':'—'}</dd></div>
          <div><dt>Strategy</dt><dd style="font-size:13px">\${esc(String(x.source||x.strategy||'—').replace('_INTERNAL',''))}</dd></div>
          <div><dt>Exit reason</dt><dd style="font-size:13px">\${esc(x.exitReason||'—')}</dd></div>
        </dl></div>\`;
    }).join('') : '<div class="empty">No trades yet. Trades appear here as they open and close.</div>';
    $('scPnl').textContent = money2(net);
    $('scPnl').className='mono '+(net>0?'ok':net<0?'bad':'off');
  }catch(_){}
}

async function loadActivity(){
  try{
    const a=await api(API.activity);
    const items=(a.events||a.activity||a.items||[]).slice(0,60);
    $('activityList').innerHTML = items.length
      ? '<div class="log">'+items.map(e=>{
          const t=e.createdAt||e.timestamp;
          const time=t? new Date(t).toLocaleTimeString('en-US',{hour12:false}) : '';
          return \`<div><b>\${esc(time)}</b> \${esc(e.type||e.event||'')} \${esc(e.symbol||'')} \${esc(e.reason||e.message||'')}</div>\`;
        }).join('')+'</div>'
      : '<div class="empty">Nothing logged yet.</div>';
  }catch(_){ $('activityList').innerHTML='<div class="empty">Activity is unavailable right now.</div>'; }
}

function fmtHeld(sec){
  if(sec==null) return '—';
  sec=Number(sec)||0;
  if(sec<60) return sec+'s';
  if(sec<3600) return Math.round(sec/60)+'m';
  return (sec/3600).toFixed(1)+'h';
}

/* ============================================================
   BOOT
   ============================================================ */
async function boot(){
  try{
    const c=await api(API.config); const g=c.config||c;
    if(g.cashAllocationPercent!=null)   state.cfg.cashPct=+g.cashAllocationPercent;
    if(g.marginAllocationPercent!=null) state.cfg.marginPct=+g.marginAllocationPercent;
    if(g.takeProfitR!=null)             state.cfg.takeProfitR=+g.takeProfitR;
    if(g.riskPerTradePercent!=null)     state.cfg.stopLossPct=+g.riskPerTradePercent;
    if(g.maxDailyTrades!=null)          state.cfg.maxTrades=+g.maxDailyTrades;
    if(g.maxDailyLossPercent!=null)     state.cfg.dailyLossPct=+g.maxDailyLossPercent;
    Object.entries(BIND).forEach(([el,key])=> $(el).value=state.cfg[key]);
  }catch(_){}

  try{
    const sm=await api(API.scanMode); const m=sm.scanMode||sm;
    state.symbols = m.curatedSymbols||m.focusedSymbols||[];
  }catch(_){}

  try{
    const sp=await api(API.sessionPolicy);
    const s=sp.sessions||sp.policy?.sessions;
    if(Array.isArray(s)&&s.length) state.sessions=s;
  }catch(_){}

  renderChips(); renderSessions(); renderPositions(); setMode('PAPER');
  refreshStatus(); resetIdle();

  clearInterval(window.__moeTick);
  window.__moeTick=setInterval(()=>{
    if(!state.unlocked) return;
    refreshStatus();
    if($('sheetScanner').dataset.open==='true') loadScanner();
    if($('sheetActivity').dataset.open==='true') loadActivity();
  },8000);
}

lock();
</script>
</body>
</html>
`;
