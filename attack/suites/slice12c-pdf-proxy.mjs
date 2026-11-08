// Invoke the owner's Vercel handler with real module/renderer HTTP backends, no Vercel account needed.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import handler from '../../blackbox/client/api/pdf.mjs';
import {TARGET,DB,getCommander,signIn,newIdentity,call} from '../lib.mjs';
import {incident,must,check,ident} from '../slice-helpers.mjs';
export const slice='12/proxy';
export const title='Authenticated fresh-snapshot PDF adapter';
const root=fileURLToPath(new URL('../../',import.meta.url));
const response=()=>({code:200,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(c){this.code=c;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}});
export async function run(){
  const cmd=await getCommander(),obs=await signIn('observer'),inc=await incident('proxy-pdf');
  must(await call(cmd,'submit_evidence',[inc.id,'PROXY_SOURCE_SECRET: fetched directly from module, not the browser.']));
  const token=randomBytes(32).toString('hex');
  const child=spawn(process.execPath,['pdf/server.mjs'],{cwd:root,env:{...process.env,PDF_PORT:'0',PDF_RENDERER_TOKEN:token},stdio:['ignore','pipe','pipe']});
  const exit=new Promise(r=>child.once('exit',r));
  const keys=['PDF_RENDERER_URL','PDF_RENDERER_TOKEN','VITE_STDB_URI','VITE_STDB_DB'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('protected renderer startup timeout')),5000);child.stdout.on('data',b=>{const m=String(b).match(/listening on (\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.once('error',reject);});
    const endpoint=`http://127.0.0.1:${port}/record.pdf`;
    const noToken=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    check('PX-protected','configured renderer requires its own credential',noToken.status===401);
    Object.assign(process.env,{PDF_RENDERER_URL:endpoint,PDF_RENDERER_TOKEN:token,VITE_STDB_URI:TARGET.replace(/^http/,'ws'),VITE_STDB_DB:DB});
    const invoke=async(who,body={incidentId:String(inc.id)},method='POST')=>{const r=response();await handler({method,headers:who?{authorization:`Bearer ${who.token}`}:{},body},r);return r;};
    check('PX-method','PDF adapter rejects non-POST requests',(await invoke(cmd,{},'GET')).code===405);
    check('PX-auth','PDF adapter requires signed-in bearer token',(await invoke(null)).code===401);
    check('PX-id','out-of-range incident ID rejected',(await invoke(cmd,{incidentId:'18446744073709551616'})).code===400);
    check('PX-outsider','unregistered identity cannot export through adapter',(await invoke(await newIdentity())).code===403);
    const revoked=await signIn('responder');must(await call(cmd,'revoke_session',[ident(revoked)]));
    check('PX-revoked','revoked user cannot export through adapter',(await invoke(revoked)).code===403);
    const forged=await invoke(cmd,{incidentId:String(inc.id),evidence:[{text:'BROWSER_FORGED_EVIDENCE'}],schemaVersion:99});
    check('PX-real-pdf','adapter ignores browser snapshot and renders a fresh authorized record',forged.code===200 && Buffer.isBuffer(forged.body) && forged.body.subarray(0,5).toString()==='%PDF-');
    check('PX-headers','adapter returns PDF and prevents caching',forged.headers['content-type']==='application/pdf' && forged.headers['cache-control']==='no-store');
    // Success against a protected renderer also proves the session token was not forwarded as its credential.
    check('PX-credentials','dedicated renderer credential used successfully',forged.code===200);
    const redacted=await invoke(obs);
    check('PX-observer','observer gets an authorized redacted PDF through the adapter',redacted.code===200 && redacted.body.subarray(0,5).toString()==='%PDF-');
    const dir=path.join(root,'agent-logs','pdf-qa');await mkdir(dir,{recursive:true});
    if(forged.code===200)await writeFile(path.join(dir,'proxy.pdf'),forged.body);
    if(redacted.code===200)await writeFile(path.join(dir,'proxy-observer.pdf'),redacted.body);
  }finally{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}child.kill();await exit;}
}
