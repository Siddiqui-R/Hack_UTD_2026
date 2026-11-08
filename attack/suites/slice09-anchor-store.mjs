// Local wiring/durability checks only: this does not establish an independently deployed anchor.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {check} from '../slice-helpers.mjs';
export const slice='9';
export const title='Checkpoint store credentials, immutability and restart durability';
const root=fileURLToPath(new URL('../../',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));

export async function run(){
  const parent=path.join(root,'agent-logs');await fs.mkdir(parent,{recursive:true});
  const dir=await fs.mkdtemp(path.join(parent,'anchor-test-'));
  if(path.dirname(dir)!==parent || !path.basename(dir).startsWith('anchor-test-'))throw new Error('invalid temporary directory');
  const lease=createServer();await new Promise(r=>lease.listen(0,'127.0.0.1',r));const port=lease.address().port;await new Promise(r=>lease.close(r));
  const endpoint=`http://127.0.0.1:${port}`,writeToken=randomBytes(32).toString('hex'),readToken=randomBytes(32).toString('hex');
  const database='a'.repeat(64),first={database,seq:'10',headHash:'b'.repeat(64)};
  const post=(body,token=writeToken)=>fetch(endpoint+'/checkpoint',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  const get=(token=readToken)=>fetch(endpoint+'/checkpoints?database='+database,{headers:{authorization:`Bearer ${token}`}});
  let child,exit;
  const start=async()=>{
    child=spawn(process.execPath,['blackbox/spacetimedb/anchor-store/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',CHECKPOINT_FILE:path.join(dir,'history.jsonl'),ANCHOR_WRITE_TOKEN:writeToken,ANCHOR_READ_TOKEN:readToken},stdio:'ignore'});
    exit=new Promise(r=>child.once('exit',r));
    for(let i=0;i<50;i++){try{if((await get()).status===200)return;}catch{}await pause(50);}
    throw new Error('anchor store did not start');
  };
  try{
    await start();
    check('A-auth-write','checkpoint write requires write credential',(await post(first,'bad')).status===401);
    check('A-read-write','read credential cannot write',(await post(first,readToken)).status===401);
    check('A-write-read','write credential cannot read history',(await get(writeToken)).status===401);
    check('A-store','valid checkpoint durably appended',(await post(first)).status===201);
    const saved=await (await get()).json();
    check('A-ref','external checkpoint contains hash, timestamp and reference',saved.length===1 && saved[0].headHash===first.headHash && /^\d+$/.test(saved[0].at) && typeof saved[0].ref==='string');
    check('A-idempotent','identical checkpoint accepted without duplicating history',(await post(first)).status===200 && (await (await get()).json()).length===1);
    check('A-immutable','same sequence with changed hash rejected',(await post({...first,headHash:'c'.repeat(64)})).status===409);
    check('A-regress','earlier sequence rejected',(await post({...first,seq:'9'})).status===409);
    check('A-next','new checkpoint appended without replacing history',(await post({...first,seq:'11',headHash:'c'.repeat(64)})).status===201);
    check('A-history','all prior checkpoints retained',(await (await get()).json()).length===2);
    child.kill();await exit;child=undefined;
    await start();
    check('A-restart','checkpoint history survives process restart',(await (await get()).json()).length===2);
    check('A-bad-seq','out-of-range sequence rejected',(await post({...first,seq:'18446744073709551616'})).status===400);
  }finally{if(child){child.kill();await exit;}await fs.rm(dir,{recursive:true,force:true});}
}
