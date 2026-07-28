// MOE-AI Settings Page
import { useState } from 'react';
import { LS_SETTINGS } from '../lib/config';
import { setPin, hasPinSet } from '../lib/auth';
import type { TradingMode } from '../lib/config';

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="panel-title" style={{ marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

export default function SettingsPage({ showToast }: Props) {
  const [apiBase, setApiBase] = useState(() =>
    localStorage.getItem('moe-api-base') ?? 'https://moerand-alerts.mosaprajb.workers.dev'
  );
  const [newPin,  setNewPin]  = useState('');
  const [confPin, setConfPin] = useState('');
  const [notifs,  setNotifs]  = useState(false);
  const [savingPin, setSavingPin] = useState(false);

  const saveApiBase = () => {
    localStorage.setItem('moe-api-base', apiBase.trim().replace(/\/$/, ''));
    showToast('تم حفظ رابط API · أعد تحميل الصفحة', 'success');
  };

  const handlePinSave = async () => {
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      showToast('رمز PIN يجب أن يكون 6 أرقام', 'error'); return;
    }
    if (newPin !== confPin) {
      showToast('رمزا PIN غير متطابقَين', 'error'); return;
    }
    setSavingPin(true);
    await setPin(newPin);
    setSavingPin(false);
    setNewPin(''); setConfPin('');
    showToast('تم حفظ رمز PIN بنجاح ✓', 'success');
  };

  const saveSettings = (key: string, val: unknown) => {
    const current = JSON.parse(localStorage.getItem(LS_SETTINGS) ?? '{}');
    localStorage.setItem(LS_SETTINGS, JSON.stringify({ ...current, [key]: val }));
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">الإعدادات</div>
        <div className="page-sub">إعدادات MOE-AI الشخصية</div>
      </div>

      {/* API Connection */}
      <Section title="اتصال Cloudflare Worker">
        <div style={{ marginBottom: 8 }}>
          <div className="input-label">رابط Worker API</div>
          <div className="input-group">
            <input className="input" value={apiBase}
              onChange={e => setApiBase(e.target.value)}
              placeholder="https://moerand-alerts.mosaprajb.workers.dev" />
            <button className="btn btn-primary" onClick={saveApiBase}>حفظ</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            يمكن تغيير هذا الرابط لاستخدام Worker مختلف. يتطلب إعادة تحميل الصفحة.
          </div>
        </div>
      </Section>

      {/* Security */}
      <Section title="الأمان">
        <div className="setting-row">
          <div className="setting-info">
            <b>رمز PIN</b>
            <small>{hasPinSet() ? 'رمز PIN مضبوط ✓' : 'لم يتم ضبط رمز PIN بعد'}</small>
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div className="input-label">رمز PIN الجديد (6 أرقام)</div>
            <input className="input" type="password" maxLength={6} value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g,'').slice(0,6))}
              placeholder="••••••" />
          </div>
          <div>
            <div className="input-label">تأكيد رمز PIN</div>
            <input className="input" type="password" maxLength={6} value={confPin}
              onChange={e => setConfPin(e.target.value.replace(/\D/g,'').slice(0,6))}
              placeholder="••••••" />
          </div>
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }}
          onClick={handlePinSave} disabled={savingPin || newPin.length < 6}>
          {savingPin ? 'جاري الحفظ…' : 'حفظ رمز PIN'}
        </button>
      </Section>

      {/* Notifications */}
      <Section title="الإشعارات">
        <div className="setting-row">
          <div className="setting-info">
            <b>إشعارات الويب</b>
            <small>استقبال إشعارات الإشارات عبر المتصفح</small>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={notifs} onChange={e => {
              setNotifs(e.target.checked);
              if (e.target.checked) {
                Notification.requestPermission().then(p => {
                  if (p !== 'granted') { setNotifs(false); showToast('لم يتم منح إذن الإشعارات', 'error'); }
                  else { showToast('تم تفعيل الإشعارات ✓', 'success'); saveSettings('notifications', true); }
                });
              }
            }} />
            <div className="toggle-track" />
            <div className="toggle-thumb" />
          </label>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <b>حالة الإشعارات</b>
            <small>{typeof Notification !== 'undefined' ? `الإذن: ${Notification.permission}` : 'غير مدعوم'}</small>
          </div>
          <span className={`badge ${Notification?.permission === 'granted' ? 'badge-green' : 'badge-yellow'}`}>
            {Notification?.permission ?? 'غير مدعوم'}
          </span>
        </div>
      </Section>

      {/* Webull info */}
      <Section title="Webull API">
        <div style={{ padding: '12px 0', color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
          بيانات اعتماد Webull يجب تخزينها في <b style={{ color: 'var(--cyan)' }}>Cloudflare Secrets</b> وليس هنا.<br />
          <b>لا تُدخل</b> أي مفتاح API في هذا النموذج — استخدم Cloudflare Dashboard أو Wrangler CLI.
          <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 11 }}>
            <div style={{ marginBottom: 8, fontWeight: 700, color: 'var(--green)' }}>المفاتيح المطلوبة في Cloudflare Secrets:</div>
            {['WEBULL_LIVE_APP_KEY','WEBULL_LIVE_APP_SECRET','WEBULL_LIVE_ACCESS_TOKEN','WEBULL_LIVE_ACCOUNT_ID','MOE_WEBHOOK_SECRET'].map(k => (
              <div key={k} style={{ marginTop: 4 }}>• {k}</div>
            ))}
          </div>
        </div>
      </Section>

      {/* System info */}
      <Section title="معلومات النظام">
        {[
          { k: 'إصدار MOE-AI',    v: '4.0' },
          { k: 'محرك الاستراتيجية', v: 'MOE v6.3.1' },
          { k: 'نمط التشغيل',    v: 'Single-Owner Personal Platform' },
          { k: 'البنية التحتية',  v: 'Cloudflare Workers + D1 + KV + Queues' },
          { k: 'الوسيط',          v: 'Webull (Sandbox + Live)' },
        ].map(item => (
          <div key={item.k} className="setting-row">
            <div className="setting-info"><b>{item.k}</b></div>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>{item.v}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}
