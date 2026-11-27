import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { openDatabase, passwordMatches } from '../server/db.mjs';
import { initializeCloud, createAdapter } from '../server/postgres.mjs';
import { enabledAccount, accountList } from '../server/accounts.mjs';
import { ownPharmacy } from '../server/pharmacy.mjs';
import { requestPartnership, applicationStatus, reviewApplication, applications,
  captainAccounts, manageCaptain, availableCaptains } from '../server/partners.mjs';
import { createOrder, changeOrder } from '../server/service.mjs';

const secret = () => randomBytes(18).toString('hex');
const applicant = role => ({
  role, name:role==='pharmacy'?'مسؤول صيدلية الاختبار':'مندوب الاختبار',
  zoneId:'mansoura', phone:role==='pharmacy'?'771111121':'771111122', password:secret(),
  pharmacyName:'صيدلية الانضمام', address:'المنصورة شارع الاختبار'
});
for (const dialect of ['sqlite','postgres']) {
  test('Partner onboarding, review and account lifecycle on '+dialect, async () => {
    let db, admin, customer;
    if (dialect === 'sqlite') {
      db=openDatabase(':memory:',true);
      admin={id:'admin-demo',role:'admin'}; customer={id:'customer-demo',role:'customer'};
    } else {
      const engine=new PGlite();
      const query=(sql,args)=>args?engine.query(sql,args):engine.exec(sql).then(r=>r.at(-1)||{rows:[]});
      // PGlite has one connection. Check it out for the entire transaction, like pg.Pool.
      let available=Promise.resolve();
      async function connect() {
        const previous=available;
        let release;
        available=new Promise(done=>{release=done;});
        await previous;
        return {query, release};
      }
      db=createAdapter({query,connect,close:()=>engine.close()});
      await initializeCloud(db,['admin','customer'].map((role,i)=>({role,phone:'77000000'+(i+1),name:role,password:secret()})));
      admin={id:'pilot-admin',role:'admin'};customer={id:'pilot-customer',role:'customer'};
    }
    try {
      const ph=applicant('pharmacy'), cap=applicant('captain');
      await assert.rejects(()=>requestPartnership(db,{...ph,role:'admin'}));
      await assert.rejects(()=>requestPartnership(db,{...ph,address:''}));
      await assert.rejects(()=>requestPartnership(db,{...cap,zoneId:'unknown'}));
      const req=await requestPartnership(db,{...ph,phone:'+967'+ph.phone});
      assert.deepEqual(await requestPartnership(db,ph),req);
      assert.equal(await db.prepare('SELECT id FROM users WHERE phone=?').get(ph.phone),undefined);
      assert.equal(await db.prepare('SELECT id FROM pharmacies WHERE name=?').get(ph.pharmacyName),undefined);
      await assert.rejects(()=>requestPartnership(db,{...ph,password:secret()}),e=>e.status===409);
      await assert.rejects(()=>applications(db,customer),e=>e.status===403);
      await assert.rejects(()=>reviewApplication(db,customer,req.id,{status:'approved'}),e=>e.status===403);
      await assert.rejects(()=>reviewApplication(db,admin,req.id,{status:'rejected',reason:' '}));
      await assert.rejects(()=>applicationStatus(db,{...ph,password:secret()}),e=>e.status===401);
      assert.equal((await applicationStatus(db,ph)).status,'pending');
      const requests=await applications(db,admin);
      assert.ok(!JSON.stringify(requests).includes(ph.password));
      assert.ok(!('password_hash' in requests[0]));
      assert.ok(await db.prepare('SELECT id FROM notifications WHERE user_id=? AND resource=?').get(admin.id,req.id));
      await reviewApplication(db,admin,req.id,{status:'rejected',reason:'يرجى تحديث العنوان'});
      assert.equal((await applicationStatus(db,ph)).reason,'يرجى تحديث العنوان');
      await assert.rejects(()=>reviewApplication(db,admin,req.id,{status:'approved'}),e=>e.status===409);
      const retry=await requestPartnership(db,ph);
      assert.notEqual(retry.id,req.id);
      await Promise.all([1,2].map(()=>reviewApplication(db,admin,retry.id,{status:'approved'})));
      const owner=await db.prepare('SELECT * FROM users WHERE phone=?').get(ph.phone);
      assert.equal(owner.role,'pharmacy');assert.ok(passwordMatches(ph.password,owner.password));
      assert.equal((await ownPharmacy(db,owner)).name,ph.pharmacyName);
      assert.ok((await accountList(db,admin)).some(row=>row.user_id===owner.id));
      assert.equal((await applicationStatus(db,ph)).status,'approved');
      assert.equal((await db.prepare('SELECT password_hash FROM partner_applications WHERE id=?').get(retry.id)).password_hash,null);
      const join=await requestPartnership(db,cap);
      assert.ok(!(await db.prepare(availableCaptains).all()).some(c=>c.phone===cap.phone));
      await assert.rejects(()=>manageCaptain(db,admin,null,cap),e=>e.status===409);
      await reviewApplication(db,admin,join.id,{status:'approved'});
      const captain=await db.prepare('SELECT * FROM users WHERE phone=?').get(cap.phone);
      assert.ok(passwordMatches(cap.password,captain.password));assert.equal(captain.role,'captain');
      assert.ok((await db.prepare(availableCaptains).all()).some(c=>c.id===captain.id));
      await db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('partner-unit-session',captain.id,Date.now()+60000);
      await manageCaptain(db,admin,captain.id,{active:false});
      assert.equal(await db.prepare('SELECT user_id FROM sessions WHERE user_id=?').get(captain.id),undefined);
      await assert.rejects(()=>enabledAccount(db,captain.id),e=>e.status===403);
      assert.ok(!(await db.prepare(availableCaptains).all()).some(c=>c.id===captain.id));
      const product=await db.prepare("SELECT id FROM products WHERE stock>0 AND pharmacy_id='pharmacy-main' LIMIT 1").get();
      const order=await createOrder(db,customer,{items:[{productId:product.id,quantity:1}],phone:'770000001',paymentMethod:'cash',zoneId:'mansoura',deliveryLocation:{lat:12.8,lng:45.0}},'partner-assignment');
      for(const status of ['confirmed','preparing','ready'])await changeOrder(db,admin,order.id,{status,reviewed:true});
      await assert.rejects(()=>changeOrder(db,admin,order.id,{status:'assigned',captainId:captain.id}));
      await manageCaptain(db,admin,captain.id,{active:true});
      await changeOrder(db,admin,order.id,{status:'assigned',captainId:captain.id});
      await assert.rejects(()=>manageCaptain(db,admin,captain.id,{active:false}),e=>e.status===409);
      assert.equal(Number((await captainAccounts(db,admin)).find(c=>c.id===captain.id).active_orders),1);
      const direct=await manageCaptain(db,admin,null,{name:'مندوب مباشر',phone:'771111123'});
      await assert.rejects(()=>manageCaptain(db,customer,direct.id,{reset:true}),e=>e.status===403);
      const reset=await manageCaptain(db,admin,direct.id,{reset:true});
      assert.notEqual(reset.password,direct.password);
      assert.ok(passwordMatches(reset.password,(await db.prepare('SELECT password FROM users WHERE id=?').get(direct.id)).password));
      const log=(await applications(db,admin)).find(x=>x.id===retry.id);
      assert.ok(log.reviewer&&log.reviewed_at);
      if(dialect==='postgres'){await initializeCloud(db);assert.equal((await applicationStatus(db,ph)).status,'approved');}
    } finally {await db.close();}
  });
}
