// Exercise deployed worker SOURCE with the real SQLite migration. No production credentials or mutations.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../../blackbox/spacetimedb/anchor-store/hosted/worker/index.js';
import {check} from '../slice-helpers.mjs';
export const slice='9/hosted';
export const title='Hosted checkpoint source against durable SQLite';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function run(){
  const parent=path.join(root,'agent-logs');await fs.mkdir(parent,{recursive:true});
  const dir=await fs.mkdtemp(path.join(parent,'hosted-anchor-test-'));
  if(path.dirname(dir)!==parent || !path.basename(dir).startsWith('hosted-anchor-test-'))throw new Error('invalid temporary directory');
  const file=path.join(dir,'checkpoints.sqlite');let db=new DatabaseSync(file);
  try{
    db.exec(await fs.readFile(path.join(root,'blackbox/spacetimedb/anchor-store/hosted/drizzle/0000_checkpoint.sql'),'utf8'));
    const binding={prepare(sql){const statement=db.prepare(sql);const bound=(params)=>({async first(){return statement.get(...params)??null;},async all(){return{results:statement.all(...params)};},async run(){return{meta:{changes:Number(statement.run(...params).changes)}};}});return{...bound([]),bind(...params){return bound(params);}};}};
    const writeToken=randomBytes(32).toString('hex'),readToken=randomBytes(32).toString('hex');
    const env={DB:binding,ANCHOR_WRITE_TOKEN:writeToken,ANCHOR_READ_TOKEN:readToken};
    const database='d'.repeat(64),first={database,seq:'10',headHash:'e'.repeat(64)};
    const post=(body,token=writeToken)=>worker.fetch(new Request('https://fixture.invalid/checkpoint',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}),env);
    const get=(token=readToken)=>worker.fetch(new Request(`https://fixture.invalid/checkpoints?database=${database}`,{headers:{authorization:`Bearer ${token}`}}),env);
    check('H-binding','missing durable binding fails closed',(await worker.fetch(new Request('https://fixture.invalid/health'),{})).status===503);
    check('H-health','health checks real durable schema',(await worker.fetch(new Request('https://fixture.invalid/health'),env)).status===200);
    check('H-read','history requires reader credential',(await get('wrong')).status===401);
    check('H-write','writes require writer credential',(await post(first,'wrong')).status===401);
    check('H-write-read','writer credential cannot read history',(await get(writeToken)).status===401);
    check('H-read-write','reader credential cannot append',(await post(first,readToken)).status===401);
    check('H-append','hosted source appends checkpoint',(await post(first)).status===201);
    check('H-idempotent','identical checkpoint is idempotent',(await post(first)).status===200);
    check('H-alias','numeric sequence aliases cannot bypass immutability',(await post({...first,seq:'010',headHash:'f'.repeat(64)})).status===409);
    check('H-regress','checkpoint regression refused',(await post({...first,seq:'9'})).status===409);
    check('H-next','new checkpoint appends',(await post({...first,seq:'11'})).status===201);
    check('H-history','entire checkpoint history retained',(await (await get()).json()).length===2);
    for(const [id,query] of [['update',"UPDATE checkpoint SET head_hash = 'tampered'"],['delete','DELETE FROM checkpoint']]){
      let held=false;try{db.exec(query);}catch{held=true;}check(`H-${id}`,`database trigger blocks ${id}`,held);
    }
    db.close();db=new DatabaseSync(file);
    check('H-reopen','checkpoint history survives SQLite reopen',(await (await get()).json()).length===2);
  }finally{db.close();await fs.rm(dir,{recursive:true,force:true});}
}
