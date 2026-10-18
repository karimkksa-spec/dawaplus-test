import {guestSession,claimGuest} from './guest.mjs';
import {content,saveContent} from './content.mjs';
import {accountList,saveAccount,enabledAccount} from './accounts.mjs';
import {settings,saveSettings,productDetails,register,phoneNumber,routeOrder,messages,sendMessage,consultationList,consultationCreate,consultationUpdate} from './features.mjs';
import { shareLocation } from './location.mjs';
import http from 'node:http';
import { paymentProviders } from './payments.mjs';
import { ownPharmacy, pharmacyProducts, saveProduct } from './pharmacy.mjs';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { openDatabase, passwordMatches, root } from './db.mjs';
import {openPostgres} from './postgres.mjs';
import {transaction} from './transaction.mjs';
import { ApiError, ensure, listOrders, createOrder, changeOrder } from './service.mjs';
const demo = process.env.DEMO_MODE === 'true';
if(process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL)throw new Error('Production requires DATABASE_URL; local SQLite is not durable on this host');
const db = process.env.DATABASE_URL?await openPostgres(process.env.DATABASE_URL):openDatabase(process.env.DB_PATH || undefined, demo),
  attempts = new Map();
const hash = t => createHash('sha256').update(t).digest('hex');
async function readBody(req) {
  let s = '';
  for await (const chunk of req) {
    s += chunk;
    ensure(s.length <= ((req.url.startsWith('/api/pharmacy/products')||req.url.startsWith('/api/admin/content')) ? 26000000 : 32768), 'الطلب أكبر من الحد المسموح', 413);
  }
  try {
    return JSON.parse(s || '{}');
  } catch {
    throw new ApiError(400, 'بيانات غير صالحة');
  }
}
async function session(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  ensure(token.length === 64, 'يرجى تسجيل الدخول', 401);
  const u = await db.prepare('SELECT u.id,u.name,u.role,u.phone FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(token), Date.now());
  ensure(u, 'انتهت جلسة الدخول', 401);
  ensure(demo || !u.id.endsWith('-demo'), 'الحساب التجريبي معطل', 403);
  await enabledAccount(db,u.id);
  const guest=await db.prepare('SELECT phone FROM guest_access WHERE user_id=? AND claimed_by IS NULL').get(u.id);if(guest){u.guest=true;u.phone=guest.phone;}
  return u;
}
async function admin(req) {
  const u = await session(req);
  ensure(u.role === 'admin', 'هذه الصفحة للإدارة فقط', 403);
  return u;
}
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ttf': 'font/ttf'
};
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const allowed = ['http://localhost', 'https://localhost', 'capacitor://localhost', 'http://127.0.0.1:5173', 'http://localhost:5173'];
  if (allowed.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  function send(data, status = 200) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(data));
  }
  try {
    const url = new URL(req.url, 'http://localhost'),
      path = url.pathname;
    if (path === '/api/health') {await db.prepare('SELECT 1 AS ok').get();return send({
      ok: true,
      demo,storage:db.dialect||'sqlite'
    });}
    if (path === '/api/config') return send({
      city: 'عدن',
      currency: 'YER',
      demo,
      walletsEnabled: false,
      operations: await settings(db),
      content:await content(db),
      paymentProviders,
      pharmacies: await db.prepare('SELECT id,name FROM pharmacies WHERE active=1').all(),
      zones: await db.prepare('SELECT * FROM zones WHERE active=1').all()
    });
    if (path === '/api/products' && req.method === 'GET') return send(await productDetails(db,await db.prepare('SELECT p.*,ph.name AS pharmacy_name FROM products p JOIN pharmacies ph ON ph.id=p.pharmacy_id WHERE p.active=1 AND ph.active=1 ORDER BY p.category,p.name').all()));
    if (['/api/auth/login','/api/auth/register','/api/guest/session'].includes(path) && req.method === 'POST') {
      const ip = req.socket.remoteAddress;
      let limit = attempts.get(ip);
      if (!limit || limit.until < Date.now()) {
        limit = {
          n: 0,
          until: Date.now() + 600000
        };
        attempts.set(ip, limit);
      }
      ensure(++limit.n <= 20, 'محاولات كثيرة، حاول بعد عشر دقائق', 429);
      const b = await readBody(req);
      if(path==='/api/guest/session')return send(await guestSession(db,b),201);
      ensure(typeof b.phone === 'string' && typeof b.password === 'string' && b.password.length <= 200, 'بيانات الدخول غير صالحة');
      if(path==='/api/auth/register'){await register(db,b);return send({ok:true},201);}
      const u = b.phone.startsWith('dp-')?await db.prepare('SELECT u.* FROM users u JOIN pharmacy_accounts a ON a.user_id=u.id WHERE a.username=?').get(b.phone.trim()):await db.prepare('SELECT * FROM users WHERE phone=?').get(phoneNumber(b.phone));
      ensure(u && passwordMatches(b.password, u.password), 'رقم الهاتف أو كلمة المرور غير صحيحة', 401);
      ensure(demo || !u.id.endsWith('-demo'), 'الحساب التجريبي معطل', 403);
      await enabledAccount(db,u.id);
      const token = randomBytes(32).toString('hex');
      await db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
      await db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), u.id, Date.now() + 8 * 3600000);
      return send({
        token,
        user: {
          id: u.id,
          name: u.name,
          role: u.role,
          phone: u.phone
        }
      });
    }
    if(path==='/api/guest/claim'&&req.method==='POST')return send(await claimGuest(db,await session(req),await readBody(req)));
    if (path === '/api/auth/me') return send(await session(req));
    if (path === '/api/auth/logout' && req.method === 'POST') {
      await session(req);
      await db.prepare('DELETE FROM sessions WHERE token=?').run(hash(req.headers.authorization.slice(7)));
      return send({
        ok: true
      });
    }
    if(path==='/api/admin/content'){const u=await admin(req);if(req.method==='GET')return send(await content(db));if(req.method==='PATCH')return send(await saveContent(db,u,await readBody(req)));}
    if(path==='/api/admin/accounts'){const u=await admin(req);if(req.method==='GET')return send(await accountList(db,u));if(req.method==='POST')return send(await saveAccount(db,u,await readBody(req)),201);}
    const account=path.match(/^\/api\/admin\/accounts\/(staff-[a-f0-9-]+)$/);if(account&&req.method==='PATCH')return send(await saveAccount(db,await admin(req),await readBody(req),account[1]));
    if(path==='/api/admin/settings'){
      const u=await admin(req);if(req.method==='GET')return send(await settings(db));if(req.method==='PATCH')return send(await saveSettings(db,u,await readBody(req)));
    }
    if(path==='/api/notifications'&&req.method==='GET'){const u=await session(req);return send(await db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(u.id));}
    if(path==='/api/notifications/read'&&req.method==='POST'){const u=await session(req);const b=await readBody(req);ensure(Array.isArray(b.ids)&&b.ids.length<=100&&b.ids.every(x=>typeof x==='string'),'معرفات غير صالحة');await transaction(db,async()=>{for(const id of b.ids)await db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(id,u.id);});return send({ok:true});}
    if(path==='/api/consultations'){const u=await session(req);if(req.method==='GET')return send(await consultationList(db,u));if(req.method==='POST')return send(await consultationCreate(db,u,await readBody(req)),201);}
    const consultation=path.match(/^\/api\/consultations\/(CS-[A-F0-9]{8})$/);
    if(consultation&&req.method==='PATCH')return send(await consultationUpdate(db,await session(req),consultation[1],await readBody(req)));
    const routing=path.match(/^\/api\/orders\/(DP-[A-F0-9]{8})\/routing$/);
    if(routing&&req.method==='PATCH')return send(await routeOrder(db,await session(req),routing[1],await readBody(req)));
    const chat=path.match(/^\/api\/orders\/(DP-[A-F0-9]{8})\/messages$/);
    if(chat){const u=await session(req);if(req.method==='GET')return send(await messages(db,u,chat[1]));if(req.method==='POST')return send(await sendMessage(db,u,chat[1],await readBody(req)),201);}
    if (path === '/api/orders' && req.method === 'GET') return send(await listOrders(db, await session(req)));
    if (path === '/api/orders' && req.method === 'POST') return send(await createOrder(db, await session(req), await readBody(req), req.headers['idempotency-key']), 201);
    const tracking = path.match(/^\/api\/orders\/(DP-[A-F0-9]{8})\/location$/);
    if (tracking && req.method === 'POST') return send(await shareLocation(db, await session(req), tracking[1], await readBody(req)));
    const order = path.match(/^\/api\/orders\/(DP-[A-F0-9]{8})$/);
    if (order && req.method === 'PATCH') return send(await changeOrder(db, await session(req), order[1], await readBody(req)));
    if (path === '/api/pharmacy/profile' && req.method === 'GET') return send(await ownPharmacy(db, await session(req)));
    if (path === '/api/pharmacy/products' && req.method === 'GET') return send(await pharmacyProducts(db, await session(req)));
    if (path === '/api/pharmacy/products' && req.method === 'POST') return send(await saveProduct(db, await session(req), await readBody(req)), 201);
    const ownProduct = path.match(/^\/api\/pharmacy\/products\/([A-Za-z0-9-]+)$/);
    if (ownProduct && req.method === 'PATCH') return send(await saveProduct(db, await session(req), await readBody(req), ownProduct[1]));
    if (path === '/api/admin/captains') {
      await admin(req);
      return send(await db.prepare("SELECT id,name,phone FROM users WHERE role='captain'").all());
    }
    const product = path.match(/^\/api\/admin\/products\/([A-Za-z0-9-]+)$/);
    if (product && req.method === 'PATCH') {
      await admin(req);
      const b = await readBody(req);
      ensure(Number.isInteger(b.price) && b.price >= 0 && b.price <= 100000000 && Number.isInteger(b.stock) && b.stock >= 0 && b.stock <= 100000, 'أدخل سعرًا ومخزونًا صحيحين');
      const r = await transaction(db,()=>db.prepare('UPDATE products SET price=?,stock=? WHERE id=?').run(b.price, b.stock, product[1]));
      ensure(r.changes, 'المنتج غير موجود', 404);
      return send({
        ok: true
      });
    }
    const zone = path.match(/^\/api\/admin\/zones\/([a-z]+)$/);
    if (zone && req.method === 'PATCH') {
      await admin(req);
      const b = await readBody(req);
      ensure(Number.isInteger(b.fee) && b.fee >= 0 && b.fee <= 100000, 'رسوم غير صالحة');
      const r = await transaction(db,()=>db.prepare('UPDATE zones SET fee=? WHERE id=?').run(b.fee, zone[1]));
      ensure(r.changes, 'المنطقة غير موجودة', 404);
      return send({
        ok: true
      });
    }
    if (path.startsWith('/api/')) throw new ApiError(404, 'المسار غير موجود');
    ensure(req.method === 'GET' || req.method === 'HEAD', 'غير مسموح', 405);
    if (path.startsWith('/uploads/')) {
      ensure(/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(path), 'الصورة غير موجودة', 404);
      const stored=await db.prepare('SELECT mime,bytes FROM uploads WHERE id=?').get(path.slice(9));
      if(stored){res.writeHead(200,{'Content-Type':stored.mime,'Cache-Control':'public, max-age=3600'});res.end(req.method==='HEAD'?undefined:Buffer.from(stored.bytes));return;}
      const imageFile = resolve(root, 'data', '.' + path);
      ensure(existsSync(imageFile), 'الصورة غير موجودة', 404);
      res.writeHead(200, {
        'Content-Type': mime[extname(imageFile)],
        'Cache-Control': 'public, max-age=3600'
      });
      createReadStream(imageFile).pipe(res);
      return;
    }
    const dist = resolve(root, 'dist'),
      file = resolve(dist, '.' + decodeURIComponent(path));
    ensure(file.startsWith(dist + sep) || file === dist, 'مسار غير صالح', 403);
    const target = existsSync(file) && statSync(file).isFile() ? file : resolve(dist, 'index.html');
    ensure(existsSync(target), 'شغّل npm run build أولًا', 503);
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://appaccs.yrbso.app https://tile.openstreetmap.org; connect-src 'self'; font-src 'self'; frame-ancestors 'self'");
    res.writeHead(200, {
      'Content-Type': mime[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') res.end();else createReadStream(target).pipe(res);
  } catch (e) {
    if (!e.status) console.error('Request failed',e.code||e.name);
    send({
      error: e.status ? e.message : 'حدث خطأ غير متوقع. حاول مجددًا.'
    }, e.status || 500);
  }
});
server.listen(Number(process.env.PORT || 4173), process.env.HOST || (process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1'), () => console.log(`DawaPlus ready: port=${process.env.PORT || 4173} demo=${demo}`));
process.on('SIGTERM', () => server.close(async () => {
  await db.close();
  process.exit(0);
}));
