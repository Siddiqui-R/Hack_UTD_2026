import { useCallback, useEffect, useRef, useState } from 'react';
import { useProcedure, useSpacetimeDB } from 'spacetimedb/react';
import { procedures } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import { useRun } from '../components/Toast';
import { downloadSnapshot, exportPdf, PDF_ENDPOINT, USE_PDF_PROXY } from '../lib/pdfExport';
import { formatMicros, type RecordSnapshot } from '../lib/recordTypes';

function Hash({ stored, recomputed }: { stored: string; recomputed: string }) {
  const first=[...stored].findIndex((c,i)=>c!==recomputed[i]);
  return <div className="grid gap-3 font-mono text-[12px]"><div><div className="label mb-1">Stored hash</div><div className="break-all">{[...stored].map((c,i)=><span key={i} className={i===first?'bg-critical text-bg-0':''}>{c}</span>)}</div></div><div><div className="label mb-1">Recomputed in module</div><div className="break-all">{[...recomputed].map((c,i)=><span key={i} className={i===first?'bg-critical text-bg-0':''}>{c}</span>)}</div></div></div>;
}
export function RecordView({ incident, me }: { incident: Incident; me: TeamMember }) {
  const {token}=useSpacetimeDB();
  const [pdfReady,setPdfReady]=useState(!USE_PDF_PROXY && !!PDF_ENDPOINT);
  useEffect(()=>{if(!USE_PDF_PROXY)return;let active=true;fetch('/api/integrations').then(r=>r.ok?r.json():{pdfReady:false}).then(v=>{if(active)setPdfReady(v.pdfReady===true)}).catch(()=>{if(active)setPdfReady(false)});return()=>{active=false}},[]);
  const load=useProcedure(procedures.getRecord),inspect=useProcedure(procedures.inspectAuditEvent),run=useRun();
  const [snapshot,setSnapshot]=useState<RecordSnapshot>(),[selected,setSelected]=useState<string>(),[detail,setDetail]=useState<{storedHash:string;recomputedHash:string;payloadJson:string}>(),[exporting,setExporting]=useState(false);
  const focused=useRef<HTMLButtonElement>(null);
  const refresh=useCallback(()=>run(async()=>{const next=JSON.parse(await load({incidentId:incident.id})) as RecordSnapshot;setSnapshot(next);}),[load,incident.id,run]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),5000);return()=>window.clearInterval(timer);},[refresh]);
  useEffect(()=>{if(snapshot?.verification.brokenAt)setSelected(snapshot.verification.brokenAt);},[snapshot?.verification.brokenAt]);
  useEffect(()=>{setDetail(undefined);if(!selected||me.role==='observer')return;let active=true;void run(async()=>{const next=JSON.parse(await inspect({seq:BigInt(selected)}));if(active)setDetail(next);});return()=>{active=false};},[selected,me.role,inspect,run,snapshot?.generatedAt]);
  useEffect(()=>{if(selected===snapshot?.verification.brokenAt)focused.current?.scrollIntoView({block:'nearest'});},[selected,snapshot?.verification.brokenAt]);
  if(!snapshot)return <p className="p-6 font-mono text-[12px] text-text-2">LOADING INCIDENT RECORD</p>;
  const broken=snapshot.verification.brokenAt,anchor=snapshot.anchoredCheckpoint;
  const event=snapshot.audit.find(e=>e.seq===selected);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex items-center gap-3 border-b border-line px-6 py-4"><h1 className="flex-1 text-[20px] font-semibold">Incident record</h1><button className="btn" onClick={()=>void refresh()}>Refresh</button><button className="btn" onClick={()=>downloadSnapshot(snapshot)}>Download JSON</button><button className="btn btn-primary" disabled={!pdfReady||exporting} title={!pdfReady?'Rabeet PDF renderer not connected':undefined} onClick={async()=>{setExporting(true);await run(()=>exportPdf(snapshot,token));setExporting(false);}}>{exporting?'Exporting PDF':'Export PDF'}</button></div>
    <div className="border-b border-line px-6 py-3 font-mono text-[11px] text-text-1">SNAPSHOT {formatMicros(snapshot.generatedAt)} · {snapshot.audit.length} INCIDENT EVENTS · {snapshot.verification.checked} GLOBAL RECORDS CHECKED{!pdfReady&&<span className="ml-3 text-text-2">PDF RENDERER NOT CONNECTED</span>}</div>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,1fr)_minmax(320px,1fr)]">
      <section className="min-h-0 overflow-y-auto border-r border-line"><div className="label sticky top-0 border-b border-line bg-bg-1 px-4 py-3">Audit timeline</div>{snapshot.audit.length===0&&<p className="p-4 text-text-2">No incident events recorded.</p>}{snapshot.audit.map(e=><button key={e.seq} ref={e.seq===broken?focused:undefined} onClick={()=>setSelected(e.seq)} aria-selected={selected===e.seq} className={`row w-full text-left ${broken&&e.seq!==broken?'opacity-25':''} ${e.seq===broken?'border-2 border-critical text-critical':''}`}><span className="w-12 shrink-0 font-mono text-[12px]">#{e.seq}</span><span className="w-20 shrink-0 font-mono text-[11px] text-text-2">{formatMicros(e.createdAt).slice(11,19)}</span><span className="truncate font-mono text-[12px]">{e.action}</span><span className="ml-auto font-mono text-[11px] text-text-2">{e.actor==='NEMOTRON'?'NEMOTRON':e.actor.slice(0,8)}</span></button>)}</section>
      <aside className="min-h-0 overflow-y-auto bg-bg-1 p-6">
        <div className="label">Verification</div><p className={`mt-2 font-mono text-[12px] ${snapshot.verification.ok?'text-ok':'text-critical'}`}>{snapshot.verification.ok?'CHAIN INTERNALLY CONSISTENT':`INTEGRITY BROKEN · #${broken}`}</p><p className="mt-2 text-[12px] text-text-1">{snapshot.verification.anchorReason}</p>
        <div className="label mt-5">Current database head · #{snapshot.auditHead.seq}</div><div className="mt-2 break-all font-mono text-[12px] text-text-1">{snapshot.auditHead.hash}</div>
        <div className="label mt-5">External checkpoint</div>{anchor?<><p className="mt-2 font-mono text-[11px]">#{anchor.seq} · {anchor.independentlyVerified?'INDEPENDENTLY VERIFIED':'NOT CONFIRMED INDEPENDENT'}</p><p className="mt-2 break-all font-mono text-[12px] text-text-1">{anchor.headHash}</p><p className="mt-1 font-mono text-[11px] text-text-2">{formatMicros(anchor.at)}</p></>:<p className="mt-2 text-text-2">No external checkpoint confirmed. This record is not independently anchored.</p>}
        {event&&<section className="mt-6 border-t border-line pt-4"><div className="label">Record #{event.seq} · {event.action}</div>{detail?<><div className="mt-4"><Hash stored={detail.storedHash} recomputed={detail.recomputedHash}/></div><pre className="mt-4 whitespace-pre-wrap break-words font-mono text-[12px] text-text-1">{detail.payloadJson}</pre></>:<p className="mt-3 text-text-2">{me.role==='observer'?'Audit payload is restricted.':'Loading record details.'}</p>}</section>}
        {!event&&<p className="mt-6 text-text-2">Select a timeline record to inspect its stored and recomputed hashes.</p>}
      </aside>
    </div>
  </div>;
}
