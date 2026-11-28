import yauzl from 'yauzl';
import { DOMParser } from '@xmldom/xmldom';
import { posix } from 'node:path';
import { ensure, ApiError } from './service.mjs';

export const sheetLimits = { bytes:2*1024*1024, rows:500 };
const headers = new Map([['اسم المنتج','name'],['القسم','category'],['السعر بالريال اليمني','price'],['الكمية المتاحة','stock']]);
const bad = message => new ApiError(400,message);
const elements = (node,tag) => Array.from(node.getElementsByTagNameNS('*',tag));
const children = (node,tag) => Array.from(node.childNodes).filter(n=>n.nodeType===1 && n.localName===tag);
const clean = value => String(value??'').trim().replace(/\s+/gu,' ');

export async function readWorkbookBody(req) {
  const pieces=[]; let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    ensure(size<=sheetLimits.bytes, 'الحد الأقصى لحجم ملف Excel هو 2 ميجابايت',413);
    pieces.push(chunk);
  }
  return Buffer.concat(pieces);
}

function entriesOf(zip) {
  return new Promise((resolve,reject)=>{
    const files=new Map();
    zip.on('error',reject);
    zip.on('end',()=>resolve(files));
    zip.on('entry',entry=>{
      if(files.has(entry.fileName)) return reject(bad('ملف Excel غير صالح'));
      files.set(entry.fileName,entry);
      zip.readEntry();
    });
    zip.readEntry();
  });
}

async function xmlPart(zip,files,path) {
  const entry=files.get(path);
  ensure(entry && entry.uncompressedSize<=2*1024*1024 && !(entry.generalPurposeBitFlag & 1),'ملف Excel تالف أو كبير أو محمي بكلمة مرور');
  const stream=await new Promise((yes,no)=>zip.openReadStream(entry,(err,s)=>err?no(err):yes(s)));
  let size=0; const chunks=[];
  for await(const chunk of stream) {
    size+=chunk.length;
    ensure(size<=2*1024*1024,'تجاوزت ورقة Excel الحجم المسموح');
    chunks.push(chunk);
  }
  const xml=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'');
  ensure(!/<!DOCTYPE|<!ENTITY/i.test(xml) && !xml.includes('\0') && (xml.match(/</g)||[]).length<90000,'تنسيق ورقة Excel غير مدعوم');
  return new DOMParser({onError:()=>{throw bad('تعذر قراءة بنية ملف Excel');}}).parseFromString(xml,'application/xml');
}

function textRuns(node) {
  if(!node) return '';
  return children(node,'t').concat(children(node,'r').flatMap(r=>children(r,'t'))).map(t=>t.textContent).join('');
}

function nonQuantityStyles(doc) {
  const custom = new Map(elements(doc,'numFmt').map(n=>[Number(n.getAttribute('numFmtId')), n.getAttribute('formatCode')]));
  const formats = elements(doc,'cellXfs')[0];
  const excluded = new Set();
  for(const [index,xf] of (formats ? children(formats,'xf') : []).entries()){
    const id = Number(xf.getAttribute('numFmtId'));
    const format = (custom.get(id) || '').replace(/"[^"]*"|\\.|_.|\*./g,'').replace(/\[(?![hms]+\])[^[]*?\]/gi,'');
    if([9,10].includes(id) || (id>=14 && id<=22) || (id>=27 && id<=36) || (id>=45 && id<=47) ||
       (id>=50 && id<=58) || /[%ymdhs]/i.test(format)) excluded.add(index);
  }
  return excluded;
}

function cellValue(cell,strings,excluded) {
  if(children(cell,'f').length) return {issue:'استبدل المعادلة بقيمتها'};
  const kind=cell.getAttribute('t'), raw=children(cell,'v')[0]?.textContent||'';
  if(kind==='inlineStr') return textRuns(children(cell,'is')[0]);
  if(kind==='s') return /^\d+$/.test(raw) && Number(raw)<strings.length ? strings[Number(raw)] : {issue:'قيمة نصية غير صالحة'};
  if(raw && (!kind || kind==='n') && excluded?.has(Number(cell.getAttribute('s'))))return {issue:'أدخل رقمًا عاديًا بدل تاريخ أو نسبة مئوية'};
  if(!kind || kind==='n' || kind==='str') return raw;
  return {issue:'نوع قيمة غير صالح'};
}

