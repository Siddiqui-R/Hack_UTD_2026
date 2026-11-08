import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCommander,signIn,call } from '../lib.mjs';
import { incident, read, must, check } from '../slice-helpers.mjs';
import { snapshotHtml } from '../../pdf/render.mjs';
export const slice='12/PDF';
export const title='Actual PDF endpoint, injection escaping and anchor claims';
const root=fileURLToPath(new URL('../../',import.meta.url));

export async function run(){
  const cmd=await getCommander(),obs=await signIn('observer'),inc=await incident('pdf');
  const secret='PRIVATE_PDF_EVIDENCE';
  must(await call(cmd,'submit_evidence',[inc.id,`${secret}: <script>alert("evidence")</script> / 客戶資料 / `+'Long incident evidence. '.repeat(400)]));
  must(await call(cmd,'add_scope_item',[inc.id,'private-pdf-asset','PII','compromised','confirmed',42,'private-pdf-note']));
  const snapshot=await read(cmd,'get_record',[inc.id]),redacted=await read(obs,'get_record',[inc.id]);
  const html=snapshotHtml(snapshot);
  check('P-escape','untrusted evidence is escaped, Unicode preserved',html.includes('&lt;script&gt;') && !html.includes('<script>') && html.includes('客戶資料'));
  const obsHtml=snapshotHtml({...redacted,evidence:snapshot.evidence,scope:snapshot.scope});
  check('P-redact','renderer enforces observer restrictions again',!obsHtml.includes(secret)&&!obsHtml.includes('private-pdf-asset'));
  check('P-unanchored','unanchored snapshot never claims independent verification',html.includes('NOT INDEPENDENTLY ANCHORED')&&!html.includes('INDEPENDENT CHECKPOINT VERIFIED'));
  const hash='a'.repeat(64),anchored={...snapshot,auditHead:{seq:'10',hash:'b'.repeat(64)},verification:{...snapshot.verification,ok:true,anchorOk:true,anchorStatus:'verified'},anchoredCheckpoint:{seq:'8',headHash:hash,at:snapshot.generatedAt,externalRef:'test checkpoint',independentlyVerified:true}};
  const anchoredHtml=snapshotHtml(anchored);
  check('P-anchor-hash','report renders external hash separately and warns about later tail',anchoredHtml.includes(hash)&&anchoredHtml.includes('later database tail is not covered'));
  const localHtml=snapshotHtml({...anchored,verification:{...anchored.verification,anchorStatus:'local',anchorOk:undefined}});
  check('P-local','local checkpoint cannot become independent green',!localHtml.includes('INDEPENDENT CHECKPOINT VERIFIED'));
  const child=spawn(process.execPath,['pdf/server.mjs'],{cwd:root,env:{...process.env,PDF_PORT:'0'},stdio:['ignore','pipe','pipe']});
  const exit=new Promise(resolve=>child.once('exit',resolve));
  try{
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('PDF startup timeout')),5000);
      child.stdout.on('data',data=>{const m=String(data).match(/listening on (\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
      child.once('error',err=>{clearTimeout(timer);reject(err);});
    });
    const endpoint=`http://127.0.0.1:${port}/record.pdf`;
    const post=(body,headers={})=>fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
    check('P-bad-origin','unapproved browser origin refused',(await post(snapshot,{origin:'https://attacker.invalid'})).status===403);
    check('P-token','database credentials refused',(await post(snapshot,{authorization:'Bearer test-token'})).status===400);
    check('P-shape','invalid snapshot refused',(await post({schemaVersion:99})).status===422);
    check('P-limit','oversized snapshot refused',(await post({padding:'x'.repeat(2*1024*1024)})).status===413);
    const mismatch={...anchored,anchoredCheckpoint:{...anchored.anchoredCheckpoint,seq:'10'}};
    check('P-contradiction','contradictory current-head checkpoint claim refused',(await post(mismatch)).status===422);
    const response=await post(snapshot,{origin:'http://localhost:5173'}),pdf=Buffer.from(await response.arrayBuffer());
    check('P-pdf','real snapshot POST returns valid PDF bytes',response.status===200 && response.headers.get('content-type')==='application/pdf' && pdf.subarray(0,5).toString()==='%PDF-');
    check('P-cors','approved client origin and no-cache headers',response.headers.get('access-control-allow-origin')==='http://localhost:5173' && response.headers.get('cache-control')==='no-store');
    const dir=path.join(root,'agent-logs','pdf-qa');await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'record.pdf'),pdf);
    await fs.writeFile(path.join(dir,'record.html'),html);
    const observer=await post(redacted),observerPdf=Buffer.from(await observer.arrayBuffer());
    check('P-observer-pdf','redacted snapshot renders a real PDF',observer.status===200 && observerPdf.subarray(0,5).toString()==='%PDF-');
    await fs.writeFile(path.join(dir,'observer.pdf'),observerPdf);
  }finally{child.kill();await exit;}
}
