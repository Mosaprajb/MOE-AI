import { MOBILE_ASSET_VERSION } from './tradingview-only-passkey-token.js';

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pageCss() {
  return `
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--bg:#050713;--card:#12162f;--card2:#1a2142;--line:#435184;--text:#f7f8ff;--muted:#aeb8da;--accent:#6478ff;--accent2:#be66ff;--danger:#ff7994}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 20% -10%,rgba(100,120,255,.24),transparent 38%),radial-gradient(circle at 100% 8%,rgba(190,102,255,.18),transparent 32%),var(--bg);color:var(--text)}
main{width:min(100%,440px);padding:30px 24px;border:1px solid rgba(119,139,222,.42);border-radius:28px;background:linear-gradient(145deg,rgba(100,120,255,.10),rgba(190,102,255,.06)),var(--card);box-shadow:0 28px 80px rgba(0,0,0,.46)}
.face{display:grid;place-items:center;width:68px;height:68px;margin:0 auto 18px;border-radius:22px;background:linear-gradient(135deg,var(--accent),var(--accent2));font-size:34px;box-shadow:0 16px 34px rgba(100,120,255,.32)}
h1{margin:0 0 10px;font-size:28px;letter-spacing:-.4px}p{margin:0;color:var(--muted);line-height:1.7}
button,.button{width:100%;min-height:58px;display:grid;place-items:center;margin-top:16px;border:0;border-radius:17px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-size:17px;font-weight:900;text-decoration:none;touch-action:manipulation;-webkit-appearance:none;appearance:none;cursor:pointer;box-shadow:0 14px 30px rgba(100,120,255,.26)}
button.secondary,.button.secondary{background:var(--card2);border:1px solid var(--line);box-shadow:none;color:var(--text)}button:disabled{opacity:.6;cursor:wait}
form{margin-top:16px}label{display:block;margin:0 0 8px;font-weight:800}input{width:100%;min-height:56px;padding:12px 15px;border:1px solid var(--line);border-radius:16px;background:#0b1024;color:#fff;font-size:20px;text-align:center;letter-spacing:3px;-webkit-appearance:none;appearance:none}
details{margin-top:18px;padding-top:14px;border-top:1px solid rgba(119,139,222,.25)}summary{cursor:pointer;color:var(--muted);font-weight:800;text-align:center;list-style:none}summary::-webkit-details-marker{display:none}
.message{min-height:22px;margin-top:14px;color:var(--muted);text-align:center;line-height:1.5}.message.error{color:var(--danger)}.note{margin-top:18px;font-size:12px;text-align:center;color:#7f8bad;line-height:1.6}
`;
}

function browserHelpers() {
  return `
function decode64(value){var n=String(value||'').replace(/-/g,'+').replace(/_/g,'/');n+='='.repeat((4-(n.length%4||4))%4);var b=atob(n),o=new Uint8Array(b.length);for(var i=0;i<b.length;i+=1)o[i]=b.charCodeAt(i);return o}
function encode64(value){var a=value instanceof Uint8Array?value:new Uint8Array(value||[]),b='';for(var i=0;i<a.length;i+=1)b+=String.fromCharCode(a[i]);return btoa(b).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/g,'')}
function message(text,error){var n=document.getElementById('message');if(!n)return;n.textContent=text||'';n.className=error?'message error':'message'}
async function readJson(response){var data=await response.json().catch(function(){return {}});if(!response.ok||data.ok===false)throw new Error(data.error||('HTTP '+response.status));return data}
`;
}

function pinForm() {
  return `<form method="post" action="/mobile/unlock" autocomplete="off">
<label for="pin">الرمز السري الاحتياطي</label>
<input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required>
<button class="secondary" type="submit">الدخول بواسطة الرمز السري</button>
</form>`;
}

