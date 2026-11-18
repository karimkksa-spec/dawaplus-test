import React,{useState,useRef} from 'react';
import {ArrowRight,ArrowLeft,ShoppingBag,Heart,LayoutGrid,RefreshCw,Package} from 'lucide-react';
import {AdSlider} from './Content.jsx';
import {availableGroups,productGroup} from './catalog-groups.mjs';
import './storefront.css';

const categoryCopy={
  'الأدوية':['احتياجاتك في مكان واحد','تصفّح المنتجات، والصيدلي يراجع طلبك قبل التجهيز.'],
  'التجميل':['تفاصيل صغيرة، عناية أجمل','اكتشف منتجات التجميل المتاحة في صيدليتك.'],
  'الأجهزة الطبية':['العناية تبدأ بالمتابعة','تصفّح الأجهزة الطبية المتاحة بكل سهولة.'],
  'العناية بالشعر':['روتين عناية يناسبك','الشامبو والزيوت ومنتجات العناية في مكان واحد.'],
  'العناية الشخصية':['عناية ترافق يومك','احتياجات العناية اليومية، أقرب إليك.'],
  'مستلزمات طبية':['كل مستلزماتك، أقرب','تصفّح مستلزمات العناية المتاحة.'],
  'الأم والطفل':['عناية لك ولصغيرك','اكتشف المنتجات المتاحة للأم والطفل.'],
};
const asset=(path,base)=>path?.startsWith('/')?base+path:path;

function categoryPhoto(category, base) {
  const path = category?.image;
  const preset = /^\/categories\/([0-6])\.svg$/.exec(path || '');
  return preset ? '/store-art/' + preset[1] + '.webp' : asset(path, base);
}

function Banner({category,image,onBrowse}) {
  const home = category === 'الكل';
  const copy = categoryCopy[category] || ['صيدليتك، أقرب إليك','منتجات الدواء والعناية، وتوصيل داخل عدن.'];
  return <section className="shop-banner photo-banner" aria-label={home ? 'بانر دواء بلس' : category}>
    <div className="shop-banner-copy"><h2>{copy[0]}</h2><p>{copy[1]}</p><button onClick={onBrowse}>تسوّق الآن <ArrowLeft size={16}/></button></div>
    <img className="shop-banner-photo" src={image || '/store-art/home.webp'} alt=""/>
  </section>;
}

