import { ensure } from './service.mjs';
import {transaction} from './transaction.mjs';
export function validPoint(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}
export function deliveryPoint(p) {
  ensure(validPoint(p), 'حدد موقع التسليم على الخريطة أولًا');
  ensure(p.lat >= 12.65 && p.lat <= 13.05 && p.lng >= 44.6 && p.lng <= 45.2, 'اختر نقطة داخل نطاق عدن التجريبي');
  return p;
}
export async function shareLocation(db, user, id, body) {
 return transaction(db,async()=>{
  const o = await db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  ensure(o, 'الطلب غير موجود', 404);
  ensure(user.role === 'captain' && o.captain_id === user.id, 'مشاركة الموقع متاحة لكابتن الطلب فقط', 403);
  if (body.action === 'stop') {
    await db.prepare('DELETE FROM order_locations WHERE order_id=?').run(id);
    return {
      ok: true
    };
  }
  ensure(['assigned', 'picked_up', 'on_the_way', 'arrived'].includes(o.status), 'التتبع متاح أثناء مهمة التوصيل فقط', 409);
  ensure(validPoint(body), 'إحداثيات الموقع غير صالحة');
  ensure(Number.isFinite(body.accuracy) && body.accuracy >= 0 && body.accuracy <= 10000, 'دقة الموقع غير صالحة');
  const now = Date.now();
  ensure(Number.isFinite(body.observedAt) && body.observedAt <= now + 10000 && body.observedAt >= now - 60000, 'الموقع قديم، انتظر قراءة GPS جديدة');
  const previous = await db.prepare('SELECT observed_at FROM order_locations WHERE order_id=?').get(id);
  ensure(!previous || body.observedAt >= previous.observed_at, 'وصل موقع أقدم من آخر تحديث', 409);
  await db.prepare(`INSERT INTO order_locations VALUES (?,?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET captain_id=excluded.captain_id,lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,observed_at=excluded.observed_at,received_at=excluded.received_at`).run(id, user.id, body.lat, body.lng, body.accuracy, body.observedAt, new Date(now).toISOString());
  return {
    ok: true
  };
 });
}
