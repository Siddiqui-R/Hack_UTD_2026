// POST the existing snapshot contract; no database or NVIDIA credentials required.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { renderPdf, validateSnapshot } from './render.mjs';
const origins=new Set((process.env.PDF_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174').split(',').filter(Boolean));
const rendererToken=process.env.PDF_RENDERER_TOKEN;
// Reachable from the internet (public.mjs tunnel): never run without the shared credential.
if(process.env.PDF_PUBLIC==='1' && (!rendererToken || rendererToken.length<32)){console.error('PDF_PUBLIC=1 requires a PDF_RENDERER_TOKEN of at least 32 characters');process.exit(1);}
let rendering=false;
const server=http.createServer(async(req,res)=>{
  const send=(status,text)=>{res.writeHead(status,{'content-type':'text/plain','cache-control':'no-store'});res.end(text);};
  const origin=req.headers.origin;
  if(origin && !origins.has(origin)) return send(403,'Origin not allowed');
  if(origin){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');}
  res.setHeader('x-content-type-options','nosniff');
  if(req.url==='/health' && req.method==='GET')return send(200,'BLACKBOX PDF renderer');
  if(req.url!=='/record.pdf')return send(404,'Not found');
  if(req.method==='OPTIONS'){
    res.setHeader('access-control-allow-methods','POST');res.setHeader('access-control-allow-headers','content-type');
    res.writeHead(204);return res.end();
  }
  if(req.method!=='POST')return send(405,'Use POST');
  if(!req.headers['content-type']?.startsWith('application/json'))return send(415,'JSON required');
  if(rendererToken){
    const provided=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${rendererToken}`);
    if(provided.length!==expected.length || !timingSafeEqual(provided,expected))return send(401,'Renderer credential required');
  }else if(req.headers.authorization)return send(400,'Database credentials must not be sent to the renderer');
  if(rendering)return send(503,'Renderer busy');
  let length=0,chunks=[];
  try{
    for await(const chunk of req){length+=chunk.length;if(length>2*1024*1024)return send(413,'Snapshot exceeds 2 MiB');chunks.push(chunk);}
    let snapshot;
    try{snapshot=validateSnapshot(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{return send(422,'Invalid RecordSnapshot v1');}
    if(rendering)return send(503,'Renderer busy');
    rendering=true;
    try {
      const pdf=await renderPdf(snapshot);
      res.writeHead(200,{'content-type':'application/pdf','content-disposition':`attachment; filename="BLACKBOX-INC-${snapshot.incident.id}.pdf"`,'cache-control':'no-store','content-length':pdf.length});res.end(pdf);
    }finally{rendering=false;}
  }catch{if(!res.headersSent)send(500,'PDF rendering failed');else res.end();}
});
server.listen(Number(process.env.PDF_PORT??4400),process.env.PDF_HOST??'127.0.0.1',()=>console.log(`BLACKBOX PDF renderer listening on ${server.address().port}`));