export default function Storefront({config,products,query,setQuery,category,setCategory,view,setView,selectedPharmacy,setSelectedPharmacy,favorites,setFavorites,onSelect,onAdd,money,busy,onRefresh,apiBase=''}) {
  const [group,setGroup]=useState('الكل');
  const rail=useRef(null),drag=useRef(null);
  const categories=config.content?.categories||[];
  const scoped=products.filter(p=>(selectedPharmacy==='all'||p.pharmacy_id===selectedPharmacy)&&(category==='الكل'||p.category===category)&&(view!=='favorites'||favorites.includes(p.id)));
  const groups=availableGroups(scoped);
  const selectedGroup=groups.includes(group)?group:'الكل';
  const shown=scoped.filter(p=>(!query||p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))&&(selectedGroup==='الكل'||productGroup(p)===selectedGroup));
  const isHome=view!=='favorites'&&category==='الكل'&&!query;
  const selected=categories.find(c=>c.name===category);
  function choose(name){setQuery('');setCategory(name);setGroup('الكل');setView('home');window.scrollTo({top:0,behavior:'smooth'});}
  function browse(){document.getElementById('products')?.scrollIntoView({behavior:'smooth',block:'start'});}
  function pointerDown(e){if(e.pointerType!=='mouse')return;drag.current={x:e.clientX,scroll:rail.current.scrollLeft,moved:false,active:true};}
  function pointerMove(e){const d=drag.current;if(!d?.active)return;const delta=e.clientX-d.x;if(Math.abs(delta)>5){d.moved=true;rail.current.setPointerCapture(e.pointerId);rail.current.scrollLeft=d.scroll-delta;}}
  return <div className="storefront">
    {!isHome&&<div className="shop-page-title"><button className="shop-back" aria-label="العودة إلى كل التصنيفات" onClick={()=>choose('الكل')}><ArrowRight/></button><h1>{view==='favorites'?'المفضلة':query?'نتائج البحث':category}</h1></div>}
    {view!=='favorites'&&!query&&(isHome&&config.content?.ads?.length?<AdSlider ads={config.content.ads.map(a=>({...a,image:asset(a.image,apiBase)}))}/>:<Banner category={category} image={categoryPhoto(selected,apiBase)} onBrowse={browse}/>)}
    {isHome&&<section className="shop-categories" aria-label="التصنيفات"><div className="shop-section-title"><h2><LayoutGrid size={20}/> التصنيفات</h2></div><div className="shop-category-grid">{categories.map(c=>{const photo=categoryPhoto(c,apiBase);return <button key={c.name} onClick={()=>choose(c.name)}><span className="shop-category-image"><img src={photo} alt=""/></span><span>{c.name}</span><ArrowLeft size={14}/></button>;})}</div></section>}
    {!isHome&&view!=='favorites'&&<nav className="shop-category-switch" aria-label="تغيير الفئة">{categories.map(c=><button key={c.name} aria-pressed={category===c.name} className={category===c.name?'active':''} onClick={()=>choose(c.name)}>{c.name}</button>)}</nav>}
    {category!=='الكل'&&view!=='favorites'&&<nav className="shop-subcategories" aria-label={'تقسيمات '+category} ref={rail} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={()=>{if(drag.current)drag.current.active=false;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{if(drag.current)drag.current.active=false;}} onClickCapture={e=>{if(drag.current?.moved){e.preventDefault();e.stopPropagation();drag.current=null;}}}>
      {['الكل',...groups].map(name=><button key={name} aria-pressed={selectedGroup===name} className={selectedGroup===name?'active':''} onClick={()=>setGroup(name)}><Package size={16}/>{name}</button>)}
    </nav>}
    <section id="products" className="shop-products"><div className="shop-section-title"><h2>{isHome?'منتجاتنا':view==='favorites'?'اختياراتك المحفوظة':selectedGroup==='الكل'?'كل المنتجات':selectedGroup}</h2><span aria-live="polite">{shown.length} منتج</span></div>
      <div className="shop-product-tools"><select aria-label="اختر الصيدلية" value={selectedPharmacy} onChange={e=>setSelectedPharmacy(e.target.value)}><option value="all">كل الصيدليات</option>{config.pharmacies?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button aria-label="تحديث المنتجات" disabled={busy} onClick={onRefresh}><RefreshCw size={18}/></button></div>
      <div className="shop-product-grid">{shown.map(p=><article className="shop-product" key={p.id}><div className="shop-product-picture"><button className={'shop-favorite '+(favorites.includes(p.id)?'saved':'')} aria-label={'حفظ '+p.name} aria-pressed={favorites.includes(p.id)} onClick={()=>setFavorites(f=>f.includes(p.id)?f.filter(id=>id!==p.id):[...f,p.id])}><Heart size={20}/></button><button className="shop-picture-button" aria-label={'تفاصيل '+p.name} onClick={()=>onSelect(p)}><img src={p.image} alt={p.name} loading="lazy"/></button></div><button className="shop-product-name" onClick={()=>onSelect(p)}>{p.name}</button><strong className="shop-price">{money(p.price)}</strong><button className="shop-add" disabled={p.stock<1} onClick={()=>onAdd(p)}><ShoppingBag size={17}/>{p.stock<1?'غير متوفر':'إضافة للسلة'}</button></article>)}</div>
      {!shown.length&&<div className="shop-empty"><Package size={36}/><h3>لا توجد منتجات متاحة هنا حاليًا</h3><p>جرّب قسمًا آخر أو غيّر البحث أو الصيدلية.</p><button onClick={()=>{choose('الكل');}}>عرض كل التصنيفات</button></div>}
    </section>
  </div>;
}
