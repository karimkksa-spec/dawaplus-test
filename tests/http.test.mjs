import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
test('HTTP authentication, role boundaries, bad credentials and malformed input', async () => {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: '4186',
      HOST: '127.0.0.1',
      DEMO_MODE: 'true',
      DB_PATH: ':memory:'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('Server startup timeout')), 10000);
      child.stdout.on('data', b => {
        if (b.toString().includes('ready:')) {
          clearTimeout(timer);
          res();
        }
      });
      child.once('error', rej);
      child.once('exit', code => {
        clearTimeout(timer);
        rej(new Error('Server exited ' + code));
      });
    });
    const request = (path, options = {}) => fetch('http://127.0.0.1:4186/api' + path, options);
    assert.equal((await request('/orders')).status, 401);
    assert.equal((await request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: '770000001',
        password: 'wrong'
      })
    })).status, 401);
    const response = await request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: '770000001',
        password: 'DawaDemo2026!'
      })
    });
    assert.equal(response.status, 200);
    const {
      token
    } = await response.json();
    const headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    };
    assert.equal((await request('/admin/captains', {
      headers
    })).status, 403);
    assert.equal((await request('/orders', {
      method: 'POST',
      headers,
      body: '{bad'
    })).status, 400);
    assert.equal((await request('/auth/logout', {
      method: 'POST',
      headers
    })).status, 200);
    assert.equal((await request('/orders', {
      headers
    })).status, 401);
    const json={'Content-Type':'application/json'};
    const ad=await (await request('/auth/login',{method:'POST',headers:json,body:JSON.stringify({phone:'770000002',password:'DawaDemo2026!'})})).json();
    const provision=await request('/admin/accounts',{method:'POST',headers:{...json,Authorization:'Bearer '+ad.token},body:JSON.stringify({pharmacyName:'صيدلية HTTP',employeeName:'موظف HTTP',phone:'772222222',kind:'pharmacy',active:true})});assert.equal(provision.status,201);const creds=await provision.json();
    const staff=await (await request('/auth/login',{method:'POST',headers:json,body:JSON.stringify({phone:creds.username,password:creds.password})})).json();assert.equal(staff.user.role,'pharmacy');const sh={...json,Authorization:'Bearer '+staff.token};assert.deepEqual(await (await request('/pharmacy/products',{headers:sh})).json(),[]);
    await request('/admin/accounts/'+creds.id,{method:'PATCH',headers:{...json,Authorization:'Bearer '+ad.token},body:JSON.stringify({pharmacyName:'صيدلية HTTP',employeeName:'موظف HTTP',phone:'772222222',kind:'pharmacy',active:false})});assert.equal((await request('/pharmacy/products',{headers:sh})).status,401);

    const registered=await request('/auth/register',{method:'POST',headers:json,body:JSON.stringify({name:'عميل اختبار HTTP',phone:'+967771234560',password:'HttpTestOnly!2026',role:'admin'})});
    assert.equal(registered.status,201);
    const login=await request('/auth/login',{method:'POST',headers:json,body:JSON.stringify({phone:'771234560',password:'HttpTestOnly!2026'})});
    const account=await login.json();assert.equal(account.user.role,'customer');
    const newHeaders={...json,Authorization:'Bearer '+account.token};
    assert.equal((await request('/admin/settings',{headers:newHeaders})).status,403);
    assert.equal((await request('/admin/settings',{method:'PATCH',headers:newHeaders,body:JSON.stringify({routing:'auto'})})).status,403);
    const inbox=await (await request('/notifications',{headers:newHeaders})).json();assert.equal(inbox.length,1);assert.equal(inbox[0].is_read,0);
    assert.equal((await request('/notifications/read',{method:'POST',headers:newHeaders,body:JSON.stringify({ids:[inbox[0].id]})})).status,200);
    assert.equal((await (await request('/notifications',{headers:newHeaders})).json())[0].is_read,1);
    assert.equal((await request('/orders/DP-00000000/messages',{headers:newHeaders})).status,403);
    assert.equal((await request('/consultations',{method:'POST',headers:newHeaders,body:JSON.stringify({clientKey:'http-disabled-doctor'})})).status,409);
    const products=await (await request('/products')).json();assert.ok('description' in products[0]);assert.ok('catalog_key' in products[0]);
    const guest=await (await request('/guest/session',{method:'POST',headers:json,body:JSON.stringify({phone:'771234560'})})).json();const gh={...json,Authorization:'Bearer '+guest.token};assert.equal((await (await request('/auth/me',{headers:gh})).json()).guest,true);
    const guestOrder=await request('/orders',{method:'POST',headers:{...gh,'Idempotency-Key':'http-guest-order'},body:JSON.stringify({items:[{productId:products[0].id,quantity:1}],phone:'771234560',zoneId:'mansoura',deliveryLocation:{lat:12.85,lng:44.98},paymentMethod:'cash'})});assert.equal(guestOrder.status,201);
    const claimed=await request('/guest/claim',{method:'POST',headers:newHeaders,body:JSON.stringify({guestToken:guest.token})});assert.equal(claimed.status,200);assert.equal((await claimed.json()).linked,1);assert.equal((await request('/orders',{headers:gh})).status,401);assert.equal((await (await request('/orders',{headers:newHeaders})).json()).length,1);

  } finally {
    child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null) resolve();else child.once('exit', resolve);
    });
  }
});
