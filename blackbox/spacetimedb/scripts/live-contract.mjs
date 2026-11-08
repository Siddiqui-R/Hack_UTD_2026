// Local-only integration verification. No NVIDIA calls; existing data is never deleted.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomInt, createHash } from 'node:crypto';
import { resolve } from 'node:path';
const target='http://127.0.0.1:3000', db=process.env.BLACKBOX_VERIFY_DB ?? 'blackbox';
const cfg=readFileSync(resolve(process.env.LOCALAPPDATA,'SpacetimeDB/config/cli.toml'),'utf8');
const owner={token:cfg.match(/^spacetimedb_token\s*=\s*"([^"]+)"/m)?.[1]};
assert(owner.token,'owner login required');
const tag=Date.now().toString(36), A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function code(){let c;do{c=Array.from({length:8},()=>A[randomInt(A.length)]).join('')}while(new Set(c).size<5);return c;}
async function request(who,path,body,type='application/json'){
 const r=await fetch(`${target}/v1/database/${db}/${path}`,{method:'POST',headers:{Authorization:`Bearer ${who.token}`,'Content-Type':type},body:type==='application/json'?JSON.stringify(body):body});
 const text=await r.text();return {ok:r.ok,status:r.status,text};
}
async function sql(q){const r=await request(owner,'sql',q,'text/plain');assert(r.ok,r.text);const [t]=JSON.parse(r.text);if(!t)return[];const names=t.schema.elements.map(x=>x.name?.some??'');return t.rows.map(row=>Object.fromEntries(row.map((v,i)=>[names[i],v])));}
const count=async()=>Number((await sql('SELECT COUNT(*) AS n FROM audit'))[0].n);
async function call(who,name,args=[],deny){const n=await count(),r=await request(who,`call/${name}`,args); if(deny){assert(!r.ok,`${name} unexpectedly accepted`);assert.match(r.text,deny);assert.equal(await count(),n,'denied call changed audit');}else{assert(r.ok,`${name}: ${r.text}`);assert.equal(await count(),n+1,`${name} must append exactly one audit row`);}return r;}
async function identity(){const r=await fetch(`${target}/v1/identity`,{method:'POST'});assert(r.ok);const who=await r.json();who.identity=who.identity.startsWith('0x')?who.identity:`0x${who.identity}`;return who;}
const ident=who=>({__identity__:who.identity});
const commander=await identity(), invite=code();
await call(owner,'issue_bootstrap_invite',[invite]);
await call(commander,'redeem_invite',[invite,`verify-command-${tag}`]);
const before=await sql('SELECT id FROM incident');
for(const name of ['A','B'])await call(commander,'create_incident',[`Verify ${tag} ${name}`,'ransomware','high',{__timestamp_micros_since_unix_epoch__:Date.now()*1000-60000000},'FS-VERIFY','none']);
const incidents=(await sql('SELECT * FROM incident')).filter(r=>r.title.startsWith(`Verify ${tag}`));
const [a,b]=incidents.sort((x,y)=>Number(x.id)-Number(y.id));assert.equal(incidents.length,2);
for(const row of before)assert((await sql('SELECT id FROM incident')).some(r=>r.id===row.id),'existing incident lost');
const agent=await identity();await call(commander,'enroll_agent',[ident(agent),a.id]);
await call(agent,'create_task',['Isolate verification host','responder']);
await call(agent,'update_severity',[a.id,'critical','Confirmed encryption']);
await call(agent,'update_severity',[b.id,'low','Cross incident attempt'],/mismatch/);
for(const text of ['Encryption observed','Host healthy'])await call(commander,'submit_evidence',[a.id,text]);
await call(commander,'submit_evidence',[b.id,'Other incident']);
const ea=(await sql(`SELECT * FROM evidence WHERE incident_id = ${a.id}`)), eb=(await sql(`SELECT * FROM evidence WHERE incident_id = ${b.id}`))[0];
await call(agent,'flag_conflict',[ea[0].id,ea[1].id,'Contradictory observations']);
await call(agent,'flag_conflict',[ea[0].id,eb.id,'Cross incident'],/distinct evidence/);
for(const [name,args] of [['create_invite',[code(),'commander']],['set_role',[ident(commander),'observer']],['issue_bootstrap_invite',[code()]],['redeem_invite',[code(),'Agent']],['revoke_session',[ident(commander)]],['enroll_agent',[ident(await identity()),a.id]]])await call(agent,name,args,/NEMOTRON/);
const proc=async(who,name,args,deny)=>{const n=await count(),r=await request(who,`call/${name}`,args);assert.equal(await count(),n);if(deny){assert(!r.ok);assert.match(r.text,deny);return;}assert(r.ok,r.text);let value=JSON.parse(r.text);if(typeof value==='string')value=JSON.parse(value);return value;};
const results=await proc(agent,'search_incidents',['Verify']);assert.equal(results.length,1);assert.equal(String(results[0].incidentId),String(a.id));
assert.equal((await proc(agent,'get_scope',[a.id])).available,false);
await proc(agent,'get_scope',[b.id],/mismatch/);await proc(agent,'evidence_records',[b.id],/mismatch/);
if (process.env.BLACKBOX_VERIFY_SHORT_TTL !== '1') throw new Error('Expiry test requires temporary 3-second agent-enrolment TTL; see contract');
await call(commander,'enroll_agent',[ident(agent),a.id]);
await new Promise(resolve => setTimeout(resolve, 4000));
await call(agent,'create_task',['Expired','responder'],/session required/);await proc(agent,'get_scope',[a.id],/session expired/);
await call(commander,'enroll_agent',[ident(agent),a.id]);
await call(commander,'revoke_session',[ident(agent)]);
await call(agent,'create_task',['Revoked','responder'],/revoked/);await proc(agent,'get_scope',[a.id],/revoked/);
await call(commander,'enroll_agent',[ident(agent),a.id],/revoked/);
const rows=(await sql('SELECT * FROM audit')).sort((x,y)=>Number(x.seq)-Number(y.seq));
function canonical(v){if(v==null)return 'null';if(typeof v==='bigint')return JSON.stringify(v.toString());if(typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(canonical)}]`;return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;}
let prev='0'.repeat(64), seq=0;for(const r of rows){assert.equal(Number(r.seq),++seq);assert.equal(r.prev_hash,prev);const hash=createHash('sha256').update(canonical({seq:BigInt(r.seq),incidentId:BigInt(r.incident_id),actor:r.actor,action:r.action,payloadJson:r.payload_json,prevHash:r.prev_hash,createdAt:BigInt(r.created_at.__timestamp_micros_since_unix_epoch__??r.created_at)})+prev).digest('hex');assert.equal(r.event_hash,hash);prev=hash;}
const head=(await sql('SELECT * FROM chain_head'))[0];assert.equal(head.head_hash,prev);
const summary={tag,existingIncidentsPreserved:before.length,auditRows:seq,checks:['agent writes','incident boundaries','permission denials','expiry writes and reads','revocation','one audit row per successful mutation','no audit for denial or read','independent full hash-chain verification'],nvidiaCalls:0};
mkdirSync('agent-logs',{recursive:true});writeFileSync('agent-logs/live-contract-result.json',JSON.stringify(summary,null,2));writeFileSync('agent-logs/live-fixture.json',JSON.stringify({commander,agent,incidentId:a.id,tag}));
console.log(JSON.stringify(summary,null,2));
