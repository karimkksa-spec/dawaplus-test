import {guestSchema} from './guest.mjs';
import {accountSchema} from './accounts.mjs';
import {featureSchema} from './features.mjs';
import pg from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
import {openDatabase,passwordHash} from './db.mjs';

// All cloud tables live outside the schemas exposed by the Supabase Data API.
export const schemaSql=`
CREATE SCHEMA IF NOT EXISTS dawapp;
REVOKE ALL ON SCHEMA dawapp FROM PUBLIC;
CREATE TABLE IF NOT EXISTS dawapp.users(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','admin','captain','pharmacy')),password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dawapp.sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES dawapp.users(id),expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS dawapp.pharmacies(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT UNIQUE REFERENCES dawapp.users(id),active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS dawapp.products(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),stock INTEGER NOT NULL CHECK(stock>=0),image TEXT,source TEXT,review_required INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1,pharmacy_id TEXT REFERENCES dawapp.pharmacies(id));
CREATE TABLE IF NOT EXISTS dawapp.zones(id TEXT PRIMARY KEY,name TEXT NOT NULL,fee INTEGER NOT NULL CHECK(fee>=0),active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS dawapp.orders(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES dawapp.users(id),captain_id TEXT REFERENCES dawapp.users(id),status TEXT NOT NULL,subtotal INTEGER NOT NULL,delivery_fee INTEGER NOT NULL,total INTEGER NOT NULL,payment_method TEXT NOT NULL,payment_status TEXT NOT NULL,zone_id TEXT NOT NULL REFERENCES dawapp.zones(id),address TEXT NOT NULL,phone TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,idempotency_key TEXT NOT NULL,pharmacy_id TEXT REFERENCES dawapp.pharmacies(id),delivery_lat DOUBLE PRECISION,delivery_lng DOUBLE PRECISION,UNIQUE(customer_id,idempotency_key));
CREATE TABLE IF NOT EXISTS dawapp.order_items(order_id TEXT NOT NULL REFERENCES dawapp.orders(id),product_id TEXT NOT NULL REFERENCES dawapp.products(id),name TEXT NOT NULL,price INTEGER NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),PRIMARY KEY(order_id,product_id));
CREATE TABLE IF NOT EXISTS dawapp.events(id BIGSERIAL PRIMARY KEY,order_id TEXT NOT NULL REFERENCES dawapp.orders(id),actor_id TEXT NOT NULL REFERENCES dawapp.users(id),status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dawapp.order_locations(order_id TEXT PRIMARY KEY REFERENCES dawapp.orders(id),captain_id TEXT NOT NULL REFERENCES dawapp.users(id),lat DOUBLE PRECISION NOT NULL,lng DOUBLE PRECISION NOT NULL,accuracy DOUBLE PRECISION NOT NULL,observed_at BIGINT NOT NULL,received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dawapp.uploads(id TEXT PRIMARY KEY,mime TEXT NOT NULL,bytes BYTEA NOT NULL);
CREATE INDEX IF NOT EXISTS orders_customer ON dawapp.orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_captain ON dawapp.orders(captain_id);
CREATE INDEX IF NOT EXISTS orders_pharmacy ON dawapp.orders(pharmacy_id);
CREATE INDEX IF NOT EXISTS events_order ON dawapp.events(order_id);
`;

// Queries are application-owned SQL. Skip quoted text when binding placeholders.
export function parameters(sql){let n=0;return sql.replace(/'(?:''|[^'])*'|\?/g,part=>part==='?'?'$'+(++n):part);}
export function createAdapter(driver){
 const context=new AsyncLocalStorage();
 const query=(sql,args=[])=> (context.getStore()||driver).query(parameters(sql),args);
 return {
  dialect:'postgres',
  prepare(sql){return {async get(...args){return (await query(sql,args)).rows[0];},async all(...args){return (await query(sql,args)).rows;},async run(...args){const r=await query(sql,args);return {changes:r.rowCount??r.affectedRows};}};},
  exec(sql){return (context.getStore()||driver).query(sql);},
  async transaction(fn){
   if(context.getStore())return fn();
   const connection=driver.connect?await driver.connect():driver;
   try{return await context.run(connection,async()=>{
    await connection.query('BEGIN');
    try{
     // Pilot scale: serialize business writes across processes, including inventory
     // reservations and status changes. Reads and session traffic remain independent.
     await connection.query('SELECT pg_advisory_xact_lock(7142026)');
     const result=await fn();await connection.query('COMMIT');return result;
    }catch(error){await connection.query('ROLLBACK');throw error;}
   });}finally{connection.release?.();}
  },
  close(){return driver.end?driver.end():driver.close();}
 };
}

export async function initializeCloud(db,accounts=[]){
 await db.transaction(async()=>{
  await db.exec(schemaSql);
  await db.exec('SET search_path TO dawapp');
  await db.exec(featureSchema);
 await db.exec(accountSchema);
 await db.exec(guestSchema);
  const reference=openDatabase(':memory:',false);
  try{
   for(const table of ['pharmacies','zones','products']){
    for(const row of reference.prepare(`SELECT * FROM ${table}`).all()){
     const keys=Object.keys(row);
     await db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')}) ON CONFLICT(id) DO NOTHING`).run(...Object.values(row));
    }
   }
  }finally{reference.close();}
  for(const account of accounts){
   if(!['customer','admin','captain','pharmacy'].includes(account.role)||typeof account.password!=='string'||account.password.length<16||!/^7\d{8}$/.test(account.phone)||typeof account.name!=='string')throw new Error('Invalid PILOT_ACCOUNTS configuration');
   const id='pilot-'+account.role;
   await db.prepare('INSERT INTO users VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(id,account.name,account.phone,account.role,passwordHash(account.password));
   if(account.role==='pharmacy')await db.prepare("UPDATE pharmacies SET owner_id=? WHERE id='pharmacy-main' AND owner_id IS NULL").run(id);
  }
 });
}

export async function openPostgres(connectionString){
 if(process.env.DEMO_MODE==='true')throw new Error('Public demo credentials cannot be enabled with PostgreSQL');
 const url=new URL(connectionString);
 if(process.env.DATABASE_PASSWORD)url.password=process.env.DATABASE_PASSWORD;
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Invalid DATABASE_URL protocol');
 // Enforce certificate verification; URL options must not silently disable TLS.
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
 const pool=new pg.Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:5,connectionTimeoutMillis:15000,options:'-c search_path=dawapp -c statement_timeout=20000 -c idle_in_transaction_session_timeout=30000'});
 pool.on('error',()=>console.error('Database connection interrupted'));
 const db=createAdapter(pool);
 try{await initializeCloud(db,JSON.parse(process.env.PILOT_ACCOUNTS||'[]'));return db;}
 catch(error){await pool.end();throw error;}
}
