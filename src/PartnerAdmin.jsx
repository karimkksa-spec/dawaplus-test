import React, { useEffect, useState } from 'react';
import { ClipboardList, Truck, Store, RefreshCw, MapPin, Phone, Search, UserRound } from 'lucide-react';
import Accounts from './Accounts.jsx';
import { partnerStates, partnerRoles } from './PartnerForm.jsx';
import './partners.css';

const dates = new Intl.DateTimeFormat('ar-YE', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Aden' });
const tabs = [['requests', ClipboardList, 'طلبات الانضمام'], ['captains', Truck, 'المندوبون'], ['pharmacies', Store, 'الصيدليات والكاشير']];

export default function PartnerAdmin({ api, config, refresh, notify, selectedRequest }) {
  const [tab, setTab] = useState('requests');
  const [status, setStatus] = useState('pending');
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [version, reload] = useState(0);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(null);
  const [limit, setLimit] = useState(12);

  useEffect(() => {
    let active = true;
    api('/admin/partner-applications').then(data=>{if(active){setRows(data);setError('');}})
      .catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  }, [api,version]);
  useEffect(() => {
    if (selectedRequest) {
      setTab('requests');setStatus('');setRole('');setSearch(selectedRequest);setDecision(null);reload(v=>v+1);
    }
  }, [selectedRequest]);
  useEffect(() => {setLimit(12);setDecision(null);}, [status,role,search,tab]);

  async function review(event,row) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);setError('');
    try {
      await api('/admin/partner-applications/'+row.id, {
        method:'PATCH', body:JSON.stringify({status:decision.status,reason:data.get('reason')})
      });
      setDecision(null);notify(decision.status === 'approved' ? 'تم قبول الطلب وتفعيل الحساب' : 'تم رفض الطلب وحفظ السبب');
      await refresh();
    } catch (e) {notify(e.message);}
    finally {setBusy(false);reload(v=>v+1);}
  }
  const term=search.trim().toLowerCase();
  const visible=(rows || []).filter(r=>(!status||r.status===status)&&(!role||r.role===role)&&
    [r.name,r.phone,r.pharmacy_name,r.id].some(x=>x?.toLowerCase().includes(term)));
  return <section className="partner-admin">
    <header className="partner-heading"><div><h1>إدارة الشركاء</h1><p>مراجعة طلبات الانضمام وإدارة حسابات التشغيل.</p></div><button className="soft" onClick={()=>reload(v=>v+1)} aria-label="تحديث طلبات الانضمام"><RefreshCw size={18}/>تحديث الطلبات</button></header>
    <div className="partner-stats">{Object.entries(partnerStates).map(([id,label])=><button key={id} onClick={()=>{setTab('requests');setStatus(id);setSearch('');setRole('');}}><span className={'partner-dot '+id}/><span>{label}</span><strong>{rows ? rows.filter(r=>r.status===id).length : '…'}</strong></button>)}</div>
    <nav aria-label="إدارة الشركاء" className="partner-tabs">{tabs.map(([key,Icon,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}><Icon size={18}/>{label}</button>)}</nav>
    {tab === 'pharmacies' ? <Accounts api={api} config={config} refresh={refresh} notify={notify}/> :
      tab === 'captains' ? <CaptainDirectory api={api} refresh={refresh} notify={notify}/> : <>
      <div className="partner-filters">
        <label className="partner-search"><Search size={17}/><input aria-label="بحث في الطلبات" placeholder="ابحث بالاسم أو رقم الهاتف" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <select aria-label="نوع الشريك" value={role} onChange={e=>setRole(e.target.value)}><option value="">كل الشركاء</option>{Object.entries(partnerRoles).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select>
        <select aria-label="حالة الطلب" value={status} onChange={e=>setStatus(e.target.value)}><option value="">كل الحالات</option>{Object.entries(partnerStates).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select>
      </div>
      {error && <p role="alert" className="partner-error">{error}</p>}
      {!rows && !error && <p role="status">جارٍ تحميل الطلبات…</p>}
      {rows && !visible.length && <p className="partner-empty">لا توجد طلبات تطابق الاختيار.</p>}
      <div className="partner-list">{visible.slice(0,limit).map(row=><article key={row.id} className="partner-card">
        <header><div><small>{partnerRoles[row.role]}</small><h3>{row.pharmacy_name || row.name}</h3></div><span className={'partner-chip '+row.status}>{partnerStates[row.status]}</span></header>
        {row.pharmacy_name && <p><UserRound size={16}/>{row.name}</p>}
        <p><Phone size={16}/><bdi>{row.phone}</bdi></p><p><MapPin size={16}/>{[row.zone_name,row.address].filter(Boolean).join('، ')}</p>
        <small>تاريخ التقديم · {dates.format(new Date(row.created_at))}</small>
        {row.status !== 'pending' && <div className="partner-review-log"><small>راجعه {row.reviewer} · {dates.format(new Date(row.reviewed_at))}</small>{row.reason && <p>سبب الرفض · {row.reason}</p>}</div>}
        {row.status === 'pending' && (decision?.id === row.id ?
          <form className="partner-decision" onSubmit={e=>review(e,row)}>
            {decision.status === 'rejected' ? <label>سبب الرفض الذي سيظهر لمقدم الطلب<textarea name="reason" required minLength={2} maxLength={350}/></label> :
              <p>سيُفعّل حساب {row.pharmacy_name || row.name} برقم <bdi>{row.phone}</bdi>.</p>}
            <div className="partner-actions"><button className="primary" disabled={busy}>{decision.status==='approved'?'تأكيد القبول والتفعيل':'تأكيد الرفض'}</button><button type="button" className="soft" disabled={busy} onClick={()=>setDecision(null)}>تراجع</button></div>
          </form> : <div className="partner-actions"><button className="primary" disabled={busy} onClick={()=>setDecision({id:row.id,status:'approved'})}>قبول الطلب</button><button className="soft" disabled={busy} onClick={()=>setDecision({id:row.id,status:'rejected'})}>رفض الطلب</button></div>)}
      </article>)}</div>
      {visible.length>limit && <button className="soft" onClick={()=>setLimit(n=>n+12)}>عرض المزيد</button>}
    </>}
  </section>;
}

function CaptainDirectory({api, refresh, notify}) {
  const [rows,setRows]=useState(null),[version,reload]=useState(0),[busy,setBusy]=useState(false);
  const [creating,setCreating]=useState(false),[credential,setCredential]=useState(null),[error,setError]=useState('');
  const [query,setQuery]=useState('');
  useEffect(()=>{
    let active=true;
    api('/admin/captain-accounts').then(r=>{if(active){setRows(r);setError('');}}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[api,version]);
  async function save(id,data) {
    if (busy) return;
    setBusy(true);setError('');setCredential(null);
    try {
      const result=await api('/admin/captain-accounts'+(id?'/'+id:''),{method:id?'PATCH':'POST',body:JSON.stringify(data)});
      setCreating(false);if(result.password)setCredential(result);notify('تم حفظ حساب المندوب');reload(v=>v+1);await refresh();
    } catch(e){setError(e.message);}
    finally{setBusy(false);}
  }
  const visible=(rows||[]).filter(r=>r.name.includes(query.trim())||r.phone.includes(query.trim()));
  return <section>
    <div className="partner-heading"><h2>حسابات المندوبين</h2><button className="primary" onClick={()=>{setCreating(true);setCredential(null);}}>إنشاء حساب مندوب</button></div>
    {creating && <form className="partner-card partner-form" onSubmit={e=>{e.preventDefault();save(null,Object.fromEntries(new FormData(e.currentTarget)));}}>
      <label>اسم المندوب<input name="name" required minLength={2} maxLength={80}/></label><label>رقم الهاتف<input name="phone" dir="ltr" type="tel" required maxLength={14}/></label>
      <div className="partner-actions"><button className="primary" disabled={busy}>إنشاء وتفعيل</button><button className="soft" type="button" onClick={()=>setCreating(false)}>إلغاء</button></div>
    </form>}
    {credential && <div className="partner-card" role="status"><h3>بيانات دخول المندوب</h3><p>رقم الهاتف <bdi>{credential.phone}</bdi></p><p>كلمة المرور <bdi>{credential.password}</bdi></p><small>احفظ كلمة المرور الآن. تظهر مرة واحدة.</small><button className="soft" onClick={()=>setCredential(null)}>إخفاء</button></div>}
    {error && <p role="alert" className="partner-error">{error}</p>}
    <input aria-label="بحث في المندوبين" placeholder="ابحث باسم المندوب أو رقمه" value={query} onChange={e=>setQuery(e.target.value)}/>
    {!rows && !error && <p role="status">جارٍ تحميل الحسابات…</p>}
    {rows && !visible.length && <p className="partner-empty">لا توجد حسابات مطابقة.</p>}
    <div className="partner-list">{visible.map(r=><article key={r.id} className="partner-card">
      <header><h3>{r.name}</h3><span className={'partner-chip '+(r.active?'approved':'rejected')}>{r.active?'مفعّل':'موقوف'}</span></header>
      <p><Phone size={16}/><bdi>{r.phone}</bdi></p><p><Truck size={16}/>التوصيلات الجارية · {r.active_orders}</p>
      <div className="partner-actions"><button className="soft" disabled={busy || (!!r.active && Number(r.active_orders)>0)} onClick={()=>{if(window.confirm((r.active?'إيقاف حساب ':'تفعيل حساب ')+r.name+'؟'))save(r.id,{active:!r.active});}}>{r.active?'إيقاف الحساب':'تفعيل الحساب'}</button>
      <button className="soft" disabled={busy} onClick={()=>{if(window.confirm('تغيير كلمة المرور وإغلاق جلسات '+r.name+'؟'))save(r.id,{reset:true});}}>إعادة تعيين كلمة المرور</button></div>
    </article>)}</div>
  </section>;
}
