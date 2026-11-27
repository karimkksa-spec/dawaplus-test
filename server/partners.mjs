import { randomBytes, randomUUID } from 'node:crypto';
import { passwordHash, passwordMatches } from './db.mjs';
import { admins, notifyUsers, phoneNumber } from './features.mjs';
import { ensure, transaction } from './service.mjs';
import { addPharmacyLogin } from './accounts.mjs';

export const partnerSchema = `
CREATE TABLE IF NOT EXISTS partner_applications(
 id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('captain','pharmacy')),
 name TEXT NOT NULL, phone TEXT NOT NULL, zone_id TEXT NOT NULL REFERENCES zones(id),
 pharmacy_name TEXT, address TEXT, password_hash TEXT,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT REFERENCES users(id),
 reason TEXT, user_id TEXT UNIQUE REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_pending_phone ON partner_applications(phone) WHERE status='pending';
CREATE INDEX IF NOT EXISTS partner_review_queue ON partner_applications(status,created_at);
CREATE TABLE IF NOT EXISTS captain_accounts(
 user_id TEXT PRIMARY KEY REFERENCES users(id), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);`;

function field(value, label, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  ensure(text.length >= 2 && text.length <= max, 'تحقق من ' + label);
  return text;
}

function requireRole(role) {
  ensure(role === 'captain' || role === 'pharmacy', 'اختر نوع الشريك');
}

export async function requestPartnership(db, body) {
  requireRole(body?.role);
  const name = field(body.name, 'اسم مقدم الطلب', 80);
  const phone = phoneNumber(body.phone);
  ensure(typeof body.password === 'string' && body.password.length >= 10 && body.password.length <= 128, 'كلمة المرور من 10 إلى 128 حرفًا');
  const pharmacy = body.role === 'pharmacy';
  const pharmacyName = pharmacy ? field(body.pharmacyName, 'اسم الصيدلية', 120) : null;
  const address = pharmacy ? field(body.address, 'عنوان الصيدلية', 250) : null;
  ensure(typeof body.zoneId === 'string', 'اختر منطقة الخدمة');
  return transaction(db, async () => {
    ensure(await db.prepare('SELECT id FROM zones WHERE id=? AND active=1').get(body.zoneId), 'اختر منطقة خدمة متاحة');
    ensure(!await db.prepare('SELECT id FROM users WHERE phone=?').get(phone), 'الرقم مرتبط بحساب قائم', 409);
    const pending = await db.prepare("SELECT id,role,password_hash FROM partner_applications WHERE phone=? AND status='pending'").get(phone);
    if (pending) {
      ensure(pending.role === body.role && passwordMatches(body.password, pending.password_hash), 'يوجد طلب قيد المراجعة لهذا الرقم', 409);
      return { id: pending.id, status: 'pending' };
    }
    const id = 'JOIN-' + randomUUID();
    await db.prepare(`INSERT INTO partner_applications
      (id,role,name,phone,zone_id,pharmacy_name,address,password_hash,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',?)`).run(id, body.role, name, phone, body.zoneId, pharmacyName, address, passwordHash(body.password), new Date().toISOString());
    await notifyUsers(db, await admins(db), pharmacy ? 'طلب انضمام صيدلية جديدة' : 'طلب انضمام مندوب جديد', id);
    return { id, status: 'pending' };
  });
}

export async function applicationStatus(db, body) {
  requireRole(body?.role);
  const phone = phoneNumber(body.phone);
  ensure(typeof body.password === 'string' && body.password.length > 0 && body.password.length <= 128, 'تحقق من كلمة المرور');
  const row = await db.prepare(`SELECT a.status,a.reason,a.created_at,a.reviewed_at,COALESCE(a.password_hash,u.password) AS credential
    FROM partner_applications a LEFT JOIN users u ON u.id=a.user_id
    WHERE a.phone=? AND a.role=? ORDER BY a.created_at DESC,a.id DESC LIMIT 1`).get(phone, body.role);
  ensure(row?.credential && passwordMatches(body.password, row.credential), 'تعذر العثور على طلب بهذه البيانات', 401);
  const { credential, ...result } = row;
  return result;
}

export async function applications(db, admin) {
  ensure(admin.role === 'admin', 'للإدارة فقط', 403);
  return db.prepare(`SELECT a.id,a.role,a.name,a.phone,a.pharmacy_name,a.address,a.status,a.reason,
    a.created_at,a.reviewed_at,z.name AS zone_name,r.name AS reviewer
    FROM partner_applications a JOIN zones z ON z.id=a.zone_id LEFT JOIN users r ON r.id=a.reviewed_by
    ORDER BY CASE WHEN a.status='pending' THEN 0 ELSE 1 END,a.created_at DESC,a.id`).all();
}

