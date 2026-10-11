import {networkInterfaces} from 'node:os';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const addresses=Object.values(networkInterfaces()).flat().filter(a=>a.family==='IPv4'&&!a.internal&&/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address));
const host=process.env.LAN_HOST||addresses[0]?.address;
if(!host){console.error('Connect this computer to Wi-Fi, then retry.');process.exit(1);}
const port=process.env.LAN_PORT||'4174';
console.log('Local Wi-Fi demo only; keep the computer awake.');
for(const role of ['customer','pharmacy','admin','captain'])console.log(`http://${host}:${port}/${role}`);
const child=spawn(process.execPath,['--env-file=.env.demo','server/index.mjs'],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,HOST:host,PORT:port},stdio:'inherit'});
child.on('exit',code=>process.exit(code||0));process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