function sheetRows(doc,strings,excluded) {
  const data=elements(doc,'sheetData')[0];
  ensure(data,'لا توجد بيانات في ورقة المنتجات');
  const rows=children(data,'row'), mapping=new Map(), result=[];
  for(const [index,row] of rows.entries()){
    const rowNumber=Number(row.getAttribute('r')||index+1);
    const cells=children(row,'c');
    if(!cells.length)continue;
    const positioned=cells.map((cell,i)=>{
      const ref=cell.getAttribute('r');
      const col=ref ? /^([A-Z]+)\d+$/.exec(ref)?.[1] : String.fromCharCode(65+i);
      return [col,cell];
    });
    if(!mapping.size){
      const titles=positioned.map(([col,cell])=>[col,clean(cellValue(cell,strings))]);
      if(titles.every(([,value])=>!value))continue;
      for(const [col,title] of titles)if(headers.has(title))mapping.set(col,headers.get(title));
      ensure(mapping.size===headers.size && new Set(mapping.values()).size===headers.size,'عناوين الأعمدة غير مطابقة. استخدم قالب المنتجات المتاح في الصفحة');
      continue;
    }
    const item={rowNumber,issues:[],name:'',category:'',price:'',stock:''};
    for(const [col,cell] of positioned){
      const field=mapping.get(col);
      if(!field)continue;
      const value=cellValue(cell,strings,field==='price'||field==='stock'?excluded:null);
      if(typeof value==='object'){item.issues.push(value.issue+' في '+[...headers].find(([,f])=>f===field)[0]);continue;}
      item[field]=clean(value);
    }
    if(!item.issues.length && !['name','category','price','stock'].some(f=>item[f]))continue;
    ensure(result.length<sheetLimits.rows,'ارفع 500 منتج كحد أقصى في كل ملف');
    result.push(item);
  }
  ensure(mapping.size && result.length,'الورقة فارغة. أدخل بيانات المنتجات أسفل العناوين أولًا');
  return result;
}

export async function parseProductSheet(bytes) {
  ensure(bytes.length && bytes.length<=sheetLimits.bytes,'اختر ملف xlsx بحجم لا يتجاوز 2 ميجابايت');
  let zip;
  try {
    zip=await new Promise((yes,no)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(err,result)=>err?no(err):yes(result)));
    ensure(zip.entryCount<=300,'يحتوي الملف على مكونات كثيرة. انسخ المنتجات إلى القالب');
    const files=await entriesOf(zip);
    const book=await xmlPart(zip,files,'xl/workbook.xml');
    const rels=elements(await xmlPart(zip,files,'xl/_rels/workbook.xml.rels'),'Relationship');
    const sheets=elements(book,'sheet').filter(s=>!['hidden','veryHidden'].includes(s.getAttribute('state')));
    const sheet=sheets.find(s=>s.getAttribute('name')==='المنتجات')||sheets[0];
    ensure(sheet,'لا توجد ورقة منتجات ظاهرة');
    const id=Array.from(sheet.attributes).find(a=>a.localName==='id')?.value;
    function part(rel,kind){
      ensure(rel && rel.getAttribute('Type').endsWith('/'+kind) && rel.getAttribute('TargetMode')!=='External','ارتباط ورقة Excel غير صالح');
      const target=rel.getAttribute('Target');
      const path=posix.normalize(target.startsWith('/')?target.slice(1):posix.join('xl',target));
      ensure(path.startsWith('xl/'),'مسار ورقة Excel غير صالح');
      return path;
    }
    const stringsRel=rels.find(r=>r.getAttribute('Type').endsWith('/sharedStrings'));
    const strings=stringsRel ? elements(await xmlPart(zip,files,part(stringsRel,'sharedStrings')),'si').map(textRuns) : [];
    const doc=await xmlPart(zip,files,part(rels.find(r=>r.getAttribute('Id')===id),'worksheet'));
    const stylesRel=rels.find(r=>r.getAttribute('Type').endsWith('/styles'));
    const excluded=stylesRel ? nonQuantityStyles(await xmlPart(zip,files,part(stylesRel,'styles'))) : null;
    return sheetRows(doc,strings,excluded);
  } catch(error) {
    if(error instanceof ApiError)throw error;
    throw bad('تعذر قراءة الملف. احفظه بصيغة Excel ‏(.xlsx) ثم أعد رفعه');
  } finally {zip?.close();}
}
