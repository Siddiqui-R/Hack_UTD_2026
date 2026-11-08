// Deploy separately from SpacetimeDB. No delete/update API; persist CHECKPOINT_FILE on durable storage.
import http from 'node:http';
import {openSync,writeSync,fsyncSync,readFileSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {timingSafeEqual} from 'node:crypto';
const file=resolve(process.env.CHECKPOINT_FILE ?? 'checkpoints.jsonl');
const writeToken=process.env.ANCHOR_WRITE_TOKEN,readToken=process.env.ANCHOR_READ_TOKEN;
if(!writeToken || !readToken || writeToken===readToken)throw new Error('Set distinct ANCHOR_WRITE_TOKEN and ANCHOR_READ_TOKEN');
mkdirSync(dirname(file),{recursive:true});
const records=existsSync(file)?readFileSync(file,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
const fd=openSync(file,'a',0o600);
function authorized(req,token){const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${token}`);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
const server=http.createServer(async(req,res)=>{
 const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/checkpoints'){
   if(!authorized(req,readToken))return reply(401,{error:'unauthorized'});
   const database=url.searchParams.get('database');if(!/^[0-9a-f]{64}$/.test(database??''))return reply(400,{error:'invalid database'});
   return reply(200,records.filter(r=>r.database===database));
  }
  if(req.method!=='POST'||url.pathname!=='/checkpoint')return reply(404,{error:'not found'});
  if(!authorized(req,writeToken))return reply(401,{error:'unauthorized'});
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)return reply(413,{error:'too large'});}
  const {database,seq,headHash}=JSON.parse(body);
  if(!/^[0-9a-f]{64}$/.test(database)||typeof seq!=='string'||!/^\d{1,20}$/.test(seq)||BigInt(seq)>18446744073709551615n||!/^[0-9a-f]{64}$/.test(headHash))return reply(400,{error:'invalid checkpoint'});
  const prior=records.filter(r=>r.database===database),same=prior.find(r=>r.seq===seq);
  if(same)return same.headHash===headHash?reply(200,same):reply(409,{error:'checkpoint immutable'});
  if(prior.some(r=>BigInt(r.seq)>BigInt(seq)))return reply(409,{error:'checkpoint regressed'});
  const row={database,seq,headHash,at:(BigInt(Date.now())*1000n).toString(),ref:`checkpoint:${database}:${seq}`};
  writeSync(fd,JSON.stringify(row)+'\n');fsyncSync(fd);records.push(row);return reply(201,row);
 }catch{reply(400,{error:'checkpoint request failed'});}
});
server.listen(Number(process.env.PORT??4300),process.env.HOST??'127.0.0.1',()=>console.log('Checkpoint store listening; append-only storage active'));
