import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {openDatabase} from '../server/db.mjs';
import {createAdapter,initializeCloud} from '../server/postgres.mjs';
import {importProducts} from '../server/product-import.mjs';
import {parseProductSheet} from '../server/product-sheet.mjs';
import {pharmacyProducts,saveProductPhoto} from '../server/pharmacy.mjs';

const valid = await readFile(new URL('./fixtures/pharmacy-valid.xlsx',import.meta.url));
const invalid = await readFile(new URL('./fixtures/pharmacy-invalid.xlsx',import.meta.url));
const owner = {id:'pharmacy-demo',role:'pharmacy'};
const other = {id:'pharmacy-two-demo',role:'pharmacy'};
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S0AAAAASUVORK5CYII=';

test('Excel preview reports row errors and a failed confirmation saves no products',async()=>{
  const template = await readFile(new URL('../public/pharmacy-products-template.xlsx',import.meta.url));
  await assert.rejects(()=>parseProductSheet(template),/الورقة فارغة/);
  await assert.rejects(()=>parseProductSheet(Buffer.from('plain text')),e=>e.status===400);
  const db=openDatabase(':memory:',true);
  try {
    const before=(await pharmacyProducts(db,owner)).length;
    const {rows}=await importProducts(db,owner,invalid);
    assert.deepEqual(rows.map(r=>[r.rowNumber,r.status]),[[2,'new'],[3,'invalid'],[4,'invalid']]);
    assert.match(rows[1].message,/الصف 2/);
    for(const part of ['المعادلة','قسم','السعر'])assert.ok(rows[2].message.includes(part));
    await assert.rejects(()=>importProducts(db,owner,invalid,true),e=>e.status===422);
    assert.equal((await pharmacyProducts(db,owner)).length,before);
  } finally {await db.close();}
});

test('Simultaneous confirmations are idempotent and ownership is isolated per pharmacy',async()=>{
  const db=openDatabase(':memory:',true);
  try {
    const {rows}=await importProducts(db,owner,valid);
    assert.deepEqual(rows.map(r=>r.status),['new','new','skip']);
    assert.equal(rows[0].price,1500);
    const receipts=await Promise.all([importProducts(db,owner,valid,true),importProducts(db,owner,valid,true)]);
    assert.deepEqual(receipts.map(r=>r.added).sort(),[0,2]);
    assert.deepEqual(await importProducts(db,other,valid,true),{added:2,skipped:1});
    const item=(await pharmacyProducts(db,owner)).find(p=>p.name===rows[0].name);
    await assert.rejects(()=>saveProductPhoto(db,other,item.id,photo),e=>e.status===404);
    for(const role of ['admin','captain','customer']){
      await assert.rejects(()=>importProducts(db,{id:role,role},valid,true),e=>e.status===403);
    }
  } finally {await db.close();}
});

test('PostgreSQL import, later photo upload and repeat preserve live stock and price',async()=>{
  const pg=new PGlite();
  const db=createAdapter({query:(sql,args)=>args?pg.query(sql,args):pg.exec(sql).then(r=>r.at(-1)||{rows:[]}),close:()=>pg.close()});
  const user={id:'pilot-pharmacy',role:'pharmacy'};
  try {
    await initializeCloud(db,[{role:'pharmacy',name:'Pharmacy',phone:'770000004',password:'LocalTestOnly-Strong-2026'}]);
    assert.deepEqual(await importProducts(db,user,valid,true),{added:2,skipped:1});
    const products=await pharmacyProducts(db,user);
    const item=products.find(p=>p.name==='عبوة عناية ١٠٠ مل');
    assert.equal(item.image,'/product-placeholder.svg');
    assert.equal(item.active,1);
    assert.equal(products.find(p=>p.name==='صنف اختبار 20 مل').review_required,1);
    await db.prepare('UPDATE products SET stock=?,price=? WHERE id=?').run(10,1400,item.id);
    const updated=await saveProductPhoto(db,user,item.id,photo);
    assert.equal((await db.prepare('SELECT mime FROM uploads WHERE id=?').get(updated.image.slice(9))).mime,'image/png');
    assert.deepEqual(await importProducts(db,user,valid,true),{added:0,skipped:3});
    const after=(await pharmacyProducts(db,user)).find(p=>p.id===item.id);
    assert.deepEqual([after.stock,after.price,after.image],[10,1400,updated.image]);
  } finally {await db.close();}
});
