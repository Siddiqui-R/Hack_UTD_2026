import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const base='http://127.0.0.1:3000/v1/database/blackbox';
const owner={token:readFileSync(resolve(process.env.LOCALAPPDATA,'SpacetimeDB/config/cli.toml'),'utf8').match(/^spacetimedb_token\s*=\s*"([^"]+)"/m)[1]};
const fixture=JSON.parse(readFileSync('agent-logs/live-fixture.json','utf8')),cmd=fixture.commander;
async function req(w,path,args,type='application/json'){const r=await fetch(`${base}/${path}`,{method:'POST',headers:{Authorization:`Bearer ${w.token}`,'Content-Type':type},body:type==='application/json'?JSON.stringify(args):args});const text=await r.text();assert(r.ok,text);return text;}
async function sql(q){const[t]=JSON.parse(await req(owner,'sql',q,'text/plain'));if(!t)return[];const names=t.schema.elements.map(e=>e.name?.some??'');return t.rows.map(row=>Object.fromEntries(row.map((v,i)=>[names[i],v])));}
const verify=async()=>{const value=JSON.parse(await req(cmd,'call/verify_chain',[]));if(!Array.isArray(value))return value;const [ok,checked,option,reason]=value;return {ok,checked,brokenAt:option[0]===0?option[1]:null,reason};};
// UI mode auto-restores after 45 seconds, or immediately when stdin receives a line.
if (process.argv.includes('--ui-hold')) {
  const row=JSON.parse(readFileSync('agent-logs/live-chain-repair.json','utf8'));
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  try {
    await sql(`UPDATE audit SET payload_json = '{"uiTamper":true}' WHERE seq = ${row.seq}`);
    console.log('UI TAMPER ACTIVE at record',row.seq,'(auto-repair in 45s)');
    await new Promise(resolve=>{const timer=setTimeout(resolve,45000);process.stdin.once('data',()=>{clearTimeout(timer);resolve();});});
  } finally {
    await sql(`UPDATE audit SET payload_json = ${quote(row.payload_json)} WHERE seq = ${row.seq}`);
    console.log('UI TAMPER REPAIRED');
  }
  assert.equal((await verify()).ok,true); process.exit(0);
}
const clean=await verify();assert.equal(clean.ok,true);console.log('CLEAN',JSON.stringify(clean));
await req(cmd,'call/submit_evidence',[fixture.incidentId,'Slice 4 live tamper verification fixture']);
const rows=(await sql('SELECT * FROM audit')).sort((a,b)=>Number(a.seq)-Number(b.seq)),row=rows.at(-1);
writeFileSync('agent-logs/live-chain-repair.json',JSON.stringify(row,null,2));
const quote=s=>`'${s.replaceAll("'","''")}'`;
let broken;
try{
 await sql(`UPDATE audit SET payload_json = '{"tampered":true}' WHERE seq = ${row.seq}`);
 broken=await verify();assert.equal(broken.ok,false);assert.equal(Number(broken.brokenAt.some??broken.brokenAt),Number(row.seq));assert.equal(broken.reason,'event hash mismatch');console.log('TAMPER DETECTED',JSON.stringify(broken));
}finally{await sql(`UPDATE audit SET payload_json = ${quote(row.payload_json)} WHERE seq = ${row.seq}`);}
const repaired=await verify();assert.equal(repaired.ok,true);console.log('REPAIRED',JSON.stringify(repaired));
const head=(await sql('SELECT * FROM chain_head'))[0];
try{
 await sql(`UPDATE chain_head SET head_hash = '${'0'.repeat(64)}' WHERE id = 0`);
 const bad=await verify();assert.equal(bad.ok,false);assert.equal(bad.reason,'chain head hash mismatch');console.log('HEAD TAMPER DETECTED',JSON.stringify(bad));
}finally{await sql(`UPDATE chain_head SET head_hash = ${quote(head.head_hash)} WHERE id = 0`);}
assert.equal((await verify()).ok,true);
writeFileSync('agent-logs/live-chain-result.json',JSON.stringify({clean,broken,repaired,originalHashRestored:true,nvidiaCalls:0},null,2));
