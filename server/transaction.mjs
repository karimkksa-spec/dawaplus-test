const queues=new WeakMap();
export async function transaction(db,fn){
 if(db.transaction)return db.transaction(fn);
 const previous=queues.get(db)||Promise.resolve();
 let release;const gate=new Promise(resolve=>{release=resolve;});
 queues.set(db,previous.then(()=>gate));
 await previous;
 try{db.exec('BEGIN IMMEDIATE');try{const result=await fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 finally{release();}
}
