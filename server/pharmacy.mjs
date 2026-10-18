import {categoryNames} from './content.mjs';
import {pharmacyScope} from './accounts.mjs';
import {saveInfo,productDetails} from './features.mjs';
import { randomUUID } from 'node:crypto';
import { ensure, transaction } from './service.mjs';
export async function ownPharmacy(db, user) {
  ensure(user.role === 'pharmacy', 'هذه الخدمة لصاحب الصيدلية فقط', 403);
  const p = await db.prepare(pharmacyScope).get(user.id,user.id);
  ensure(p, 'لا توجد صيدلية مفعلة لهذا الحساب', 403);
  return p;
}
export async function pharmacyProducts(db, user) {
  const p = await ownPharmacy(db, user);
  return productDetails(db,await db.prepare('SELECT * FROM products WHERE pharmacy_id=? ORDER BY name,id').all(p.id));
}
export function validateProduct(body) {
  ensure(typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.length <= 120, 'أدخل اسم المنتج من حرفين إلى 120 حرفًا');
  ensure(categoryNames.includes(body.category), 'اختر قسمًا صالحًا');
  ensure(Number.isInteger(body.price) && body.price >= 0 && body.price <= 100000000, 'أدخل سعرًا صحيحًا');
  ensure(Number.isInteger(body.stock) && body.stock >= 0 && body.stock <= 100000, 'أدخل مخزونًا صحيحًا');
  ensure(typeof body.active === 'boolean', 'حالة عرض المنتج غير صالحة');
}
export function decodeImage(data) {
  ensure(typeof data === 'string', 'الصورة غير صالحة');
  const m = data.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  ensure(m, 'استخدم صورة PNG أو JPEG أو WebP');
  const bytes = Buffer.from(m[2], 'base64');
  ensure(bytes.length > 12 && bytes.length <= 1024 * 1024, 'حجم الصورة يجب ألا يتجاوز 1 ميجابايت');
  const valid = m[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : m[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  ensure(valid, 'محتوى الصورة لا يطابق نوعها');
  return {
    bytes,
    extension: m[1] === 'jpeg' ? 'jpg' : m[1]
  };
}
export async function saveProduct(db, user, body, id = null) {
  return await transaction(db, async () => {
    const pharmacy = await ownPharmacy(db, user);
    validateProduct(body);
    let existing = null;
    if (id) {
      existing = await db.prepare('SELECT * FROM products WHERE id=? AND pharmacy_id=?').get(id, pharmacy.id);
      ensure(existing, 'المنتج غير موجود في صيدليتك', 404);
      ensure(Number.isInteger(body.expectedStock) && body.expectedStock === existing.stock, 'تغيّر المخزون منذ فتح المنتج. أغلق النموذج وأعد فتحه لمراجعة الكمية الحالية.', 409);
    }
    let image = existing?.image || '/product-placeholder.svg';
    if (body.imageData) {
      const decoded = decodeImage(body.imageData),
        name = randomUUID() + '.' + decoded.extension;
      await db.prepare('INSERT INTO uploads(id,mime,bytes) VALUES (?,?,?)').run(name,decoded.extension==='jpg'?'image/jpeg':'image/'+decoded.extension,decoded.bytes);
      image = '/uploads/' + name;
    }
    const productId = id || 'P-' + randomUUID();
    if (id) await db.prepare('UPDATE products SET name=?,category=?,price=?,stock=?,active=?,review_required=?,image=? WHERE id=? AND pharmacy_id=?').run(body.name.trim(), body.category, body.price, body.stock, Number(body.active), Number(body.category === 'الأدوية'), image, id, pharmacy.id);else await db.prepare('INSERT INTO products(id,name,category,price,stock,image,source,review_required,active,pharmacy_id) VALUES (?,?,?,?,?,?,NULL,?,?,?)').run(productId, body.name.trim(), body.category, body.price, body.stock, image, Number(body.category === 'الأدوية'), Number(body.active), pharmacy.id);
    await saveInfo(db,productId,body);
    if(existing?.image?.startsWith('/uploads/')&&existing.image!==image)await db.prepare('DELETE FROM uploads WHERE id=?').run(existing.image.slice(9));
    return {
      id: productId
    };
  });
}
