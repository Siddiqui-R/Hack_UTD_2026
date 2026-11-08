// Execute the real bridge source with fake child processes/HTTP/DB. No socket, database or model calls.
import vm from 'node:vm';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const root=path.resolve('attacker'),filename=path.join(root,'server.mjs');
async function harness(){
 let handler,children=[],timers=[],pending=null;
 const context=vm.createContext({console,Buffer,TextDecoder,URL,process:{execPath:process.execPath,env:{}},setTimeout:fn=>{const timer={fn};timers.push(timer);return timer},clearTimeout:t=>{t.cleared=true},setInterval:()=>({}),clearInterval:()=>{}});
 const fakeHttp={createServer(fn){handler=fn;return {listen(){}}}};
 const fakeSpawn=(_exe,_args,options)=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.stdin.messages=[];c.stdin.write=x=>c.stdin.messages.push(x);c.mark=options.env.DEMO_MARKER;c.kill=()=>{c.killed=true;return true};children.push(c);return c};
 const modules=new Map();
 async function synthetic(key,exports){if(modules.has(key))return modules.get(key);const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v)},{context});modules.set(key,m);await m.link(()=>{});await m.evaluate();return m}
 async function moduleFor(spec,referencing){
  if(spec==='node:http')return synthetic(spec,{default:fakeHttp});
  if(spec==='node:child_process')return synthetic(spec,{spawn:fakeSpawn});
  if(spec==='node:crypto')return synthetic(spec,{randomBytes});
  if(spec==='node:fs/promises')return synthetic(spec,{readFile:async()=>'<html>fixture</html>'});
  if(spec==='node:url')return synthetic(spec,{fileURLToPath});
  if(spec==='node:string_decoder'){const m=await import(spec);return synthetic(spec,{StringDecoder:m.StringDecoder})}
  if(spec.endsWith('/lib.mjs'))return synthetic('db',{TARGET:'http://127.0.0.1:3000',DB:'fixture-only',guardTarget:()=>{}});
  if(spec.endsWith('/2-tamper.mjs'))return synthetic('recovery',{pendingRecovery:()=>pending});
  if(spec.startsWith('./')){const f=path.resolve(path.dirname(referencing.identifier),spec);if(modules.has(f))return modules.get(f);const m=source(f);modules.set(f,m);await m.link(moduleFor);return m}
  throw Error('Unmocked import '+spec);
 }
 function source(f){return new vm.SourceTextModule(fs.readFileSync(f,'utf8'),{context,identifier:f,initializeImportMeta:meta=>{meta.url=pathToFileURL(f).href},importModuleDynamically:async(spec,ref)=>{const m=await moduleFor(spec,ref);if(m.status==='linked')await m.evaluate();return m}})}
 const bridge=source(filename);await bridge.link(moduleFor);await bridge.evaluate();
 async function request(url,extra={}){const req=new EventEmitter();Object.assign(req,{method:url==='/events'?'GET':'POST',url,headers:{host:'127.0.0.1:4400','x-blackbox-console':'1',...extra}});const res={headersSent:false,status:200,body:'',writeHead(s){this.status=s;this.headersSent=true},write(x){this.body+=x;return true},end(x=''){this.body+=x}};await handler(req,res);let data;try{data=JSON.parse(res.body)}catch{}return {...res,data,req}}
 function output(c,type,value){c.stdout.emit('data',Buffer.from(`@@${type}:${c.mark} ${JSON.stringify(value)}\n`))}
 return {request,children,timers,output,setPending:x=>pending=x};
}
const results=[];
async function check(name,fn){try{await fn();results.push({name,ok:true})}catch(e){results.push({name,ok:false,reason:e.message})}}
const expect=(v,msg)=>{if(!v)throw Error(msg)};
for(const payload of [null,{},[null],[{id:'A1a',outcome:'PASS'}]])await check('malformed result '+JSON.stringify(payload),async()=>{const h=await harness();await h.request('/run/1');const c=h.children[0];h.output(c,'RESULT',payload);c.emit('close',0);const stream=await h.request('/events');expect(stream.body.includes('"label":"ERROR"'),'malformed shape must terminate as ERROR')});
await check('stale release must not affect current run',async()=>{const h=await harness();const a=await h.request('/run/2');const c=h.children[0];h.output(c,'PHASE',{phase:'DETECTED',seq:10,holdMaxMs:30000});h.output(c,'RESULT',[]);c.emit('close',0);const b=await h.request('/run/2');const d=h.children[1];h.output(d,'PHASE',{phase:'DETECTED',seq:11,holdMaxMs:30000});const stale=await h.request('/release',{'x-blackbox-run':String(a.data.id)});expect(stale.status===409&&d.stdin.messages.length===0,'stale run ID released a different held run');d.emit('close',0)});
await check('valid results still pass',async()=>{const h=await harness();await h.request('/run/1');const c=h.children[0];h.output(c,'RESULT',[{id:'A1a',title:'write denied',outcome:'PASS',detail:''},{id:'A1b',title:'read denied',outcome:'PASS',detail:''}]);c.emit('close',0);const stream=await h.request('/events');expect(stream.body.includes('"label":"ACCESS DENIED"'),'legitimate run must remain successful')});
const good=[{id:'A1a',title:'write denied',outcome:'PASS',detail:''},{id:'A1b',title:'read denied',outcome:'PASS',detail:''}];
await check('stderr chunk inside a stdout result frame does not corrupt it',async()=>{const h=await harness();await h.request('/run/1');const c=h.children[0];const frame=`@@RESULT:${c.mark} ${JSON.stringify(good)}\n`;c.stdout.emit('data',Buffer.from(frame.slice(0,30)));c.stderr.emit('data',Buffer.from('noise from stderr\n'));c.stdout.emit('data',Buffer.from(frame.slice(30)));c.emit('close',0);const s=await h.request('/events');expect(s.body.includes('"label":"ACCESS DENIED"'),'split frame was corrupted')});
await check('result frame on stderr is not trusted',async()=>{const h=await harness();await h.request('/run/1');const c=h.children[0];c.stderr.emit('data',Buffer.from(`@@RESULT:${c.mark} ${JSON.stringify(good)}\n`));c.emit('close',0);const s=await h.request('/events');expect(!s.body.includes('"label":"ACCESS DENIED"'),'stderr result was accepted')});
await check('oversized partial line stops the run as ERROR',async()=>{const h=await harness();await h.request('/run/1');const c=h.children[0];c.stdout.emit('data',Buffer.alloc(70*1024,97));expect(c.killed,'runner not stopped');h.output(c,'RESULT',good);c.emit('close',0);const s=await h.request('/events');expect(s.body.includes('"label":"ERROR"'),'oversized output still passed')});
await check('total output limit stops the run',async()=>{const h=await harness();await h.request('/run/1');const c=h.children[0];for(let i=0;i<40;i++)c.stdout.emit('data',Buffer.from(('x'.repeat(30*1024))+'\n'));expect(c.killed,'runner not stopped at output limit')});
await check('second result frame is refused',async()=>{const h=await harness();await h.request('/run/1');const c=h.children[0];h.output(c,'RESULT',good);h.output(c,'RESULT',good);c.emit('close',0);const s=await h.request('/events');expect(s.body.includes('"label":"ERROR"'),'duplicate result accepted')});
await check('marker secret never reaches the browser',async()=>{const h=await harness();await h.request('/run/1');const c=h.children[0];c.stdout.emit('data',Buffer.from(`echo ${c.mark}\n`));c.emit('close',0);const s=await h.request('/events');expect(!s.body.includes(c.mark),'marker leaked')});
await check('foreign Origin cannot open /events',async()=>{const h=await harness();const s=await h.request('/events',{origin:'http://127.0.0.1:5180'});expect(s.status===403,'foreign origin got a stream')});
await check('same-site no-cors /events (no Origin) refused',async()=>{const h=await harness();const s=await h.request('/events',{'sec-fetch-site':'same-site','sec-fetch-dest':'empty'});expect(s.status===403,'same-site request got a stream')});
await check('own console origin still streams',async()=>{const h=await harness();const s=await h.request('/events',{'sec-fetch-site':'same-origin','sec-fetch-dest':'empty'});expect(s.status===200&&s.body.includes('event: reset'),'console stream refused')});
await check('recovery token not sent to browsers',async()=>{const h=await harness();h.setPending({db:'x',seq:5,column:'action',original:'a',tampered:'nothing_happened',token:'secret-token'});const s=await h.request('/events');expect(!s.body.includes('secret-token'),'token leaked')});
console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.ok))process.exitCode=1;