export function loginPageHtml(hasPasskey, error = '') {
  const errors = {
    wrong: 'الرمز السري غير صحيح. أعد المحاولة.',
    session: 'تعذر إنشاء جلسة آمنة. أعد تحميل الصفحة.',
    request: 'تم رفض طلب الدخول. أعد تحميل الصفحة.',
  };
  const errorText = errors[error] || '';
  const controls = hasPasskey
    ? `<button id="faceIdButton" type="button">الدخول باستخدام Face ID</button>
<details><summary>استخدام الرمز السري بدلًا من Face ID</summary>${pinForm()}</details>`
    : `${pinForm()}<div class="note">بعد الدخول مرة واحدة بالرمز سيطلب منك iPhone تفعيل Face ID للدخول القادم.</div>`;
  const script = hasPasskey ? `<script>
${browserHelpers()}
(function(){
var button=document.getElementById('faceIdButton');
button.addEventListener('click',async function(){
 if(!window.PublicKeyCredential||!navigator.credentials){message('افتح الصفحة في Safari لاستخدام Face ID.',true);return}
 button.disabled=true;button.textContent='جاري التحقق بواسطة Face ID…';message('',false);
 try{
  var options=await readJson(await fetch('/api/mobile/passkey/login/options',{cache:'no-store',credentials:'same-origin'}));
  options.publicKey.challenge=decode64(options.publicKey.challenge);
  options.publicKey.allowCredentials=(options.publicKey.allowCredentials||[]).map(function(item){return Object.assign({},item,{id:decode64(item.id)})});
  var credential=await navigator.credentials.get({publicKey:options.publicKey});
  var payload={token:options.token,credential:{id:credential.id,rawId:encode64(credential.rawId),type:credential.type,response:{clientDataJSON:encode64(credential.response.clientDataJSON),authenticatorData:encode64(credential.response.authenticatorData),signature:encode64(credential.response.signature),userHandle:credential.response.userHandle?encode64(credential.response.userHandle):null}}};
  await readJson(await fetch('/api/mobile/passkey/login/complete',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));
  window.location.replace('/mobile?unlocked=1&v=${MOBILE_ASSET_VERSION}');
 }catch(error){message(error&&error.name==='NotAllowedError'?'لم يكتمل التحقق بواسطة Face ID. استخدم الرمز السري عند الحاجة.':String(error&&error.message||error),true)}
 finally{button.disabled=false;button.textContent='الدخول باستخدام Face ID'}
});
}());
</script>` : '';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#12162f"><title>MOE-AI — الدخول</title><style>${pageCss()}</style></head><body><main><div class="face" aria-hidden="true">◉</div><h1>الدخول إلى MOE-AI</h1><p>${hasPasskey ? 'استخدم Face ID لفتح لوحة التحكم. يبقى الرمز السري متاحًا فقط كخيار احتياطي.' : 'أدخل الرمز السري مرة واحدة لإعداد الدخول الآمن بواسطة Face ID.'}</p>${controls}<div id="message" class="message ${errorText ? 'error' : ''}" role="status">${escapeHtml(errorText)}</div><div class="note">MOE-AI لا يستلم صورة وجهك. التحقق يتم داخل iPhone.</div></main>${script}</body></html>`;
}

export function setupPageHtml(destination) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#12162f"><title>MOE-AI — تفعيل Face ID</title><style>${pageCss()}</style></head><body><main><div class="face" aria-hidden="true">◉</div><h1>فعّل الدخول بواسطة Face ID</h1><p>تم قبول الرمز السري. اضغط الزر مرة واحدة ليُنشئ iPhone مفتاح دخول آمنًا للمرات القادمة.</p><button id="setupButton" type="button">تفعيل Face ID الآن</button><a class="button secondary" href="${escapeHtml(destination)}">المتابعة الآن بالرمز السري فقط</a><div id="message" class="message" role="status"></div><div class="note">يمكن أن يعرض iPhone رمز الجهاز بدل Face ID وفق إعدادات النظام.</div></main><script>
${browserHelpers()}
(function(){
var button=document.getElementById('setupButton');
button.addEventListener('click',async function(){
 if(!window.PublicKeyCredential||!navigator.credentials){message('افتح الصفحة في Safari لتفعيل Face ID.',true);return}
 button.disabled=true;button.textContent='جاري تفعيل Face ID…';message('',false);
 try{
  var options=await readJson(await fetch('/api/mobile/passkey/register/options',{cache:'no-store',credentials:'same-origin'}));
  options.publicKey.challenge=decode64(options.publicKey.challenge);options.publicKey.user.id=decode64(options.publicKey.user.id);
  options.publicKey.excludeCredentials=(options.publicKey.excludeCredentials||[]).map(function(item){return Object.assign({},item,{id:decode64(item.id)})});
  var credential=await navigator.credentials.create({publicKey:options.publicKey}),response=credential.response;
  if(typeof response.getPublicKey!=='function'||typeof response.getAuthenticatorData!=='function')throw new Error('حدّث iOS وافتح الصفحة في Safari لتفعيل Face ID.');
  var publicKey=response.getPublicKey(),authData=response.getAuthenticatorData();if(!publicKey||!authData)throw new Error('تعذر قراءة مفتاح Face ID من iPhone.');
  var payload={token:options.token,credential:{id:credential.id,rawId:encode64(credential.rawId),type:credential.type,response:{clientDataJSON:encode64(response.clientDataJSON),authenticatorData:encode64(authData),publicKey:encode64(publicKey),algorithm:response.getPublicKeyAlgorithm(),transports:typeof response.getTransports==='function'?response.getTransports():[]}}};
  await readJson(await fetch('/api/mobile/passkey/register/complete',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));
  message('تم تفعيل Face ID بنجاح.',false);setTimeout(function(){window.location.replace('${escapeHtml(destination)}')},450);
 }catch(error){message(error&&error.name==='NotAllowedError'?'تم إلغاء تفعيل Face ID. يمكنك المتابعة بالرمز السري.':String(error&&error.message||error),true)}
 finally{button.disabled=false;button.textContent='تفعيل Face ID الآن'}
});
}());
</script></body></html>`;
}
