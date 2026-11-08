import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomInt} from 'node:crypto';
import {resolve} from 'node:path';
const base='http://127.0.0.1:3000/v1/database/blackbox';
const owner={token:readFileSync(resolve(process.env.LOCALAPPDATA,'SpacetimeDB/config/cli.toml'),'utf8').match(/^spacetimedb_token\s*=\s*"([^"]+)"/m)[1]};
const fixture=JSON.parse(readFileSync('agent-logs/live-fixture.json','utf8')),cmd=fixture.commander;
const tag=Date.now().toString(36),A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function code(){let c;do{c=Array.from({length:8},()=>A[randomInt(31)]).join('')}while(new Set(c).size<5);return c;}
async function req(w,path,args,type='application/json'){const r=await fetch(`${base}/${path}`,{method:'POST',headers:{Authorization:`Bearer ${w.token}`,'Content-Type':type},body:type==='application/json'?JSON.stringify(args):args});return {ok:r.ok,text:await r.text()};}
async function sql(q,w=owner){const r=await req(w,'sql',q,'text/plain');assert(r.ok,r.text);const[t]=JSON.parse(r.text);if(!t)return[];const names=t.schema.elements.map(e=>e.name?.some??'');return t.rows.map(row=>Object.fromEntries(row.map((v,i)=>[names[i],v])));}
const count=async()=>Number((await sql('SELECT COUNT(*) AS n FROM audit'))[0].n);
async function call(w,n,args,denied){const before=await count(),r=await req(w,`call/${n}`,args);if(denied){assert(!r.ok,`${n} accepted`);assert.match(r.text,denied);assert.equal(await count(),before);}else {assert(r.ok,`${n}: ${r.text}`);assert.equal(await count(),before+1);}return r;}
async function mint(){const r=await fetch('http://127.0.0.1:3000/v1/identity',{method:'POST'});const w=await r.json();w.identity='0x'+w.identity.replace(/^0x/,'');return w;}
const id=w=>({__identity__:w.identity});
async function join(role,name){const w=await mint(),c=code();await call(cmd,'create_invite',[c,role]);await call(w,'redeem_invite',[c,name]);assert.equal((await sql(`SELECT * FROM invite_code WHERE code_hash = '${(await import('node:crypto')).createHash('sha256').update(c).digest('hex')}'`)).length,0);return w;}
const resp=await join('responder',`resp-${tag}`),obs=await join('observer',`obs-${tag}`),peer=await join('commander',`peer-${tag}`);
await call(cmd,'create_invite',['AAAAAAAA','observer'],/weak/);
const duplicate=await mint(),c=code();await call(cmd,'create_invite',[c,'responder']);
await call(duplicate,'redeem_invite',[c,`RESP-${tag}`],/already in use/);
await call(duplicate,'redeem_invite',[c,'unsafe\u202Ename'],/hidden/);
await call(cmd,'create_incident',['unsafe\u202Etitle','ransomware','high',{__timestamp_micros_since_unix_epoch__:Date.now()*1000},'','none'],/hidden/);
await call(cmd,'create_incident',['Ancient','ransomware','high',{__timestamp_micros_since_unix_epoch__:1},'','none'],/year/);
await sql(`UPDATE user SET is_duressed = true WHERE identity = ${resp.identity}`);
try{
 const team=async w=>(await sql('SELECT * FROM team',w)).find(r=>String(r.identity.__identity__??r.identity).replace(/^0x/,'')===resp.identity.slice(2));
 assert.equal((await team(cmd)).flagged,true);assert.equal((await team(resp)).flagged,false);assert.equal((await team(obs)).flagged,false);
}finally{await sql(`UPDATE user SET is_duressed = false WHERE identity = ${resp.identity}`);}
await call(cmd,'revoke_session',[id(peer)],/owner/);
await call(owner,'revoke_session',[id(peer)]);
await call(cmd,'unrevoke_session',[id(peer)],/owner/);
await call(owner,'unrevoke_session',[id(peer)]);
await call(peer,'create_invite',[code(),'observer'],/session expired/);
await call(owner,'unrevoke_session',[id(fixture.agent)],/permanent/);
const stale=code(),recover=code();await call(cmd,'create_invite',[recover,'commander']);await call(peer,'redeem_invite',[recover,`peer-rejoin-${tag}`]);
await call(peer,'create_invite',[stale,'observer']);await call(cmd,'set_role',[id(peer),'responder']);
await call(await mint(),'redeem_invite',[stale,`stale-${tag}`],/invalid/);
const row=(await sql(`SELECT * FROM incident WHERE id = ${fixture.incidentId}`))[0];
const newStatus=row.status==='investigating'?'contained':'investigating';
await call(cmd,'update_incident',[row.id,row.severity,newStatus,row.containment_status,row.systems_affected,row.updated_at]);
await call(resp,'update_incident',[row.id,'low','triage',row.containment_status,'stale systems',row.updated_at],/changed/);
const next=(await sql(`SELECT * FROM incident WHERE id = ${row.id}`))[0];assert.equal(next.status,newStatus);assert.equal(next.systems_affected,row.systems_affected);
await call(resp,'update_incident',[row.id,next.severity,'closed',next.containment_status,next.systems_affected,next.updated_at],/approval/);
const service=await mint();await call(cmd,'enroll_agent',[id(service),row.id]);
await call(service,'update_severity',[row.id,'low','Injected downgrade',{none:[]}],/cannot lower/);
await call(service,'create_invite',[code(),'commander'],/NEMOTRON/);
const read=await req(obs,'call/evidence_records',[row.id]);assert(!read.ok);assert.match(read.text,/observer cannot read evidence/);
await call(cmd,'revoke_session',[id(service)]);
await call(owner,'unrevoke_session',[id(service)],/permanent/);
const result={checks:['duress visibility','commander revocation owner-only','human owner recovery requires new invite','agent remains permanently revoked','weak-code rejection','redeemed hashes removed','duplicate/hidden names','hidden title/ancient date','demotion invalidates invites','stale edit rejected','closing blocked','agent downgrade denied','observer evidence denied'],nvidiaCalls:0};
writeFileSync('agent-logs/live-hardening-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
