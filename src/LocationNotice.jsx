import React,{useState} from 'react';
import {MapPin,X} from 'lucide-react';
import {requestLocation} from './location-request.mjs';

export default function LocationNotice({onPoint}) {
 const [open,setOpen]=useState(()=>sessionStorage.getItem('dawa-location-dismissed')!=='1');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 function dismiss(){sessionStorage.setItem('dawa-location-dismissed','1');setOpen(false);}
 async function locate(){
  setBusy(true);
  try {const result=await requestLocation();if(result.point){onPoint(result.point);dismiss();}else setMessage(result.error);}
  catch {setMessage('تعذر تحديد الموقع. يمكنك اختياره من خريطة الطلب لاحقًا.');}
  finally {setBusy(false);}
 }
 if(!open)return null;
 return <section className="location-notice" aria-label="تحديد الموقع اختياري">
  <MapPin size={22} aria-hidden="true"/>
  <div className="location-notice-copy"><strong>حدّد موقع التوصيل بسهولة</strong><p>اختياري — يمكنك التصفح الآن واختيار الموقع عند الطلب.</p>{message&&<p role="status">{message}</p>}</div>
  <div className="location-notice-actions"><button type="button" className="primary" onClick={locate} disabled={busy}>{busy?'جارٍ تحديد الموقع…':'تحديد موقعي'}</button><button type="button" className="soft" onClick={dismiss}>لاحقًا</button></div>
  <button type="button" className="icon-button" aria-label="إغلاق اقتراح الموقع" onClick={dismiss}><X size={18}/></button>
 </section>;
}
