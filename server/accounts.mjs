import {randomUUID,randomBytes} from 'node:crypto';
import {passwordHash} from './db.mjs';
import {ensure,transaction} from './service.mjs';
import {phoneNumber} from './features.mjs';
export const accountSchema=`CREATE TABLE IF NOT EXISTS pharmacy_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id),pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id),username TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);`;
// Preserve the original phone login and credentials of pharmacies created before staff accounts.
export const enrollExistingOwners = `INSERT INTO pharmacy_accounts(user_id,pharmacy_id,username,kind,active)
  SELECT u.id,p.id,'dp-owner-' || u.id,'pharmacy',1
  FROM pharmacies p JOIN users u ON u.id=p.owner_id
  WHERE u.role='pharmacy' AND NOT EXISTS (SELECT 1 FROM pharmacy_accounts a WHERE a.user_id=u.id)
  ON CONFLICT(user_id) DO NOTHING`;
export const pharmacyScope="SELECT p.id,p.name FROM pharmacies p WHERE p.active=1 AND (p.owner_id=? OR p.id IN (SELECT pharmacy_id FROM pharmacy_accounts WHERE user_id=? AND active=1))";
export async function accountList(db,u){ensure(u.role==='admin','للإدارة فقط',403);return db.prepare('SELECT a.*,u.name AS employee_name,u.phone,p.name AS pharmacy_name FROM pharmacy_accounts a JOIN users u ON u.id=a.user_id JOIN pharmacies p ON p.id=a.pharmacy_id ORDER BY p.name,u.name').all();}
export async function addPharmacyLogin(db, { name, phone, hash, pharmacyId, kind, active }) {
  const id = 'staff-' + randomUUID();
  const username = 'dp-' + randomBytes(6).toString('hex');
  await db.prepare("INSERT INTO users(id,name,phone,role,password) VALUES (?,?,?,'pharmacy',?)").run(id,name,phone,hash);
  await db.prepare('INSERT INTO pharmacy_accounts(user_id,pharmacy_id,username,kind,active) VALUES (?,?,?,?,?)').run(id,pharmacyId,username,kind,Number(active));
  if (kind === 'pharmacy') await db.prepare('UPDATE pharmacies SET owner_id=? WHERE id=? AND owner_id IS NULL').run(id,pharmacyId);
  return { id, username };
}

export async function saveAccount(db,u,b,id){ensure(u.role==='admin','للإدارة فقط',403);return transaction(db,async()=>{
 const old=id?await db.prepare('SELECT * FROM pharmacy_accounts WHERE user_id=?').get(id):null;ensure(!id||old,'الحساب غير موجود',404);
 if(b.reset){ensure(old,'الحساب غير موجود',404);const password=randomBytes(18).toString('base64url');await db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(password),id);await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);return {username:old.username,password};}
 ensure(typeof b.pharmacyName==='string'&&b.pharmacyName.trim().length>=2&&b.pharmacyName.length<=120,'أدخل اسم الصيدلية');ensure(typeof b.employeeName==='string'&&b.employeeName.trim().length>=2&&b.employeeName.length<=80,'أدخل اسم الموظف');ensure(['pharmacy','cashier'].includes(b.kind),'اختر نوع الحساب');ensure(typeof b.active==='boolean','حالة غير صالحة');const phone=phoneNumber(b.phone);
 const duplicate=await db.prepare('SELECT id FROM users WHERE phone=?').get(phone);ensure(!duplicate||duplicate.id===id,'رقم الهاتف مسجل بالفعل',409);
 let pharmacyId=old?.pharmacy_id||b.pharmacyId;
 if(pharmacyId){ensure(await db.prepare('SELECT id FROM pharmacies WHERE id=? AND active=1').get(pharmacyId),'الصيدلية غير موجودة');}
 else {ensure(b.kind==='pharmacy','اختر صيدلية للكاشير');pharmacyId='ph-'+randomUUID();await db.prepare('INSERT INTO pharmacies(id,name,active) VALUES (?,?,1)').run(pharmacyId,b.pharmacyName.trim());}
 let userId=id,username=old?.username,password;
 if(old){await db.prepare('UPDATE users SET name=?,phone=? WHERE id=?').run(b.employeeName.trim(),phone,userId);await db.prepare('UPDATE pharmacy_accounts SET kind=?,active=? WHERE user_id=?').run(b.kind,Number(b.active),userId);await db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);}
 else {
  ensure(!await db.prepare("SELECT id FROM partner_applications WHERE phone=? AND status='pending'").get(phone),'راجع طلب الانضمام المعلّق لهذا الرقم أولًا',409);
  password=randomBytes(18).toString('base64url');
  ({id:userId,username}=await addPharmacyLogin(db,{name:b.employeeName.trim(),phone,hash:passwordHash(password),pharmacyId,kind:b.kind,active:b.active}));
 }
 await db.prepare('UPDATE pharmacies SET name=? WHERE id=?').run(b.pharmacyName.trim(),pharmacyId);
 return {id:userId,username,...(password?{password}:{})};});}
export async function enabledAccount(db,id){const a=await db.prepare("SELECT active,kind FROM pharmacy_accounts WHERE user_id=? UNION ALL SELECT active,'captain' AS kind FROM captain_accounts WHERE user_id=?").get(id,id);ensure(!a||a.active===1,'هذا الحساب معطل، تواصل مع الإدارة',403);return a;}
