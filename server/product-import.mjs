import { randomUUID } from 'node:crypto';
import { categoryNames } from './content.mjs';
import { ownPharmacy, validateProduct } from './pharmacy.mjs';
import { parseProductSheet } from './product-sheet.mjs';
import { ensure, transaction } from './service.mjs';

function wholeNumber(value) {
  const s=value.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660))
    .replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0)).replace(/٬/g,',').replace(/٫/g,'.');
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(s))return null;
  const number=Number(s.replace(/,/g,''));
  return Number.isSafeInteger(number)?number:null;
}

const key=(name,category)=>JSON.stringify([category,name.trim().normalize('NFC').replace(/\s+/gu,' ').toLowerCase()]);

async function classify(db,pharmacyId,rows) {
  const existing=await db.prepare('SELECT name,category FROM products WHERE pharmacy_id=?').all(pharmacyId);
  const known=new Set(existing.map(p=>key(p.name,p.category)));
  const seen=new Map();
  return rows.map(row=>{
    const {rowNumber,name,category}=row;
    const issues=[...row.issues],price=wholeNumber(row.price),stock=wholeNumber(row.stock);
    if(name.length<2||name.length>120)issues.push('اسم المنتج مطلوب، من حرفين إلى 120 حرفًا');
    if(!categoryNames.includes(category))issues.push('اختر قسمًا من قائمة القالب');
    if(price===null||price>100000000)issues.push('السعر يجب أن يكون عددًا صحيحًا من 0 إلى 100000000');
    if(stock===null||stock>100000)issues.push('الكمية يجب أن تكون عددًا صحيحًا من 0 إلى 100000');
    let status='new',message='';
    const identity=key(name,category);
    if(issues.length){status='invalid';message=issues.join(' · ');}
    else if(known.has(identity)){status='skip';message='موجود في صيدليتك';}
    else if(seen.has(identity)){
      const first=seen.get(identity);
      if(first.price!==price||first.stock!==stock){status='invalid';message='بياناته تختلف عن الصف '+first.rowNumber+' لنفس المنتج';}
      else {status='skip';message='مكرر مع الصف '+first.rowNumber;}
    } else seen.set(identity,{rowNumber,price,stock});
    return {rowNumber,name:name.slice(0,125),category:category.slice(0,75),price,stock,status,message};
  });
}

export async function importProducts(db,user,bytes,commit=false) {
  const pharmacy=await ownPharmacy(db,user);
  const rows=await parseProductSheet(bytes);
  if(!commit)return {rows:await classify(db,pharmacy.id,rows)};
  return transaction(db,async()=>{
    const current=await ownPharmacy(db,user);
    ensure(current.id===pharmacy.id,'تغير حساب الصيدلية. أعد معاينة الملف',409);
    const checked=await classify(db,current.id,rows);
    const error=checked.find(r=>r.status==='invalid');
    ensure(!error,'صحح خطأ الصف '+error?.rowNumber+' ثم أعد رفع الملف',422);
    const additions=checked.filter(r=>r.status==='new');
    for(let offset=0;offset<additions.length;offset+=50){
      const batch=additions.slice(offset,offset+50);
      const args=[];
      for(const row of batch){
        validateProduct({...row,active:true});
        args.push('P-'+randomUUID(),row.name,row.category,row.price,row.stock,Number(row.category==='الأدوية'),current.id);
      }
      const values=batch.map(()=>"(?,?,?,?,?,'/product-placeholder.svg',NULL,?,1,?)").join(',');
      await db.prepare('INSERT INTO products(id,name,category,price,stock,image,source,review_required,active,pharmacy_id) VALUES '+values).run(...args);
    }
    return {added:additions.length,skipped:checked.length-additions.length};
  });
}
