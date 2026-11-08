import { useEffect, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { tables, reducers } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import { useRun } from '../components/Toast';
import { fmtUtc, tsToDate } from '../lib/format';

function modelLabel(id: string) {
  return id.includes('lightning') ? 'LIGHTNING 30B' : id.includes('ultra') ? 'ULTRA 550B' : id.split('/').pop();
}
function jsonDisplay(value: string) { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
export function Investigate({ incident, me }: { incident: Incident; me: TeamMember }) {
  const [allRuns] = useTable(tables.investigationRuns);
  const [allSteps] = useTable(tables.investigationSteps);
  const [allEvidence] = useTable(tables.investigationEvidence);
  const [allConflicts] = useTable(tables.investigationConflicts);
  const request = useReducer(reducers.requestAgentRun), submit = useReducer(reducers.submitEvidence), cancel = useReducer(reducers.cancelAgentRun);
  const run = useRun();
  const [mode, setMode] = useState('mock'), [text, setText] = useState(''), [now, setNow] = useState(Date.now());
  const runs = allRuns.filter(r => r.incidentId === incident.id).sort((a,b) => a.id > b.id ? -1 : 1);
  const current = runs[0];
  const steps = allSteps.filter(s => s.runId === current?.id).sort((a,b) => a.id < b.id ? -1 : 1);
  const evidence = allEvidence.filter(e => e.incidentId === incident.id).sort((a,b) => a.id > b.id ? -1 : 1);
  const conflicts = allConflicts.filter(c => c.incidentId === incident.id);
  const busy = current && ['queued','running'].includes(current.status);
  useEffect(() => { if(current?.status !== 'running') return; const t=window.setInterval(()=>setNow(Date.now()),1000);return ()=>window.clearInterval(t); },[current?.status]);
  if(me.role === 'observer') return <p className="p-6 text-text-1">Evidence and investigation are restricted to commanders and responders.</p>;
  const elapsed = current?.startedAt && current.status === 'running' ? Math.max(0,now-tsToDate(current.startedAt).getTime()) : Number(current?.latencyMs ?? 0n);
  const revised = current?.status === 'completed' && current.previousSummary && current.summary !== current.previousSummary;
  return <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px]">
    <section className="flex min-h-0 flex-col border-r border-line">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
        <h1 className="flex-1 text-[20px] font-semibold">Investigate</h1>
        <select aria-label="Agent mode" className="field w-auto font-mono text-[12px]" value={mode} onChange={e=>setMode(e.target.value)} disabled={!!busy}><option value="mock">MOCK</option><option value="replay">REPLAY</option></select>
        <button className="btn btn-primary" disabled={!!busy} onClick={()=>run(()=>request({incidentId:incident.id,tier:'fast',mode}))}>Run investigation</button>
        <button className="btn" disabled={!!busy} onClick={()=>run(()=>request({incidentId:incident.id,tier:'deep',mode}))}>Deep Analysis</button>
      </div>
      <div className="flex items-center justify-between border-b border-line px-6 py-2 font-mono text-[11px] text-text-1">
        <span>{current ? `RUN #${current.id} · ${current.status.toUpperCase()}` : 'NO INVESTIGATION RUNS'}</span>
        {current && <span title={current.modelId}>{current.mode.toUpperCase()} · {modelLabel(current.modelId)} · {(elapsed/1000).toFixed(1)}s</span>}
        {busy && me.role==='commander' && <button className="btn" onClick={()=>run(()=>cancel({runId:current.id}))}>Cancel run</button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {current?.status==='queued' && <p className="font-mono text-[12px] text-text-1">QUEUED · waiting for the enrolled agent service</p>}
        {!current && <p className="text-text-2">Submit evidence, then run an investigation. Mock and replay use no model credits.</p>}
        {current?.status==='running' && !steps.length && <p className="font-mono text-[12px] text-text-1">WORKER CLAIMED · waiting for first tool step <span className="trace-cursor">▌</span></p>}
        {steps.map((step,i)=><div key={step.id.toString()} className={`border-b border-line py-3 font-mono text-[12px] ${current?.status==='running'&&i===steps.length-1?'border-l border-l-accent pl-3':'text-text-1'}`}>
          <div className="flex gap-2"><span className="text-text-2">[{fmtUtc(tsToDate(step.createdAt)).slice(11)}]</span><span>{step.kind==='call'?'→':step.kind==='error'?'×':'←'}</span><span className="text-accent">{step.name}</span><span className="uppercase text-text-2">{step.kind}</span></div>
          <details className="mt-2"><summary className="cursor-pointer truncate text-text-2">{step.kind==='call'?step.inputJson:step.outputJson}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-text-1">{jsonDisplay(step.inputJson)}{'\n'}{jsonDisplay(step.outputJson)}</pre></details>
        </div>)}
        {current?.summary && <section className="mt-6 border-t border-line pt-4">
          <div className="label">{current.status==='failed'?'Run failed':revised?'Revised conclusion':'Conclusion'}</div>
          {revised && <del className="mt-3 block whitespace-pre-wrap text-text-2">{current.previousSummary}</del>}
          <div className={`mt-3 whitespace-pre-wrap ${revised?'revision-enter border-l-2 border-ok pl-3':''}`}>{current.summary}</div>
          {revised && <span className="mt-2 inline-block font-mono text-[11px] text-ok">REVISED · {current.finishedAt?fmtUtc(tsToDate(current.finishedAt)):''}</span>}
        </section>}
        {conflicts.length>0 && <section className="mt-6 border-t border-line pt-4"><div className="label">Conflicting evidence</div>{conflicts.map(c=><div key={c.id.toString()} className="mt-3 border-l-2 border-medium pl-3"><div className="font-mono text-[11px] text-medium">CONFLICT #{c.id.toString()} · EVIDENCE #{c.evidenceIdA.toString()} ↔ #{c.evidenceIdB.toString()}</div><p className="mt-1">{c.reason}</p></div>)}</section>}
      </div>
    </section>
    <aside className="flex min-h-0 flex-col bg-bg-1">
      <div className="label border-b border-line px-4 py-3">Evidence · {evidence.length}</div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{!evidence.length&&<p className="text-text-2">No evidence submitted.</p>}{evidence.map(e=><details key={e.id.toString()} className="mb-3 border-b border-line pb-3"><summary className="cursor-pointer font-mono text-[12px] text-text-1">#{e.id.toString()} · {fmtUtc(tsToDate(e.createdAt),false)}</summary><pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] text-text-1">{e.text}</pre></details>)}</div>
      <form className="flex flex-col gap-2 border-t border-line p-4" onSubmit={async e=>{e.preventDefault();if(await run(()=>submit({incidentId:incident.id,text})))setText('');}}><label className="label" htmlFor="evidence-input">Add evidence</label><textarea id="evidence-input" className="field h-36 resize-y py-2 font-mono text-[12px]" value={text} onChange={e=>setText(e.target.value)} maxLength={32000} required placeholder="Paste a log or incident report"/><button className="btn" type="submit">Submit evidence</button></form>
    </aside>
  </div>;
}
