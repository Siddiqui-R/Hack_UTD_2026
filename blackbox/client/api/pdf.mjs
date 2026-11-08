// Integration adapter only. Rabeet owns the renderer; this route fetches a fresh authorized module snapshot.
export default async function handler(request,response) {
 response.setHeader('Cache-Control','no-store');
 if(request.method!=='POST'){response.setHeader('Allow','POST');return response.status(405).json({error:'POST required'});}
 const renderer=process.env.PDF_RENDERER_URL;
 if(!renderer)return response.status(503).json({error:'PDF renderer not connected'});
 const auth=request.headers.authorization;
 if(typeof auth!=='string'||!auth.startsWith('Bearer '))return response.status(401).json({error:'Sign in to export a record'});
 try {
  const body=typeof request.body==='string'?JSON.parse(request.body):request.body;
  const incidentId=String(body?.incidentId??'');
  if(!/^\d{1,20}$/.test(incidentId)||BigInt(incidentId)<1n||BigInt(incidentId)>18446744073709551615n)return response.status(400).json({error:'Valid incident ID required'});
  const source=new URL(process.env.VITE_STDB_URI??'');source.protocol=source.protocol==='wss:'?'https:':source.protocol==='ws:'?'http:':source.protocol;
  const database=process.env.VITE_STDB_DB;
  if(!database||!['https:','http:'].includes(source.protocol))return response.status(503).json({error:'Module endpoint not configured'});
  const record=await fetch(`${source.origin}/v1/database/${encodeURIComponent(database)}/call/get_record`,{
   method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:`[${incidentId}]`,signal:AbortSignal.timeout(15000),
  });
  if(!record.ok)return response.status(record.status===401||record.status===403?record.status:403).json({error:'Record access denied or session expired'});
  const wire=await record.json(),snapshot=typeof wire==='string'?JSON.parse(wire):wire;
  if(snapshot.schemaVersion!==1||String(snapshot.incident?.id)!==incidentId)return response.status(502).json({error:'Invalid module snapshot'});
  const rendered=await fetch(renderer,{method:'POST',headers:{'content-type':'application/json',...(process.env.PDF_RENDERER_TOKEN?{authorization:`Bearer ${process.env.PDF_RENDERER_TOKEN}`}:{})},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(20000)});
  if(!rendered.ok||!rendered.headers.get('content-type')?.includes('application/pdf'))return response.status(502).json({error:'PDF renderer did not return a PDF'});
  const pdf=Buffer.from(await rendered.arrayBuffer());
  if(pdf.length>4*1024*1024)return response.status(502).json({error:'PDF exceeds download size limit'});
  response.setHeader('Content-Type','application/pdf');response.setHeader('Content-Disposition',`attachment; filename="BLACKBOX-INC-${incidentId}.pdf"`);return response.status(200).send(pdf);
 }catch{return response.status(502).json({error:'PDF export could not be completed'});}
}
