import React, {useEffect, useRef, useState} from 'react';
import {Camera, Download, FileSpreadsheet, X} from 'lucide-react';
import './product-import.css';

const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const templateUrl = (import.meta.env.VITE_API_URL || '') + '/pharmacy-products-template.xlsx';
const labels = {new:'جديد', skip:'سيُتخطى', invalid:'يحتاج تصحيح'};

export function hasNoPhoto(product) {
  return !product.image || product.image.split('?')[0].endsWith('/product-placeholder.svg');
}

export function ProductImport({api, onImported}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [limit, setLimit] = useState(20);
  const lock = useRef(false);
  const picker = useRef(null);
  const count = status => rows.filter(row => row.status === status).length;
  const invalid = count('invalid'), additions = count('new');
  const filtered = onlyErrors ? rows.filter(row => row.status === 'invalid') : rows;

  function select(next) {
    setRows([]); setError(''); setReceipt(''); setLimit(20); setOnlyErrors(false); setFile(null);
    if (!next) return;
    if (!/\.xlsx$/i.test(next.name) || !next.size || next.size > 2*1024*1024) {
      setError('اختر ملفًا بصيغة xlsx بحجم لا يتجاوز ٢ ميجابايت.');
      return;
    }
    setFile(next);
  }

  async function submit(action) {
    if (!file || lock.current) return;
    lock.current = true;
    setBusy(action); setError(''); setReceipt('');
    try {
      const result = await api('/pharmacy/products/import/' + action, {
        method:'POST', headers:{'Content-Type':workbookType}, body:file
      });
      if (action === 'preview') {
        setRows(result.rows); setOnlyErrors(false); setLimit(20);
      } else {
        setReceipt('اكتمل الاستيراد. أُضيف ' + result.added + '، وتم تخطي ' + result.skipped + '.');
        setRows([]); setFile(null);
        if (picker.current) picker.current.value = '';
        await onImported();
      }
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(''); }
  }

  return <section className="sheet-import">
    <button className="soft" type="button" aria-expanded={open} aria-controls="sheet-panel"
      onClick={() => setOpen(!open)} disabled={!!busy}><FileSpreadsheet size={18}/>استيراد من Excel</button>
    {open && <div id="sheet-panel" className="sheet-panel">
      <p>نزّل القالب واملأ اسم المنتج والقسم والسعر بالريال اليمني والكمية المتاحة. اذكر التركيز أو حجم العبوة في الاسم لتمييز الأصناف المتشابهة.</p>
      <a href={templateUrl} download="pharmacy-products-template.xlsx"><Download size={17}/>تنزيل قالب Excel</a>
      <label>ملف المنتجات <small>حتى ٥٠٠ صف و٢ ميجابايت</small>
        <input ref={picker} type="file" accept=".xlsx" disabled={!!busy} onChange={e => {select(e.target.files[0]); e.target.value='';}}/>
      </label>
      {file && <small>الملف المختار · <bdi>{file.name}</bdi></small>}
      {!rows.length && <button type="button" className="primary" disabled={!file || !!busy}
        onClick={() => submit('preview')}>{busy === 'preview' ? 'جارٍ قراءة الملف…' : 'معاينة المنتجات'}</button>}
      {rows.length > 0 && <>
        <div role="status"><strong>نتيجة المعاينة</strong> · جديد {additions} · سيُتخطى {count('skip')} · يحتاج تصحيح {invalid}</div>
        <small>يتخطى الاستيراد المنتج الموجود بنفس الاسم والقسم في صيدليتك ويحتفظ بسعره وكميته وصورته.</small>
        {invalid > 0 && <label className="check-label"><input type="checkbox" checked={onlyErrors}
          onChange={e => {setOnlyErrors(e.target.checked); setLimit(20);}}/>عرض الصفوف التي تحتاج تصحيحًا فقط</label>}
        <div className="table-container sheet-table"><table><thead><tr><th>الصف</th><th>اسم المنتج</th><th>القسم</th><th>السعر</th><th>الكمية</th><th>النتيجة</th></tr></thead>
          <tbody>{filtered.slice(0,limit).map((r,i) => <tr key={i}><td>{r.rowNumber}</td><td>{r.name || '—'}</td>
            <td>{r.category || '—'}</td><td>{r.price ?? '—'}</td><td>{r.stock ?? '—'}</td>
            <td><strong className={'sheet-status-'+r.status}>{labels[r.status]}</strong>{r.message && <small>{r.message}</small>}</td></tr>)}</tbody></table></div>
        {filtered.length > limit && <button type="button" className="soft" onClick={() => setLimit(limit+50)}>عرض المزيد ({filtered.length-limit})</button>}
        {invalid > 0 ? <p>صحّح الصفوف المشار إليها في Excel ثم اختر الملف المعدّل لمعاينته من جديد.</p> :
          additions === 0 ? <p>كل المنتجات موجودة أو مكررة في الملف.</p> :
          <button type="button" className="primary" disabled={!!busy} onClick={() => submit('confirm')}>
            {busy === 'confirm' ? 'جارٍ الحفظ…' : 'تأكيد إضافة المنتجات ('+additions+')'}</button>}
      </>}
      {error && <p className="notice" role="alert">{error}</p>}
      {receipt && <p role="status">{receipt}</p>}
    </div>}
  </section>;
}

export function ProductPhotoDialog({product, api, onSaved, onClose}) {
  const dialog = useRef(null), reader = useRef(null), lock = useRef(false);
  const [image, setImage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current.showModal();
    return () => {if (reader.current) reader.current.abort();};
  }, []);
  function choose(file) {
    if (reader.current) reader.current.abort();
    setImage(''); setError('');
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 1024*1024 || !file.size) {
      setError('اختر صورة PNG أو JPEG أو WebP بحجم لا يتجاوز ١ ميجابايت.'); return;
    }
    const next = new FileReader();
    reader.current = next;
    next.onload = () => {if (reader.current === next) setImage(String(next.result));};
    next.onerror = () => setError('تعذرت قراءة الصورة. اخترها مرة أخرى.');
    next.readAsDataURL(file);
  }
  async function save() {
    if (lock.current || !image) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await api('/pharmacy/products/'+encodeURIComponent(product.id)+'/photo', {method:'PATCH',body:JSON.stringify({imageData:image})});
      await onSaved();
    } catch(e) {setError(e.message);}
    finally {lock.current = false; setBusy(false);}
  }
  return <dialog ref={dialog} className="modal sheet-photo" aria-labelledby="photo-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <div className="modal-header"><h2 id="photo-title">إضافة صورة المنتج</h2>
      <button type="button" className="icon-button" aria-label="إغلاق" disabled={busy} onClick={onClose}><X/></button></div>
    <p>{product.name}</p><label>اختر صورة <small>PNG أو JPEG أو WebP، حتى ١ ميجابايت</small>
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>choose(e.target.files[0])}/></label>
    {image && <img className="upload-preview" src={image} alt="معاينة صورة المنتج"/>}
    {error && <p className="notice" role="alert">{error}</p>}
    <button type="button" className="primary wide" disabled={!image || busy} onClick={save}><Camera size={18}/>{busy?'جارٍ حفظ الصورة…':'حفظ الصورة'}</button>
  </dialog>;
}
