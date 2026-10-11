// Upgrade the existing pilot database without discarding users or orders.
export function upgradePharmacies(db){
 const schema=db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql;
 if(!schema.includes("'pharmacy'")){
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try{db.exec(`CREATE TABLE users_v2(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','admin','captain','pharmacy')),password TEXT NOT NULL);
   INSERT INTO users_v2 SELECT * FROM users; DROP TABLE users; ALTER TABLE users_v2 RENAME TO users; COMMIT;`);
  }catch(e){db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys=ON');}
 }
 db.exec(`CREATE TABLE IF NOT EXISTS pharmacies(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT UNIQUE REFERENCES users(id),active INTEGER NOT NULL DEFAULT 1);
 INSERT OR IGNORE INTO pharmacies(id,name) VALUES ('pharmacy-main','صيدلية دواء بلس التجريبية');`);
 for(const table of ['products','orders']){
  if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='pharmacy_id'))db.exec(`ALTER TABLE ${table} ADD COLUMN pharmacy_id TEXT REFERENCES pharmacies(id)`);
  db.prepare(`UPDATE ${table} SET pharmacy_id='pharmacy-main' WHERE pharmacy_id IS NULL`).run();
 }
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Database foreign key check failed');
 for(const column of ['delivery_lat','delivery_lng']){
  if(!db.prepare('PRAGMA table_info(orders)').all().some(c=>c.name===column))db.exec(`ALTER TABLE orders ADD COLUMN ${column} REAL`);
 }
 db.exec(`CREATE TABLE IF NOT EXISTS order_locations(order_id TEXT PRIMARY KEY REFERENCES orders(id),captain_id TEXT NOT NULL REFERENCES users(id),lat REAL NOT NULL,lng REAL NOT NULL,accuracy REAL NOT NULL,observed_at INTEGER NOT NULL,received_at TEXT NOT NULL); PRAGMA user_version=3;`);
}
