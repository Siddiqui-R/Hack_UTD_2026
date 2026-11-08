// Independent hosted checkpoint API. No evidence, session tokens or NVIDIA credentials stored here.
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
async function authorized(request, token) {
 if(!token)return false;
 const supplied=request.headers.get('authorization')??'';
 const [a,b]=await Promise.all([supplied,`Bearer ${token}`].map(v=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))));
 const x=new Uint8Array(a),y=new Uint8Array(b);let d=0;for(let i=0;i<32;i++)d|=x[i]^y[i];return d===0;
}
function checkpoint(row){return {database:row.database_id,seq:row.seq,headHash:row.head_hash,at:row.created_at,ref:row.external_ref};}
export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  try{
   if(!env.DB)return json(503,{error:'durable storage not bound'});
   if(request.method==='GET'&&url.pathname==='/health'){
    await env.DB.prepare('SELECT seq FROM checkpoint LIMIT 1').first();
    return json(200,{service:'BLACKBOX checkpoint store',storage:'durable-d1',version:1});
   }
   if(request.method==='GET'&&url.pathname==='/checkpoints'){
    if(!await authorized(request,env.ANCHOR_READ_TOKEN))return json(401,{error:'unauthorized'});
    const database=url.searchParams.get('database');if(!/^[0-9a-f]{64}$/.test(database??''))return json(400,{error:'invalid database'});
    const {results}=await env.DB.prepare('SELECT * FROM checkpoint WHERE database_id = ? ORDER BY seq_key').bind(database).all();
    return json(200,results.map(checkpoint));
   }
   if(request.method!=='POST'||url.pathname!=='/checkpoint')return json(404,{error:'not found'});
   if(!await authorized(request,env.ANCHOR_WRITE_TOKEN))return json(401,{error:'unauthorized'});
   const body=await request.text();if(body.length>4096)return json(413,{error:'too large'});
   const {database,seq,headHash}=JSON.parse(body);
   if(!/^[0-9a-f]{64}$/.test(database)||typeof seq!=='string'||!/^\d{1,20}$/.test(seq)||BigInt(seq)>18446744073709551615n||!/^[0-9a-f]{64}$/.test(headHash))return json(400,{error:'invalid checkpoint'});
   const normalized=BigInt(seq).toString(),key=normalized.padStart(20,'0');
   const existing=await env.DB.prepare('SELECT * FROM checkpoint WHERE database_id = ? AND seq = ?').bind(database,normalized).first();
   if(existing)return existing.head_hash===headHash?json(200,checkpoint(existing)):json(409,{error:'checkpoint immutable'});
   const at=(BigInt(Date.now())*1000n).toString(),ref=`checkpoint:${database}:${normalized}`;
   const result=await env.DB.prepare('INSERT INTO checkpoint(database_id,seq,seq_key,head_hash,created_at,external_ref) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM checkpoint WHERE database_id=? AND seq_key>?)').bind(database,normalized,key,headHash,at,ref,database,key).run();
   if(result.meta.changes!==1)return json(409,{error:'checkpoint regressed'});
   return json(201,{database,seq:normalized,headHash,at,ref});
  }catch(error){console.warn('checkpoint request failed',error?.name??'Error');return json(500,{error:'checkpoint unavailable'});}
 }
};
