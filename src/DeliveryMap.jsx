import React,{useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {MapPin,Navigation,LocateFixed,Radio,Square,ExternalLink} from 'lucide-react';
import './maps.css';
const aden=[12.82,45.015];
const inAden=p=>p.lat>=12.65&&p.lat<=13.05&&p.lng>=44.6&&p.lng<=45.2;
const geoMessage=e=>e.code===1?'لم يُسمح بالوصول للموقع. فعّل إذن الموقع من إعدادات المتصفح.':e.code===3?'تأخر تحديد الموقع. حاول قرب نافذة أو اختر النقطة على الخريطة.':'تعذر تحديد موقع الجهاز. تحقق من تشغيل خدمة الموقع.';
const secure=()=>window.isSecureContext&&!!navigator.geolocation;
const google=p=>'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(p.lat+','+p.lng)+'&travelmode=driving';
function MapCanvas({point,courier,onPick}){
 const element=useRef(null),map=useRef(null),marker=useRef(null),vehicle=useRef(null),pick=useRef(onPick),previous=useRef('');
 const [failed,setFailed]=useState(false);pick.current=onPick;
 const currentPoint=useRef(point);currentPoint.current=point;
 useEffect(()=>{
  const m=L.map(element.current,{scrollWheelZoom:false}).setView(point?[point.lat,point.lng]:aden,13);map.current=m;
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}).addTo(m);
  tiles.on('tileerror',()=>setFailed(true));tiles.on('tileload',()=>setFailed(false));
  m.on('click',e=>pick.current?.({lat:e.latlng.lat,lng:e.latlng.lng}));
  const observer=new ResizeObserver(()=>m.invalidateSize());observer.observe(element.current);
  return()=>{observer.disconnect();m.remove();map.current=null;marker.current=null;vehicle.current=null;};
 },[]);
 useEffect(()=>{
  const m=map.current;if(!m)return;
  if(point){
   const ll=[point.lat,point.lng];
   if(!marker.current)marker.current=L.marker(ll,{draggable:!!onPick,icon:L.divIcon({className:'delivery-pin',html:'<span>+</span>',iconSize:[34,42],iconAnchor:[17,42]}),title:'نقطة التسليم'}).addTo(m).on('dragend',()=>{const p=marker.current.getLatLng();pick.current?.({lat:p.lat,lng:p.lng});marker.current.setLatLng([currentPoint.current.lat,currentPoint.current.lng]);});else marker.current.setLatLng(ll);
   const key=ll.join(',');if(previous.current!==key){m.panTo(ll);previous.current=key;}
  }
  if(courier){const ll=[courier.lat,courier.lng];if(!vehicle.current)vehicle.current=L.circleMarker(ll,{radius:10,color:'#fff',weight:3,fillColor:'#236fe8',fillOpacity:1}).addTo(m).bindTooltip('آخر موقع للكابتن');else vehicle.current.setLatLng(ll);}
  else if(vehicle.current){vehicle.current.remove();vehicle.current=null;}
 },[point?.lat,point?.lng,courier?.lat,courier?.lng]);
 function fit(){const m=map.current;if(!m)return;if(point&&courier)m.fitBounds([[point.lat,point.lng],[courier.lat,courier.lng]],{padding:[32,32],maxZoom:16});else if(point)m.setView([point.lat,point.lng],16);}
 return <><div ref={element} className="delivery-map" role="region" aria-label={onPick?'خريطة اختيار موقع التسليم':'خريطة التسليم وموقع الكابتن'}/>{failed&&<p role="alert" className="map-warning">تعذر تحميل بعض أجزاء الخريطة. تحقق من اتصال الإنترنت.</p>}{point&&<button type="button" className="map-fit" onClick={fit}><LocateFixed size={16}/>{courier?'إظهار موقع التسليم والكابتن':'التركيز على نقطة التسليم'}</button>}</>;
}
export function LocationPicker({value,onChange}){
 const [message,setMessage]=useState(''),[loading,setLoading]=useState(false);
 function choose(p){if(!inAden(p)){setMessage('هذه النقطة خارج نطاق عدن التجريبي. اختر نقطة داخل المدينة.');return;}setMessage('');onChange(p);}
 function locate(){
  if(!secure()){setMessage('تحديد GPS يحتاج رابط HTTPS. يمكنك الآن اختيار موقعك يدويًا بالضغط على الخريطة.');return;}
  setLoading(true);navigator.geolocation.getCurrentPosition(p=>{setLoading(false);choose({lat:p.coords.latitude,lng:p.coords.longitude});},e=>{setLoading(false);setMessage(geoMessage(e));},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
 }
 return <section className="location-picker"><div className="map-heading"><span><MapPin size={19}/>حدّد باب المبنى على الخريطة</span><b>مطلوب</b></div><p>اضغط على مكان التسليم. يمكنك تحريك العلامة لتصحيح النقطة.</p><MapCanvas point={value} onPick={choose}/><button className="soft wide" type="button" disabled={loading} onClick={locate}><LocateFixed size={18}/>{loading?'جارٍ تحديد الموقع…':'استخدام موقع جهازي'}</button>{message&&<p role="alert" className="map-warning">{message}</p>}<div className={'pin-confirm '+(value?'selected':'')}><MapPin size={17}/>{value?<span>تم تحديد نقطة التسليم <small dir="ltr">{value.lat.toFixed(6)}, {value.lng.toFixed(6)}</small></span>:'لم تحدد نقطة بعد — الخريطة تعرض عدن فقط'}</div><small className="muted">تحقق من النقطة والمنطقة المختارة قبل التأكيد؛ وصف المعلم اختياري.</small></section>;
}
function CaptainSharing({order,api}){
 const [sharing,setSharing]=useState(false),[message,setMessage]=useState(''),watch=useRef(null),generation=useRef(0),last=useRef(0),queue=useRef(Promise.resolve());
 const active=['assigned','picked_up','on_the_way','arrived'].includes(order.status);
 function send(body){const result=queue.current.catch(()=>{}).then(()=>api('/orders/'+order.id+'/location',{method:'POST',body:JSON.stringify(body)}));queue.current=result;return result;}
 function stop(silent=false){generation.current++;if(watch.current!==null){navigator.geolocation.clearWatch(watch.current);watch.current=null;send({action:'stop'}).catch(()=>{if(!silent)setMessage('تعذر إرسال إيقاف المشاركة. ستظهر آخر نقطة كموقع قديم خلال دقيقة.');});}if(!silent){setSharing(false);setMessage('توقفت مشاركة الموقع.');}}
 useEffect(()=>{if(!active)stop();return()=>stop(true);},[active,order.id]);
 useEffect(()=>{const hidden=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);},[]);
 function start(){
  if(!secure()){setMessage('مشاركة GPS تحتاج رابط HTTPS وإذن الموقع. رابط الشبكة الحالي يدعم عرض نقطة العميل وفتح الاتجاهات فقط.');return;}
  if(watch.current!==null)return;
  const run=++generation.current;last.current=0;setSharing(true);setMessage('ننتظر قراءة GPS. لم يُرسل موقع بعد.');
  watch.current=navigator.geolocation.watchPosition(p=>{
   if(run!==generation.current||Date.now()-last.current<5000)return;last.current=Date.now();
   send({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,observedAt:p.timestamp}).then(()=>{if(run===generation.current)setMessage('تم إرسال موقعك · دقة تقريبية '+Math.round(p.coords.accuracy)+' متر');}).catch(e=>{if(run===generation.current)setMessage('لم يُرسل التحديث: '+e.message);});
  },e=>{if(run===generation.current){stop();setMessage(geoMessage(e));}},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
 }
 if(!active)return null;
 return <div className="captain-sharing"><button type="button" className={sharing?'soft wide':'primary wide'} onClick={sharing?()=>stop():start}>{sharing?<Square size={17}/>:<Radio size={17}/>} {sharing?'إيقاف مشاركة موقعي':'بدء مشاركة موقعي مع العميل'}</button><p>تبقى المشاركة أثناء فتح هذه الصفحة. تتوقف عند مغادرتها أو إخفاء التطبيق أو انتهاء الطلب. أعد تشغيلها عند العودة من خرائط جوجل.</p>{message&&<p role="status" className="map-warning">{message}</p>}</div>;
}
export function OrderLocation({order,role,api,connection}){
 const [open,setOpen]=useState(role==='captain'&&!['delivered','cancelled'].includes(order.status)),[now,setNow]=useState(Date.now());
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(t);},[]);
 const point=Number.isFinite(order.delivery_lat)&&Number.isFinite(order.delivery_lng)?{lat:order.delivery_lat,lng:order.delivery_lng}:null;
 const courier=order.captain_location,finished=['delivered','cancelled'].includes(order.status),recent=courier&&!connection&&now-courier.observed_at<60000;
 if(!point)return <p className="muted small">طلب سابق لإضافة الخرائط؛ لا توجد نقطة تسليم محفوظة.</p>;
 return <section className="order-location"><button type="button" className="map-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}><MapPin size={18}/><span>موقع التسليم {role==='customer'&&!finished?'وتتبع الكابتن':''}</span><small>{open?'إخفاء الخريطة':'عرض الخريطة'}</small></button>{open&&<><MapCanvas point={point} courier={courier}/><div className="map-legend"><span><i/>نقطة العميل</span>{courier&&<span><i className="courier-dot"/>{recent?'موقع كابتن حديث':'آخر موقع معروف للكابتن'}</span>}</div><a className="google-directions soft" href={google(point)} target="_blank" rel="noopener noreferrer"><Navigation size={17}/>الاتجاهات عبر خرائط جوجل<ExternalLink size={14}/></a><small className="coordinate-text" dir="ltr">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</small>{role!=='pharmacy'&&!finished&&<div className={'tracking-state '+(recent?'fresh':'')}><Radio size={17}/><span>{connection?'تعذر تحديث التتبع؛ تحقق من الشبكة.':courier?(recent?'آخر تحديث للموقع: ':'الموقع قديم، قد يكون الكابتن أوقف المشاركة. آخر تحديث: ')+new Date(courier.observed_at).toLocaleTimeString('ar-YE'):'لم يشارك الكابتن موقعه بعد.'}{courier&&<small>دقة GPS التقريبية: {Math.round(courier.accuracy)} متر · التحديث دوري أثناء المشاركة</small>}</span></div>}</>}{role==='captain'&&<CaptainSharing order={order} api={api}/>}</section>;
}
