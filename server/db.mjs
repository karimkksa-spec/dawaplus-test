import {featureSchema} from './features.mjs';
import { upgradePharmacies } from './migrate.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export const root = resolve(import.meta.dirname,'..');
export function passwordHash(password,salt=randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
export function passwordMatches(password,stored) { const [salt,hash]=stored.split(':'); return timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(password,salt,64)); }
export function openDatabase(path=resolve(root,'data/dawaplus.sqlite'),demo=false) {
 if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
 const db = new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','admin','captain')),password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),stock INTEGER NOT NULL CHECK(stock>=0),image TEXT,source TEXT,review_required INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS zones(id TEXT PRIMARY KEY,name TEXT NOT NULL,fee INTEGER NOT NULL CHECK(fee>=0),active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES users(id),captain_id TEXT REFERENCES users(id),status TEXT NOT NULL,subtotal INTEGER NOT NULL,delivery_fee INTEGER NOT NULL,total INTEGER NOT NULL,payment_method TEXT NOT NULL,payment_status TEXT NOT NULL,zone_id TEXT NOT NULL REFERENCES zones(id),address TEXT NOT NULL,phone TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,idempotency_key TEXT NOT NULL,UNIQUE(customer_id,idempotency_key));
 CREATE TABLE IF NOT EXISTS order_items(order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT NOT NULL REFERENCES products(id),name TEXT NOT NULL,price INTEGER NOT NULL,quantity INTEGER NOT NULL,PRIMARY KEY(order_id,product_id));
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),actor_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL,created_at TEXT NOT NULL);
 `);
 upgradePharmacies(db);
 db.exec(featureSchema);
 db.exec('CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,mime TEXT NOT NULL,bytes BLOB NOT NULL)');
 if(!db.prepare('SELECT count(*) AS n FROM products').get().n){
  const rows=JSON.parse(readFileSync(resolve(root,'data/reference-catalog.json'),'utf8')); const seen=new Set();
  const insert=db.prepare("INSERT INTO products(id,name,category,price,stock,image,source,review_required,active,pharmacy_id) VALUES (?,?,?,?,?,?,?,?,1,'pharmacy-main')");
  for(const r of rows){const id=r.source.split('/').pop();const price=r.text.match(/([\d]+\.\d+)\s*(?:ريال يمني|ر\.ي)/)?.[1];if(seen.has(id)||!price)continue;seen.add(id);
   const hair=/شعر|شامبو/.test(r.name); const category=hair?'العناية بالشعر':'الأدوية';
   insert.run(id,r.name,category,Math.round(Number(price)),25,r.image,r.source,hair?0:1);
  }
 }
 if(!db.prepare('SELECT count(*) AS n FROM zones').get().n){
  for(const [id,name,fee] of [['mansoura','المنصورة',1000],['sheikh','الشيخ عثمان',1200],['khormaksar','خور مكسر',1500],['crater','كريتر',1800],['maalla','المعلا',1500],['tawahi','التواهي',2000],['dar','دار سعد',1500],['buraiqa','البريقة',2500]]) db.prepare('INSERT INTO zones VALUES (?,?,?,1)').run(id,name,fee);
 }
 if(demo){for(const [id,name,phone,role] of [['customer-demo','عميل تجريبي','770000001','customer'],['admin-demo','إدارة دواء بلس','770000002','admin'],['captain-demo','كابتن تجريبي','770000003','captain'],['pharmacy-demo','صاحب صيدلية تجريبي','770000004','pharmacy'],['pharmacy-two-demo','صيدلية ثانية للاختبار','770000005','pharmacy']]) db.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?)').run(id,name,phone,role,passwordHash('DawaDemo2026!'));}
 if(demo){db.prepare("UPDATE pharmacies SET owner_id='pharmacy-demo' WHERE id='pharmacy-main'").run();db.prepare("INSERT OR IGNORE INTO pharmacies(id,name,owner_id) VALUES ('pharmacy-second','الصيدلية الثانية التجريبية','pharmacy-two-demo')").run();}
 const assetManifest=resolve(root,'data/local-assets.json');
 if(existsSync(assetManifest)){for(const [id,image] of Object.entries(JSON.parse(readFileSync(assetManifest,'utf8'))))db.prepare("UPDATE products SET image=? WHERE id=? AND (image LIKE 'https://appaccs.yrbso.app/%' OR image IS NULL)").run(image,id);}
 return db;
}
