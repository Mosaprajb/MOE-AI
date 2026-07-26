const PORTFOLIO_STYLE = `
<style id="portfolioRiskStyles">
.pr-panel{margin-top:14px;padding:18px;border:1px solid rgba(74,116,153,.5);border-radius:16px;background:linear-gradient(145deg,rgba(8,27,45,.97),rgba(4,14,26,.99));color:#e5eef8;scroll-margin-top:90px;box-shadow:0 18px 48px rgba(0,0,0,.24)}
.pr-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:18px;border:1px solid rgba(74,116,153,.42);border-radius:14px;background:rgba(8,25,42,.78)}
.pr-kicker{font-size:9px;letter-spacing:.16em;color:#78a9d1;font-weight:900}.pr-title{margin:5px 0 4px;font-size:clamp(21px,2.4vw,30px)}.pr-subtitle{color:#93a9bf;font-size:11px;line-height:1.65}.pr-source{display:inline-flex;gap:7px;align-items:center;margin-top:10px;padding:6px 9px;border:1px solid rgba(82,120,156,.45);border-radius:8px;font-size:9px;font-weight:850}.pr-source.live{color:#ffadb7;border-color:#8d3e4b;background:rgba(122,40,54,.2)}.pr-source.sandbox{color:#8ecfff;border-color:#316b95;background:rgba(34,91,133,.18)}
.pr-verdict{text-align:center;min-width:190px;padding:16px;border:1px solid currentColor;border-radius:13px}.pr-verdict strong{display:block;font-size:19px}.pr-verdict span{display:block;margin-top:6px;font-size:10px;opacity:.84}.pr-verdict.ok{color:#6de0a6;background:rgba(36,129,87,.14)}.pr-verdict.warn{color:#f6c66f;background:rgba(137,98,30,.14)}.pr-verdict.blocked{color:#ff8e9a;background:rgba(139,46,59,.16)}
.pr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.pr-button{min-height:38px;padding:8px 12px;border:1px solid #365a7a;border-radius:9px;background:#10253c;color:#eaf3fc;font-weight:850;cursor:pointer}.pr-button:hover{border-color:#68b8ef}.pr-updated{align-self:center;color:#7f97ae;font-size:9px}
.pr-main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}.pr-stat{padding:14px;border:1px solid rgba(61,99,134,.42);border-radius:12px;background:rgba(6,20,35,.78);min-width:0}.pr-stat span{display:block;color:#839ab1;font-size:9px}.pr-stat strong{display:block;margin-top:7px;font-size:18px;overflow-wrap:anywhere}.pr-stat small{display:block;margin-top:5px;color:#7890aa;font-size:8px}.pr-positive{color:#63dfa3}.pr-negative{color:#ff8e9a}.pr-warning{color:#f6c66f}
.pr-decision-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}.pr-decision{padding:13px;border:1px solid rgba(60,98,135,.42);border-radius:11px;background:rgba(5,18,32,.76)}.pr-decision span{display:block;color:#8299b0;font-size:9px}.pr-decision strong{display:block;margin-top:6px;font-size:13px}.pr-yes{color:#66dfa5}.pr-no{color:#ff8e9a}
.pr-layout{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.pr-box{padding:15px;border:1px solid rgba(61,99,134,.42);border-radius:13px;background:rgba(5,18,32,.72)}.pr-box h4{margin:0 0 12px;font-size:13px}.pr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.pr-metric{padding:10px;border:1px solid rgba(52,88,124,.34);border-radius:9px}.pr-metric span{display:block;color:#7890aa;font-size:8px}.pr-metric strong{display:block;margin-top:5px;font-size:12px}.pr-progress-wrap{margin-top:10px}.pr-progress-head{display:flex;justify-content:space-between;gap:10px;color:#8fa4bf;font-size:9px}.pr-progress{height:8px;margin-top:6px;border-radius:999px;background:#0a1725;overflow:hidden;border:1px solid rgba(60,95,127,.35)}.pr-progress>span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#2c8b63,#72dfaa)}.pr-progress.warning>span{background:linear-gradient(90deg,#9b6f24,#f2c669)}.pr-progress.danger>span{background:linear-gradient(90deg,#8e3544,#ff8290)}
.pr-alerts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.pr-alert-box{padding:14px;border:1px solid rgba(61,99,134,.42);border-radius:12px;background:rgba(5,18,32,.72)}.pr-alert-box h4{margin:0 0 10px;font-size:12px}.pr-tags{display:grid;gap:7px}.pr-tag{padding:9px 10px;border-radius:9px;border:1px solid rgba(72,107,140,.52);font-size:10px;line-height:1.45;color:#a9bdd1}.pr-tag.blocker{color:#ffadb6;border-color:#8a3b46;background:rgba(131,42,54,.13)}.pr-tag.warning{color:#f7cb7c;border-color:#8d6a2e;background:rgba(129,91,28,.12)}.pr-tag.ok{color:#70dfa9;border-color:#2d7457;background:rgba(33,111,76,.12)}
.pr-positions{margin-top:12px}.pr-position-list{display:grid;gap:8px}.pr-position{display:grid;grid-template-columns:minmax(90px,.8fr) repeat(6,minmax(78px,1fr));gap:8px;align-items:center;padding:11px;border:1px solid rgba(55,90,124,.38);border-radius:10px;background:rgba(7,20,34,.75)}.pr-position>div span{display:block;color:#7890aa;font-size:8px}.pr-position>div strong{display:block;margin-top:4px;font-size:10px;overflow-wrap:anywhere}.pr-position-symbol strong{font-size:15px}.pr-protection{display:inline-flex;padding:5px 7px;border-radius:7px;border:1px solid currentColor}.pr-protection.good{color:#65dea4}.pr-protection.partial{color:#f6c66f}.pr-protection.bad{color:#ff8e9a}
.pr-note{margin-top:10px;color:#8fa4bf;font-size:9px;line-height:1.6}.pr-empty{padding:24px;text-align:center;color:#8fa4bf;border:1px dashed rgba(60,96,131,.45);border-radius:12px}.pr-error{color:#ff9da7}
@media(max-width:1100px){.pr-main{grid-template-columns:repeat(2,1fr)}.pr-position{grid-template-columns:repeat(4,minmax(0,1fr))}.pr-position-symbol{grid-column:span 2}}
@media(max-width:760px){.pr-hero{grid-template-columns:1fr}.pr-verdict{min-width:0;text-align:start}.pr-layout,.pr-alerts{grid-template-columns:1fr}.pr-decision-grid{grid-template-columns:1fr}.pr-position{grid-template-columns:repeat(2,minmax(0,1fr))}.pr-position-symbol{grid-column:1/-1}}
@media(max-width:520px){.pr-panel{padding:11px}.pr-main,.pr-grid{grid-template-columns:1fr}.pr-position{grid-template-columns:1fr}.pr-position-symbol{grid-column:auto}.pr-stat strong{font-size:16px}}
</style>`;

