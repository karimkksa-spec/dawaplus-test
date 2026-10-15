import {initializeDispatch,acceptDispatch,notifyOrder,labels,fulfillment,candidates} from './features.mjs';
import { deliveryPoint } from './location.mjs';
import { randomUUID } from 'node:crypto';
import {transaction} from './transaction.mjs';
export {transaction} from './transaction.mjs';
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function ensure(condition, message, status = 400) {
  if (!condition) throw new ApiError(status, message);
}
export async function listOrders(db, user) {
  let rows;
  if(user.role==='pharmacy'){
    const ph=await db.prepare('SELECT id FROM pharmacies WHERE owner_id=? AND active=1').get(user.id);
    if(!ph)return [];
    rows=await db.prepare("SELECT o.* FROM orders o LEFT JOIN order_dispatch d ON d.order_id=o.id WHERE o.pharmacy_id=? OR (o.status='pending' AND d.mode='auto' AND d.accepted=0) ORDER BY o.created_at DESC").all(ph.id);
    const visible=[];
    for(const o of rows){const d=await db.prepare('SELECT * FROM order_dispatch WHERE order_id=?').get(o.id);if(o.status==='pending'&&d?.mode==='auto'){if(!await fulfillment(db,o,ph.id))continue;o.is_offer=true;o.phone='';o.address='';o.note='';o.delivery_lat=null;o.delivery_lng=null;o.customer_id=null;}visible.push(o);}rows=visible;
  }else{
    const where=user.role==='admin'?'1=1':user.role==='captain'?'captain_id=?':'customer_id=?';
    rows=await db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC`).all(...(user.role==='admin'?[]:[user.id]));
  }
  for(const o of rows){
    o.dispatch=await db.prepare('SELECT mode,accepted FROM order_dispatch WHERE order_id=?').get(o.id)||{mode:'manual',accepted:o.status==='pending'?0:1};
    o.captain_location=user.role==='pharmacy'?null:(await db.prepare('SELECT lat,lng,accuracy,observed_at,received_at FROM order_locations WHERE order_id=?').get(o.id))||null;
    o.items=await db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
    o.events=await db.prepare('SELECT status,created_at FROM events WHERE order_id=? ORDER BY id').all(o.id);
    if(user.role==='admin'&&o.status==='pending')o.candidates=(await candidates(db,o)).map(p=>({id:p.id,name:p.name}));
  }
  return rows;
}
export async function createOrder(db, user, body, key) {
  ensure(user.role === 'customer', 'إنشاء الطلب متاح للعميل فقط', 403);
  ensure(typeof key === 'string' && key.length >= 8 && key.length <= 100, 'معرّف الطلب غير صالح');
  return await transaction(db, async () => {
    const existing = await db.prepare('SELECT id FROM orders WHERE customer_id=? AND idempotency_key=?').get(user.id, key);
    if (existing) return {
      id: existing.id
    };
    ensure(body.paymentMethod === 'cash', 'الدفع بالمحافظ قيد التجهيز، اختر الدفع عند الاستلام');
    ensure(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 50, 'السلة غير صالحة');
    const point = deliveryPoint(body.deliveryLocation);
    ensure(body.address === undefined || typeof body.address === 'string' && body.address.length <= 400, 'وصف العنوان طويل جدًا');
    ensure(typeof body.phone === 'string' && /^(?:\+967)?7\d{8}$/.test(body.phone), 'أدخل رقم هاتف يمني صحيح');
    ensure(!body.note || typeof body.note === 'string' && body.note.length <= 500, 'الملاحظة طويلة جدًا');
    const zone = await db.prepare('SELECT * FROM zones WHERE id=? AND active=1').get(String(body.zoneId));
    ensure(zone, 'منطقة التوصيل غير متاحة');
    let subtotal = 0;
    const seen = new Set();
    const items = [];
    for (const i of body.items) {
      ensure(typeof i.productId === 'string' && !seen.has(i.productId), 'منتج مكرر أو غير صالح');
      seen.add(i.productId);
      ensure(Number.isInteger(i.quantity) && i.quantity >= 1 && i.quantity <= 20, 'الكمية غير صالحة');
      const p = await db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(i.productId);
      ensure(p && p.stock >= i.quantity, 'أحد المنتجات غير متوفر بالكمية المطلوبة', 409);
      subtotal += p.price * i.quantity;
      items.push({
        ...p,
        quantity: i.quantity
      });
    }
    ensure(items.every(p => p.pharmacy_id && p.pharmacy_id === items[0].pharmacy_id), 'اجمع منتجات صيدلية واحدة في كل طلب');
    ensure(await db.prepare('SELECT id FROM pharmacies WHERE id=? AND active=1').get(items[0].pharmacy_id), 'الصيدلية غير متاحة');
    const id = 'DP-' + randomUUID().slice(0, 8).toUpperCase(),
      now = new Date().toISOString();
    await db.prepare('INSERT INTO orders(id,customer_id,captain_id,status,subtotal,delivery_fee,total,payment_method,payment_status,zone_id,address,phone,note,created_at,idempotency_key,pharmacy_id,delivery_lat,delivery_lng) VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, user.id, 'pending', subtotal, zone.fee, subtotal + zone.fee, 'cash', 'unpaid', zone.id, (body.address || '').trim(), body.phone, body.note || '', now, key, items[0].pharmacy_id, point.lat, point.lng);
    for (const p of items) {
      await db.prepare('INSERT INTO order_items VALUES (?,?,?,?,?)').run(id, p.id, p.name, p.price, p.quantity);
      await db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(p.quantity, p.id);
    }
    await db.prepare('INSERT INTO events(order_id,actor_id,status,created_at) VALUES (?,?,?,?)').run(id, user.id, 'pending', now);
    await initializeDispatch(db,id);
    return {
      id
    };
  });
}
export async function changeOrder(db, user, id, body) {
  return await transaction(db, async () => {
    const o = await db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    ensure(o, 'الطلب غير موجود', 404);
    const status = body.status;
    let captain = o.captain_id;
    const transitions = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['preparing', 'cancelled'],
      preparing: ['ready','cancelled'],
      ready: ['assigned', 'cancelled'],
      assigned: ['picked_up', 'cancelled'],
      picked_up: ['on_the_way'],
      on_the_way: ['arrived'],
      arrived: ['delivered'],
      delivered: [],
      cancelled: []
    };
    ensure(transitions[o.status]?.includes(status), 'لا يمكن الانتقال إلى هذه الحالة', 409);
    if(user.role==='customer')ensure(o.customer_id===user.id&&o.status==='pending'&&status==='cancelled','لا تملك صلاحية تعديل الطلب',403);
    else if(user.role==='captain')ensure(o.captain_id===user.id&&['picked_up','on_the_way','arrived','delivered'].includes(status),'لا تملك صلاحية تعديل الطلب',403);
    else if(user.role==='pharmacy'){
      if(status!=='confirmed'){
        const d=await db.prepare('SELECT mode FROM order_dispatch WHERE order_id=?').get(id);
        ensure(!(o.status==='pending'&&d?.mode==='auto'),'لا يمكن إلغاء عرض متاح لصيدليات أخرى',403);
        ensure(await db.prepare('SELECT id FROM pharmacies WHERE id=? AND owner_id=? AND active=1').get(o.pharmacy_id,user.id),'غير مصرح',403);
      }
      ensure(['confirmed','preparing','ready','cancelled'].includes(status)&&['pending','confirmed','preparing'].includes(o.status),'غير مصرح',403);
    }else ensure(user.role==='admin','غير مصرح',403);
    if(status==='confirmed'){
      ensure(body.reviewed===true,'يجب تأكيد توفر جميع الأصناف ومراجعة متطلبات الوصفة');
      const d=await db.prepare('SELECT mode FROM order_dispatch WHERE order_id=?').get(id);
      if(user.role==='pharmacy'&&d?.mode!=='auto')ensure(await db.prepare('SELECT id FROM pharmacies WHERE id=? AND owner_id=? AND active=1').get(o.pharmacy_id,user.id),'غير مصرح',403);
      await acceptDispatch(db,user,o);
    }
    if (status === 'assigned') {
      ensure(user.role === 'admin', 'الإسناد متاح للإدارة فقط', 403);
      const c = await db.prepare("SELECT id FROM users WHERE id=? AND role='captain'").get(String(body.captainId));
      ensure(c, 'الكابتن غير صالح');
      captain = c.id;
    }
    if (status === 'delivered') ensure(body.cashCollected === true, 'أكد استلام المبلغ النقدي قبل إتمام التسليم');
    if (status === 'cancelled') for (const i of await db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id)) await db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(i.quantity, i.product_id);
    if (['delivered', 'cancelled'].includes(status)) await db.prepare('DELETE FROM order_locations WHERE order_id=?').run(id);
    await db.prepare('UPDATE orders SET status=?,captain_id=?,payment_status=? WHERE id=?').run(status, captain, status === 'delivered' ? 'collected' : o.payment_status, id);
    await db.prepare('INSERT INTO events(order_id,actor_id,status,created_at) VALUES (?,?,?,?)').run(id, user.id, status, new Date().toISOString());
    await notifyOrder(db,id,labels[status]+' — '+id);
    return {
      id,
      status
    };
  });
}