export async function reviewApplication(db, admin, id, body) {
  ensure(admin.role === 'admin', 'للإدارة فقط', 403);
  ensure(['approved','rejected'].includes(body?.status), 'اختر قرار المراجعة');
  const approved = body.status === 'approved';
  const reason = approved ? null : field(body.reason, 'سبب الرفض', 350);
  return transaction(db, async () => {
    const row = await db.prepare('SELECT * FROM partner_applications WHERE id=?').get(id);
    ensure(row, 'طلب الانضمام غير موجود', 404);
    if (row.status === body.status) return { status: row.status };
    ensure(row.status === 'pending', 'سبق اتخاذ قرار بشأن الطلب. حدّث القائمة', 409);
    let userId = null;
    if (approved) {
      ensure(!await db.prepare('SELECT id FROM users WHERE phone=?').get(row.phone), 'الرقم مرتبط بحساب قائم. راجع الطلب قبل اتخاذ القرار', 409);
      if (row.role === 'pharmacy') {
        const pharmacyId = 'ph-' + randomUUID();
        await db.prepare('INSERT INTO pharmacies(id,name,active) VALUES (?,?,1)').run(pharmacyId, row.pharmacy_name);
        const account = await addPharmacyLogin(db, { name:row.name, phone:row.phone, hash:row.password_hash, pharmacyId, kind:'pharmacy', active:true });
        userId = account.id;
      } else {
        userId = await addCaptain(db, row.name, row.phone, row.password_hash);
      }
    }
    await db.prepare(`UPDATE partner_applications SET status=?,reason=?,user_id=?,reviewed_at=?,reviewed_by=?,
      password_hash=CASE WHEN ?='approved' THEN NULL ELSE password_hash END WHERE id=?`)
      .run(body.status, reason, userId, new Date().toISOString(), admin.id, body.status, id);
    return { status:body.status };
  });
}

async function addCaptain(db, name, phone, hash) {
  const id = 'captain-' + randomUUID();
  await db.prepare("INSERT INTO users(id,name,phone,role,password) VALUES (?,?,?,'captain',?)").run(id,name,phone,hash);
  await db.prepare('INSERT INTO captain_accounts(user_id,active) VALUES (?,1)').run(id);
  return id;
}

export const availableCaptains = `SELECT u.id,u.name,u.phone FROM users u
  LEFT JOIN captain_accounts c ON c.user_id=u.id WHERE u.role='captain' AND COALESCE(c.active,1)=1`;

export async function captainAccounts(db, admin) {
  ensure(admin.role === 'admin', 'للإدارة فقط', 403);
  return db.prepare(`SELECT u.id,u.name,u.phone,COALESCE(c.active,1) AS active,
    (SELECT COUNT(*) FROM orders o WHERE o.captain_id=u.id AND o.status NOT IN ('delivered','cancelled')) AS active_orders
    FROM users u LEFT JOIN captain_accounts c ON c.user_id=u.id WHERE u.role='captain' ORDER BY u.name,u.id`).all();
}

export async function manageCaptain(db, admin, id, body) {
  ensure(admin.role === 'admin', 'للإدارة فقط', 403);
  return transaction(db, async () => {
    if (!id) {
      const name = field(body.name, 'اسم المندوب', 80), phone = phoneNumber(body.phone);
      ensure(!await db.prepare('SELECT id FROM users WHERE phone=?').get(phone), 'الرقم مرتبط بحساب قائم', 409);
      ensure(!await db.prepare("SELECT id FROM partner_applications WHERE phone=? AND status='pending'").get(phone), 'راجع طلب الانضمام المعلّق لهذا الرقم أولًا', 409);
      const password = randomBytes(18).toString('base64url');
      return { id:await addCaptain(db,name,phone,passwordHash(password)), phone, password };
    }
    const user = await db.prepare("SELECT phone FROM users WHERE id=? AND role='captain'").get(id);
    ensure(user, 'حساب المندوب غير موجود', 404);
    if (body.reset === true) {
      const password = randomBytes(18).toString('base64url');
      await db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(password), id);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      return { phone:user.phone, password };
    }
    ensure(typeof body.active === 'boolean', 'اختر حالة الحساب');
    if (!body.active) {
      ensure(!await db.prepare("SELECT id FROM orders WHERE captain_id=? AND status NOT IN ('delivered','cancelled') LIMIT 1").get(id), 'للمندوب توصيلات جارية. أكملها قبل إيقاف الحساب', 409);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    }
    await db.prepare('INSERT INTO captain_accounts(user_id,active) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET active=excluded.active').run(id,Number(body.active));
    return { id, active:body.active };
  });
}
