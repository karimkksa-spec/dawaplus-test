import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const role=process.argv[2];if(!['customer','captain','pharmacy'].includes(role))throw new Error('Choose customer, captain or pharmacy');
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'mobile',role);
const api=process.env.VITE_API_URL;
if(!api||!/^https:\/\//.test(api))throw new Error('Set VITE_API_URL to your deployed HTTPS API before building Android.');
mkdirSync(dir,{recursive:true});
writeFileSync(resolve(dir,'package.json'),JSON.stringify({name:'dawaplus-'+role,version:'0.1.0',private:true},null,2));
writeFileSync(resolve(dir,'capacitor.config.json'),JSON.stringify({appId:'ye.dawaplus.'+role,appName:{customer:'دواء بلس',captain:'دواء بلس كابتن',pharmacy:'دواء بلس الصيدلية'}[role],webDir:'www',android:{allowMixedContent:false}},null,2));
function run(script,args,cwd=root,env=process.env){const r=spawnSync(process.execPath,[script,...args],{cwd,env,stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
run(resolve(root,'node_modules/vite/bin/vite.js'),['build','--configLoader','native','--outDir',resolve(dir,'www')],root,{...process.env,VITE_APP_ROLE:role,VITE_API_URL:api});
const cli=resolve(root,'node_modules/@capacitor/cli/bin/capacitor');
if(!existsSync(resolve(dir,'android')))run(cli,['add','android'],dir);
run(cli,['sync','android'],dir);
console.log('Open '+resolve(dir,'android')+' in Android Studio; generate a signed release after testing on a device.');
