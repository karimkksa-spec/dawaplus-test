import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'public/catalog');mkdirSync(dir,{recursive:true});
const rows=JSON.parse(readFileSync(resolve(root,'data/reference-catalog.json'),'utf8'));
const assets=[...new Map(rows.filter(r=>r.image?.startsWith('https://appaccs.yrbso.app/')).map(r=>[r.source.split('/').pop(),r])).entries()];
let cursor=0,success=0;const manifest=resolve(root,'data/local-assets.json');const mapping=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):{};
async function worker(){while(cursor<assets.length){const [id,r]=assets[cursor++];try{if(!mapping[id]||!existsSync(resolve(root,'public','.'+mapping[id]))){const response=await fetch(r.image,{signal:AbortSignal.timeout(30000)});if(!response.ok||!response.headers.get('content-type')?.startsWith('image/'))throw new Error('Invalid image response');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8000000)throw new Error('Image too large');const ext=bytes[0]===137?'png':bytes[0]===255?'jpg':bytes.toString('ascii',0,4)==='RIFF'?'webp':'gif';const name=id+'.'+ext;writeFileSync(resolve(dir,name),bytes);mapping[id]='/catalog/'+name;}success++;}catch(e){console.log('Asset unavailable:',id,e.message);}}}
await Promise.all(Array.from({length:5},worker));writeFileSync(resolve(root,'data/local-assets.json'),JSON.stringify(mapping,null,2));console.log(`Cached ${success}/${assets.length} observed reference images.`);
