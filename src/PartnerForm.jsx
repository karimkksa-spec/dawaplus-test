import React, { useState } from 'react';
import { Clock, CheckCircle2, CircleAlert } from 'lucide-react';

export const partnerStates = { pending:'قيد المراجعة', approved:'مقبول', rejected:'مرفوض' };
export const partnerRoles = { captain:'مندوب توصيل', pharmacy:'صيدلية' };

export default function PartnerForm({ role, mode, setMode, zones, api, onLogin, onClose }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const apply = mode === 'apply';
  function switchMode(next) {
    setResult(null);
    setError('');
    setMode(next);
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      setResult(await api(apply ? '/partners/apply' : '/partners/status', {
        method:'POST', body:JSON.stringify({ ...values, role })
      }));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (result) {
    const Icon = {pending:Clock, approved:CheckCircle2, rejected:CircleAlert}[result.status];
    return <div className="partner-result" role="status">
      <Icon size={32} aria-hidden="true" />
      <h3>{result.status === 'pending' ? 'طلبك قيد مراجعة الإدارة' : result.status === 'approved' ? 'تم قبول طلبك' : 'لم تتم الموافقة على الطلب'}</h3>
      <p>{result.status === 'approved' ? 'يمكنك الدخول إلى حسابك برقم الهاتف وكلمة المرور.' :
        result.status === 'rejected' ? result.reason : 'يمكنك الرجوع إلى «متابعة طلب الانضمام» بنفس رقم الهاتف وكلمة المرور لمعرفة القرار.'}</p>
      {result.status === 'approved' && <button className="primary" onClick={onLogin}>تسجيل الدخول</button>}
      {result.status === 'rejected' && <button className="primary" onClick={()=>switchMode('apply')}>تقديم طلب جديد</button>}
      <button className="soft" onClick={onClose}>إغلاق</button>
    </div>;
  }
  return <form key={mode} className="partner-form" onSubmit={submit}>
    <p>{apply ? 'تراجع الإدارة بياناتك قبل تفعيل حساب ' + partnerRoles[role] + '.' : 'أدخل بيانات طلب الانضمام للاطلاع على قرار الإدارة.'}</p>
    {apply && <>
      <label>{role === 'pharmacy' ? 'اسم المسؤول عن الصيدلية' : 'اسم المندوب'}<input name="name" autoComplete="name" required minLength={2} maxLength={80}/></label>
      {role === 'pharmacy' && <label>اسم الصيدلية<input name="pharmacyName" required minLength={2} maxLength={120}/></label>}
      <label>منطقة الخدمة<select name="zoneId" defaultValue="" required><option value="" disabled>اختر المنطقة</option>{zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
      {role === 'pharmacy' && <label>عنوان الصيدلية<input name="address" required minLength={2} maxLength={250} placeholder="الحي والشارع وأقرب معلم"/></label>}
    </>}
    <label>رقم الهاتف<input name="phone" dir="ltr" type="tel" placeholder="7xxxxxxxx" autoComplete="tel" required maxLength={14}/></label>
    <label>كلمة المرور<input name="password" type="password" autoComplete={apply ? 'new-password' : 'current-password'} minLength={apply ? 10 : 1} maxLength={128} required/></label>
    {apply && <small>استخدم 10 أحرف على الأقل. ستدخل بنفس كلمة المرور بعد الموافقة.</small>}
    {error && <p role="alert" className="partner-error">{error}</p>}
    <button className="primary wide" disabled={busy}>{busy ? 'جارٍ التحميل…' : apply ? 'إرسال طلب الانضمام' : 'عرض حالة الطلب'}</button>
    <button type="button" className="soft wide" disabled={busy} onClick={()=>switchMode(apply ? 'status' : 'apply')}>{apply ? 'سبق أن قدمت طلبًا؟ متابعة الطلب' : 'تقديم طلب انضمام جديد'}</button>
  </form>;
}
