const signals=[
{symbol:'ASTS',name:'AST SpaceMobile',signal:'BUY NOW',type:'BUY',price:63.42,stop:62.78,target:65.15,score:94,reason:'Continuation'},
{symbol:'SOFI',name:'SoFi Technologies',signal:'BUY AGAIN',type:'BUY',price:17.68,stop:17.41,target:18.24,score:89,reason:'Pullback'},
{symbol:'NVDA',name:'NVIDIA',signal:'WATCH',type:'WATCH',price:208.30,stop:206.90,target:211.60,score:83,reason:'Compression'},
{symbol:'INTC',name:'Intel',signal:'SELL NOW',type:'SELL',price:41.18,stop:41.72,target:40.15,score:91,reason:'Trailing Stop'},
{symbol:'RKLB',name:'Rocket Lab',signal:'BUY NOW',type:'BUY',price:36.55,stop:35.94,target:38.10,score:87,reason:'Breakout'},
{symbol:'PLTR',name:'Palantir',signal:'WATCH',type:'WATCH',price:143.10,stop:141.25,target:146.80,score:80,reason:'Reclaim'}
];
let currentFilter='ALL';
const $=s=>document.querySelector(s);
function fmt(n){return '$'+Number(n).toFixed(2)}
function render(){
 const strong=$('#strongOnly').checked;
 const list=signals.filter(s=>(currentFilter==='ALL'||s.type===currentFilter)&&(!strong||s.score>=85));
 $('#signalList').innerHTML=list.map(s=>`<article class="signal" data-symbol="${s.symbol}">
 <div class="symbol"><strong>${s.symbol}</strong><small>${s.name}</small></div>
 <div><span class="badge ${s.type.toLowerCase()}">${s.signal}</span></div>
 <div class="metric"><small>السعر</small><b>${fmt(s.price)}</b></div>
 <div class="metric"><small>الستوب</small><b>${fmt(s.stop)}</b></div>
 <div class="metric"><small>الهدف</small><b>${fmt(s.target)}</b></div>
 <div class="score-cell"><small>${s.score}/100</small><div class="score"><i style="width:${s.score}%"></i></div></div>
 </article>`).join('')||'<div class="empty">لا توجد إشارات تطابق الفلتر الحالي.</div>';
 document.querySelectorAll('.signal').forEach(el=>el.onclick=()=>showTrade(el.dataset.symbol));
 $('#buyCount').textContent=signals.filter(s=>s.type==='BUY').length;
 $('#sellCount').textContent=signals.filter(s=>s.type==='SELL').length;
 $('#avgScore').textContent=Math.round(signals.reduce((a,b)=>a+b.score,0)/signals.length);
 $('#watchCount').textContent=signals.length;
}
function showTrade(symbol){const s=signals.find(x=>x.symbol===symbol);$('#tradeEmpty').classList.add('hidden');const box=$('#tradeDetails');box.classList.remove('hidden');box.innerHTML=`<div><small>السهم</small><b>${s.symbol}</b></div><div><small>الإشارة</small><b>${s.signal}</b></div><div><small>الدخول</small><b>${fmt(s.price)}</b></div><div><small>الستوب</small><b>${fmt(s.stop)}</b></div><div><small>الهدف</small><b>${fmt(s.target)}</b></div><div><small>القوة</small><b>${s.score}/100</b></div><div><small>نوع الفرصة</small><b>${s.reason}</b></div><div><small>R/R تقريبي</small><b>${(Math.abs(s.target-s.price)/Math.max(.01,Math.abs(s.price-s.stop))).toFixed(2)}</b></div>`}
$('#filters').onclick=e=>{if(!e.target.dataset.filter)return;document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));e.target.classList.add('active');currentFilter=e.target.dataset.filter;render()};
$('#strongOnly').onchange=render;
$('#refreshBtn').onclick=()=>{signals.forEach(s=>{s.price=+(s.price*(1+(Math.random()-.5)*.002)).toFixed(2)});$('#lastUpdated').textContent='آخر تحديث: '+new Date().toLocaleTimeString('ar-US');render()};
$('#notifyBtn').onclick=async()=>{if(!('Notification'in window)){alert('المتصفح لا يدعم التنبيهات.');return}const p=await Notification.requestPermission();if(p==='granted'){new Notification('MOE AI',{body:'تم تفعيل تنبيهات النسخة التجريبية بنجاح.'});$('#notifyBtn').textContent='التنبيهات مفعّلة'}else alert('لم يتم السماح بالتنبيهات.')};
setInterval(()=>$('#clock').textContent=new Date().toLocaleTimeString('ar-US'),1000);
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
render();