const PORTFOLIO_SCRIPT = `
<script id="portfolioRiskScript">
(function(){
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const finite=value=>Number.isFinite(Number(value));
  const cash=value=>finite(value)?money.format(Number(value)):'—';
  const number=(value,digits=2)=>finite(value)?Number(value).toFixed(digits):'—';
  const percent=value=>finite(value)?number(value,2)+'%':'—';
  const list=value=>Array.isArray(value)?value:[];
  const english=()=>localStorage.getItem('moe-ui-language')==='en';
  const tx=(ar,en)=>english()?en:ar;
  const translations={
    MAXIMUM_OPEN_POSITIONS_REACHED:['تم الوصول إلى الحد الأقصى للمراكز المفتوحة','Maximum open positions reached'],
    OPEN_POSITION_CAPACITY_LOW:['بقيت سعة محدودة لفتح مراكز جديدة','Open-position capacity is low'],
    UNPROTECTED_POSITION_EXISTS:['يوجد مركز بلا وقف خسارة أو حماية مكتملة','An unprotected position exists'],
    PARTIALLY_PROTECTED_POSITION_EXISTS:['يوجد مركز بحماية جزئية','A partially protected position exists'],
    BROKER_PROTECTION_STATUS_UNVERIFIED:['تعذر التحقق من حماية أحد المراكز لدى الوسيط','Broker protection could not be verified'],
    SYMBOL_CONCENTRATION_LIMIT_EXCEEDED:['تركيز المحفظة في سهم واحد أعلى من المسموح','Single-symbol concentration limit exceeded'],
    SECTOR_PROXY_EXPOSURE_LIMIT_EXCEEDED:['التعرض لقطاع واحد أعلى من المسموح','Sector exposure limit exceeded'],
    OPEN_RISK_LIMIT_EXCEEDED:['المخاطرة المفتوحة أعلى من حد المحفظة','Open risk exceeds the portfolio limit'],
    OPEN_RISK_PARTIALLY_UNAVAILABLE:['تعذر حساب المخاطرة الكاملة لبعض المراكز','Open risk is unavailable for some positions'],
    DAILY_LOSS_LIMIT_REACHED:['تم الوصول إلى حد الخسارة اليومية','Daily loss limit reached'],
    MARGIN_CALL_ACTIVE:['يوجد نداء هامش نشط','A margin call is active'],
    MARGIN_HARD_EXIT_REQUIRED:['يلزم خروج إجباري بسبب الهامش','A margin hard exit is required'],
    ACCOUNT_SNAPSHOT_STALE:['بيانات الحساب قديمة وتحتاج تحديثًا','Account data is stale'],
    ACCOUNT_DATA_UNAVAILABLE:['بيانات الحساب غير متاحة','Account data is unavailable'],
    CORRELATION_MATRIX_UNAVAILABLE:['مصفوفة الارتباط غير متاحة حاليًا','Correlation matrix is unavailable'],
    CORRELATION_MATRIX_UNAVAILABLE_SECTOR_PROXY_ONLY:['يتم استخدام القطاع كبديل مؤقت للارتباط','Sector proxy is being used for correlation'],
    EQUITY_UNAVAILABLE_FOR_PERCENT_RISK:['صافي قيمة الحساب غير متاح لحساب نسبة المخاطرة','Equity is unavailable for percentage-risk calculation']
  };
  function message(code){const pair=translations[String(code||'').toUpperCase()];return pair?(english()?pair[1]:pair[0]):String(code||'').replaceAll('_',' ');}
  function panel(){
    let node=document.getElementById('portfolio-risk')||document.getElementById('portfolioRiskPanel');
    if(node){node.id='portfolio-risk';node.classList.add('pr-panel');return node;}
    node=document.createElement('section');node.id='portfolio-risk';node.className='pr-panel';
    const anchor=document.querySelector('.sm-observation-panel')||document.querySelector('main')||document.body;
    if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(node,anchor.nextSibling);else document.body.appendChild(node);
    return node;
  }
  function statusClass(status){return status==='NORMAL'?'ok':status==='WARNING'?'warn':'blocked';}
  function statusText(status){const map={NORMAL:[tx('المخاطر طبيعية','Risk normal'),tx('المحفظة تسمح بالمخاطرة الجديدة','Portfolio can accept new risk')],WARNING:[tx('توجد تحذيرات','Warnings detected'),tx('راجع التحذيرات قبل فتح صفقة جديدة','Review warnings before a new trade')],BLOCKED:[tx('فتح صفقات جديدة موقوف','New entries blocked'),tx('توجد قواعد مخاطرة تمنع التنفيذ','Risk rules are blocking execution')],CRITICAL:[tx('حالة حرجة','Critical risk state'),tx('أوقف التنفيذ وراجع الحساب فورًا','Stop execution and review the account')]} ;return map[status]||map.BLOCKED;}
  function stat(label,value,note,cls){return '<div class="pr-stat"><span>'+esc(label)+'</span><strong class="'+(cls||'')+'">'+esc(value)+'</strong><small>'+esc(note||'')+'</small></div>';}
  function metric(label,value){return '<div class="pr-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
  function decision(label,allowed,yes,no){return '<div class="pr-decision"><span>'+esc(label)+'</span><strong class="'+(allowed?'pr-yes':'pr-no')+'">'+esc(allowed?yes:no)+'</strong></div>';}
  function progress(label,value,limit){
    const numeric=finite(value)?Number(value):0;const maximum=finite(limit)&&Number(limit)>0?Number(limit):100;const fill=Math.max(0,Math.min(100,numeric/maximum*100));const cls=fill>=100?'danger':fill>=75?'warning':'';
    return '<div class="pr-progress-wrap"><div class="pr-progress-head"><span>'+esc(label)+'</span><strong>'+esc(percent(value))+' / '+esc(percent(limit))+'</strong></div><div class="pr-progress '+cls+'"><span style="width:'+fill.toFixed(1)+'%"></span></div></div>';
  }
  function alertTags(items,type){const values=list(items);if(!values.length)return '<span class="pr-tag ok">'+esc(tx('لا يوجد','None'))+'</span>';return values.map(item=>'<span class="pr-tag '+type+'">'+esc(message(item))+'</span>').join('');}
  function protectionClass(value){const normalized=String(value||'').toUpperCase();if(normalized==='PROTECTED')return 'good';if(normalized==='PARTIALLY_PROTECTED'||normalized==='UNVERIFIED')return 'partial';return 'bad';}
  function protectionLabel(value){const normalized=String(value||'').toUpperCase();const map={PROTECTED:tx('محمي','Protected'),PARTIALLY_PROTECTED:tx('حماية جزئية','Partially protected'),UNPROTECTED:tx('غير محمي','Unprotected'),UNVERIFIED:tx('غير متحقق','Unverified')};return map[normalized]||normalized||'—';}
  function positions(items,live){
    const rows=list(items).slice(0,20).map(item=>'<div class="pr-position"><div class="pr-position-symbol"><span>'+esc(tx('السهم','Symbol'))+'</span><strong>'+esc(item.symbol||'—')+'</strong></div><div><span>'+esc(tx('الكمية','Quantity'))+'</span><strong>'+esc(number(item.quantity,0))+'</strong></div><div><span>'+esc(tx('سعر الدخول','Entry'))+'</span><strong>'+esc(cash(item.entryPrice))+'</strong></div><div><span>'+esc(tx('السعر الحالي','Current'))+'</span><strong>'+esc(cash(item.currentPrice))+'</strong></div><div><span>'+esc(tx('القيمة السوقية','Market value'))+'</span><strong>'+esc(cash(item.marketValue))+'</strong></div><div><span>'+esc(tx('الربح غير المحقق','Unrealized P&L'))+'</span><strong class="'+(Number(item.unrealizedPnl)>=0?'pr-positive':'pr-negative')+'">'+esc(cash(item.unrealizedPnl))+'</strong></div><div><span>'+esc(tx('المخاطرة المفتوحة','Open risk'))+'</span><strong>'+esc(cash(item.openRisk))+'</strong></div><div><span>'+esc(tx('الحماية','Protection'))+'</span><strong class="pr-protection '+protectionClass(item.protectionStatus)+'">'+esc(protectionLabel(item.protectionStatus))+'</strong></div></div>').join('');
    return rows||'<div class="pr-empty">'+esc(live?tx('لا توجد مراكز مفتوحة في الحساب الحقيقي.','No open production positions.'):tx('لا توجد مراكز مفتوحة في الحساب التجريبي.','No open demo positions.'))+'</div>';
  }
  function render(risk){
    const node=panel();if(!risk){node.innerHTML='<div class="pr-empty">'+esc(tx('بيانات مخاطر المحفظة غير متاحة.','Portfolio risk data is unavailable.'))+'</div>';return;}
    const capital=risk.capital||{},daily=risk.daily||{},exposure=risk.exposure||{},protection=risk.protection||{},data=risk.capitalData||{},limits=risk.limits||{};
    const live=String(risk.accountEnvironment||risk.mode||'').toUpperCase()==='PRODUCTION'||String(risk.mode||'').toUpperCase()==='LIVE';
    const status=String(risk.status||'BLOCKED').toUpperCase();const verdict=statusText(status);const updated=new Date().toLocaleTimeString(english()?'en-US':'ar-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const pnl=Number(daily.realizedPnl||0)+Number(daily.unrealizedPnl||0);const source=(live?tx('حساب حقيقي','Production account'):tx('حساب تجريبي','Demo account'))+' · '+String(data.source||tx('غير متاح','Unavailable'))+(data.accountIdMasked?' · '+data.accountIdMasked:'');
    node.innerHTML='<div class="pr-hero"><div><div class="pr-kicker">PORTFOLIO RISK</div><h3 class="pr-title">'+esc(tx('لوحة مخاطر المحفظة','Portfolio Risk Command Panel'))+'</h3><div class="pr-subtitle">'+esc(tx('قرار واضح قبل أي صفقة جديدة، مع أموال الحساب والتعرض والحماية في مكان واحد.','A clear pre-trade decision with account capital, exposure, and protection in one place.'))+'</div><div class="pr-source '+(live?'live':'sandbox')+'">'+esc(source)+'</div><div class="pr-actions"><button class="pr-button" id="prRefresh">'+esc(tx('تحديث البيانات','Refresh data'))+'</button><span class="pr-updated">'+esc(tx('آخر تحديث','Last updated'))+': '+esc(updated)+'</span></div></div><div class="pr-verdict '+statusClass(status)+'"><strong>'+esc(verdict[0])+'</strong><span>'+esc(verdict[1])+'</span></div></div>'+ 
    '<div class="pr-decision-grid">'+decision(tx('هل يسمح بصفقة جديدة؟','New trade allowed?'),risk.portfolioAcceptsNewRisk===true,tx('نعم','Yes'),tx('لا','No'))+decision(tx('هل التنفيذ الآلي مسموح؟','Automation allowed?'),risk.automaticSubmissionAllowed===true,tx('مسلّح','Armed'),tx('متوقف','Stopped'))+decision(tx('هل بيانات الحساب حديثة؟','Account data current?'),!risk.accountStale&&data.error==null,tx('نعم','Yes'),tx('تحتاج تحديث','Refresh required'))+'</div>'+ 
    '<div class="pr-main">'+stat(tx('صافي قيمة الحساب','Net liquidation'),cash(capital.netLiquidation),tx('قيمة الحساب بعد المراكز','Account equity after positions'))+stat(tx('القوة الشرائية','Buying power'),cash(capital.dayBuyingPower),tx('المتاح للتداول اليوم','Available for day trading'))+stat(tx('التعرض المفتوح','Open exposure'),cash(exposure.grossExposure),String(exposure.openPositions||0)+' '+tx('مركز','position(s)'))+stat(tx('ربح وخسارة اليوم','Today P&L'),cash(pnl),tx('محقق وغير محقق','Realized and unrealized'),pnl>=0?'pr-positive':'pr-negative')+'</div>'+ 
    '<div class="pr-layout"><section class="pr-box"><h4>'+esc(tx('أموال الحساب','Account capital'))+'</h4><div class="pr-grid">'+metric(tx('الرصيد النقدي','Cash balance'),cash(capital.cashBalance))+metric(tx('النقد المستقر','Settled cash'),cash(capital.settledCash))+metric(tx('قوة الشراء الليلية','Overnight buying power'),cash(capital.overnightBuyingPower))+metric(tx('رأس المال المستخدم','Deployed capital'),cash(capital.deployedCapital))+metric(tx('رأس المال المحجوز','Reserved capital'),cash(capital.reservedCapital))+metric(tx('سعة الخسارة المتبقية','Remaining loss capacity'),cash(daily.remainingLossCapacity))+'</div><div class="pr-note">'+esc(tx('قراءة فقط من الحساب النشط. لا ترسل هذه اللوحة أوامر إلى الوسيط.','Read-only data from the active account. This panel never submits broker orders.'))+'</div></section>'+ 
    '<section class="pr-box"><h4>'+esc(tx('حدود المخاطر','Risk limits'))+'</h4>'+progress(tx('المخاطرة المفتوحة من قيمة الحساب','Open risk / equity'),exposure.openRiskPercentEquity,limits.maximumOpenRiskPercentEquity)+progress(tx('أكبر تركّز في سهم واحد','Largest symbol concentration'),exposure.symbolConcentrationPercent,limits.maximumSymbolConcentrationPercent)+'<div class="pr-grid" style="margin-top:12px">'+metric(tx('المخاطرة المفتوحة','Open risk'),cash(exposure.openRisk))+metric(tx('أكبر سهم','Largest symbol'),String(exposure.largestSymbol||'—'))+metric(tx('المراكز المحمية','Protected positions'),String(protection.protectedPositions??0))+metric(tx('المراكز غير المحمية','Unprotected positions'),String(protection.unprotectedPositions??0))+'</div></section></div>'+ 
    '<div class="pr-alerts"><section class="pr-alert-box"><h4>'+esc(tx('أسباب منع التنفيذ','Execution blockers'))+'</h4><div class="pr-tags">'+alertTags(risk.blockers,'blocker')+'</div></section><section class="pr-alert-box"><h4>'+esc(tx('تحذيرات تحتاج مراجعة','Warnings to review'))+'</h4><div class="pr-tags">'+alertTags(risk.warnings,'warning')+'</div></section></div>'+ 
    '<section class="pr-box pr-positions"><h4>'+esc(live?tx('المراكز الحقيقية المفتوحة','Open production positions'):tx('المراكز التجريبية المفتوحة','Open demo positions'))+'</h4><div class="pr-position-list">'+positions(risk.positions,live)+'</div></section>';
    const button=document.getElementById('prRefresh');if(button)button.onclick=refresh;
  }
  async function liveState(){try{const response=await fetch('/api/trading/live/readiness',{cache:'no-store'}),payload=await response.json();return response.ok&&payload.ok&&payload.control?.liveTradingEnabled===true&&payload.control?.killSwitch===false;}catch{return false;}}
  function controlPin(){
    if(typeof window.__getMoerandControlPin==='function')return window.__getMoerandControlPin(tx('أدخل رمز التحكم لعرض بيانات الحساب الحقيقي.','Enter the control PIN to display production account data.'));
    if(window.__portfolioRiskPin)return window.__portfolioRiskPin;
    window.__portfolioRiskPin=window.prompt(tx('أدخل رمز التحكم لعرض بيانات الحساب الحقيقي.','Enter the control PIN to display production account data.'))||'';return window.__portfolioRiskPin;
  }
  async function refresh(){
    const node=panel();node.innerHTML='<div class="pr-empty">'+esc(tx('جارٍ تحديث بيانات المخاطر...','Refreshing portfolio risk...'))+'</div>';
    try{
      const live=await liveState();const options={cache:'no-store'};
      if(live){const pin=controlPin();if(!pin){node.innerHTML='<div class="pr-empty pr-error">'+esc(tx('يلزم إدخال رمز التحكم لعرض الحساب الحقيقي.','A control PIN is required for production account data.'))+'</div>';return;}options.method='POST';options.headers={'content-type':'application/json'};options.body=JSON.stringify({pin});}
      const response=await fetch('/api/trading-intelligence/portfolio-risk',options);const payload=await response.json();
      if(!response.ok||!payload.ok){if([401,403,423].includes(response.status)&&typeof window.__clearMoerandControlPin==='function')window.__clearMoerandControlPin();throw new Error(payload.error||'Portfolio risk request failed');}
      render(payload.portfolioRisk);
    }catch(error){node.innerHTML='<div class="pr-empty pr-error">'+esc(tx('تعذر تحميل مخاطر المحفظة: ','Portfolio risk unavailable: ')+(error.message||error))+'</div>';}
  }
  panel();refresh();window.refreshPortfolioRisk=refresh;setInterval(refresh,60000);
})();
</script>`;

export async function enhancePortfolioRiskDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('portfolioRiskScript')) return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  const enhanced = html.replace('</head>', `${PORTFOLIO_STYLE}</head>`).replace('</body>', `${PORTFOLIO_SCRIPT}</body>`);
  const headers = new Headers(response.headers);headers.delete('content-length');
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers });
}
