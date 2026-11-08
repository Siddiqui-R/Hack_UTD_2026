import { useEffect, useRef, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { Identity } from 'spacetimedb';
import { tables, reducers } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import { useRun } from '../components/Toast';
import { Modal } from '../components/Modal';
import { fmtUtc, shortId, tsToDate } from '../lib/format';
import { agentStateFor, parseIdentityHex } from '../lib/agentState';
import { incidentNumber, toolLabel } from '../lib/copy';
import { drawPaths, enter } from '../lib/motion';

function modelLabel(id: string) {
  return id.includes('lightning') ? 'LIGHTNING 30B' : id.includes('ultra') ? 'ULTRA 550B' : id.split('/').pop();
}
function jsonDisplay(value: string) { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Commander enrols a service identity for this incident (enrollAgent). The server enforces commander-only,
// refuses human/owner/revoked identities and writes the audit row.
function AgentAuthorisation({ incident, me }: { incident: Incident; me: TeamMember }) {
  const [agents] = useTable(tables.agentStatus);
  const [runs] = useTable(tables.investigationRuns);
  const enroll = useReducer(reducers.enrollAgent), run = useRun(true);
  const [input, setInput] = useState('');
  const state = agentStateFor(incident.id, agents, runs);
  const hex = parseIdentityHex(input);
  const enrolledHere = agents.filter(a => a.incidentId === incident.id);
  return (
    <div className="section-divider">
      <div className="section-head"><h2>Connect the investigation agent</h2><span className="badge" style={{ color: state.tone.color }} data-testid="agent-status">{state.tone.glyph} {state.label}</span></div>
      <p className="section-note">Paste the worker ID from the agent’s terminal to give it access to this incident. Access expires after 15 minutes without agent activity. The worker must also be running to pick up investigations.</p>
      {enrolledHere.length > 0 && <p className="mono dim" style={{ fontSize: 11, marginTop: 10 }}>
        {enrolledHere.map(a => <span key={a.identity.toHexString()} title={a.identity.toHexString()} style={{ marginRight: 12 }}>{shortId(a.identity.toHexString())}{a.revoked ? ' · access removed' : a.sessionActive ? ' · live' : ' · session expired'}</span>)}
      </p>}
      {me.role === 'commander' ? (
        <form className="action-row" style={{ marginTop: 15 }} onSubmit={async e => {
          e.preventDefault();
          if (!hex) return;
          if (await run(() => enroll({ target: Identity.fromString(hex), incidentId: incident.id }))) setInput('');
        }}>
          <input aria-label="Agent identity" className="mono" value={input} onChange={e => setInput(e.target.value)} spellCheck={false}
            placeholder="Paste the worker ID from the agent’s terminal" style={{ flex: 1, minWidth: 260, margin: 0 }} />
          <button type="submit" className="btn" disabled={!hex}>{state.needsEnrol && enrolledHere.length ? 'Renew access' : 'Connect agent'} for {incidentNumber(incident.id)}</button>
        </form>
      ) : <p className="section-note" style={{ marginTop: 12 }}>Only a commander can authorise the agent.</p>}
      {me.role === 'commander' && input && !hex && <p className="form-warning">That ID is not valid. Copy the full 64-character worker ID from the agent’s terminal.</p>}
    </div>
  );
}

// Evidence → conflict → assessment, drawn only from a recorded conflict and its two evidence records.
function ReasoningGraph({ a, b, reason, assessment, revised }: { a?: string; b?: string; reason: string; assessment?: string; revised: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { drawPaths(ref.current?.querySelectorAll('.reason-path') ?? [], 0.9); }, [reason, revised]);
  return (
    <section ref={ref} className={`reasoning-map ${revised ? 'is-revised' : ''}`}>
      <div className="section-head"><div><span className="eyebrow">FROM REPORTS TO A DECISION</span><h2>{revised ? 'Why the assessment changed' : 'How the reports compare'}</h2></div>
        <span className={`badge ${revised ? 'ok' : ''}`}>{revised ? 'ASSESSMENT UPDATED' : 'TWO REPORTS DISAGREE'}</span></div>
      <svg viewBox="0 0 850 218" role="img" aria-label={`Two reports disagree: ${reason}`}>
        <path className="reason-path evidence-a" d="M225 58 H290 Q310 58 310 79 V96 Q310 109 330 109 H355" />
        <path className="reason-path evidence-b" d="M225 159 H290 Q310 159 310 137 V124 Q310 109 330 109 H355" />
        {assessment && <path className="reason-path decision-path" d="M510 109 H625" />}
        <rect className="graph-source" x="4" y="23" width="221" height="70" rx="3" />
        <text className="graph-kicker" x="20" y="46">REPORT A</text><text className="graph-copy" x="20" y="72">{clip(a ?? 'Evidence not visible', 30)}</text>
        <rect className="graph-source" x="4" y="124" width="221" height="70" rx="3" />
        <text className="graph-kicker" x="20" y="147">REPORT B</text><text className="graph-copy" x="20" y="173">{clip(b ?? 'Evidence not visible', 30)}</text>
        <rect className="graph-conflict" x="355" y="69" width="155" height="80" rx="3" />
        <text className="graph-kicker caution" x="378" y="99">REPORTS DISAGREE</text><text className="graph-copy" x="379" y="124">Needs review</text>
        {assessment && <><rect className="graph-decision" x="625" y="69" width="220" height="80" rx="3" />
          <text className="graph-kicker" x="643" y="98">{revised ? 'UPDATED ASSESSMENT' : 'CURRENT ASSESSMENT'}</text>
          <text className="graph-copy" x="643" y="125">{clip(assessment, 26)}</text></>}
        <circle className="graph-junction" cx="310" cy="109" r="4" />
      </svg>
      <p className="section-note">Why they conflict: {reason}</p>
    </section>
  );
}

export function Investigate({ incident, me }: { incident: Incident; me: TeamMember }) {
  const [allRuns] = useTable(tables.investigationRuns);
  const [allSteps] = useTable(tables.investigationSteps);
  const [allEvidence] = useTable(tables.investigationEvidence);
  const [allConflicts] = useTable(tables.investigationConflicts);
  const request = useReducer(reducers.requestAgentRun), submit = useReducer(reducers.submitEvidence), cancel = useReducer(reducers.cancelAgentRun);
  const run = useRun(true);
  const [mode, setMode] = useState('mock'), [text, setText] = useState(''), [now, setNow] = useState(Date.now()), [adding, setAdding] = useState(false);
  const pipeline = useRef<HTMLDivElement>(null), conclusion = useRef<HTMLDivElement>(null);
  const runs = allRuns.filter(r => r.incidentId === incident.id).sort((a, b) => (a.id > b.id ? -1 : 1));
  const current = runs[0];
  const steps = allSteps.filter(s => s.runId === current?.id).sort((a, b) => (a.id < b.id ? -1 : 1));
  const evidence = allEvidence.filter(e => e.incidentId === incident.id).sort((a, b) => (a.id > b.id ? -1 : 1));
  const conflicts = allConflicts.filter(c => c.incidentId === incident.id);
  const busy = current && ['queued', 'running'].includes(current.status);
  useEffect(() => { if (current?.status !== 'running') return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [current?.status]);
  // Animate each real trace arrival (the newest step), never a scripted sequence.
  useEffect(() => { enter(pipeline.current?.lastElementChild ?? null, { opacity: [0, 1], x: [-8, 0] }, { duration: 0.35 }); }, [steps.length]);
  const revised = !!(current?.status === 'completed' && current.previousSummary && current.summary !== current.previousSummary);
  useEffect(() => { if (revised) enter(conclusion.current, { opacity: [0.1, 1], y: [14, 0] }, { duration: 0.6 }); }, [revised, current?.id]);

  const hero = (description: string) => <>
    <div className="kicker"><span>{incidentNumber(incident.id)}</span><span className="slash">/</span><span>INVESTIGATE</span></div>
    <div className="title-row"><div><h1>{incident.title}</h1><p>{description}</p></div></div>
  </>;
  if (me.role === 'observer') return <>{hero('Your role can’t open investigations.')}<p className="empty-note">Evidence and investigation steps are restricted to commanders and responders.</p></>;

  const elapsed = current?.startedAt && current.status === 'running' ? Math.max(0, now - tsToDate(current.startedAt).getTime()) : Number(current?.latencyMs ?? 0n);
  const firstConflict = conflicts[0];
  const evidenceText = (id: bigint) => allEvidence.find(e => e.id === id)?.text;
  const runLabel = !current ? 'Ready to investigate' : current.status === 'queued' ? 'Waiting for the agent service' : current.status === 'running' ? 'Investigation in progress'
    : current.status === 'completed' ? 'Investigation complete' : current.status === 'failed' ? 'Investigation failed' : current.status === 'cancelled' ? 'Investigation stopped' : current.status;

  return <>
    {hero('Compare the reports, follow each step, and see what changed.')}
    <div className="investigation-top">
      <div className="run-status">
        <span className="run-indicator">{busy ? '↗' : current?.status === 'completed' ? '✓' : current?.status === 'failed' ? '×' : '—'}</span>
        <div className="run-label">{runLabel}
          <small title={current?.modelId}>{current ? `RUN #${current.id} · ${current.status.toUpperCase()} · ${current.tier.toUpperCase()} · ${current.mode.toUpperCase()} · ${modelLabel(current.modelId)} · ${(elapsed / 1000).toFixed(1)}s` : 'NO INVESTIGATION RUNS YET'}</small>
        </div>
      </div>
      <div className="action-row">
        <select aria-label="Investigation mode" value={mode} onChange={e => setMode(e.target.value)} disabled={!!busy} style={{ width: 'auto', margin: 0 }}>
          <option value="mock">Practice run · no NVIDIA calls</option>
          <option value="replay">Replay a recorded run</option>
        </select>
        <button className="btn primary" disabled={!!busy} onClick={() => run(() => request({ incidentId: incident.id, tier: 'fast', mode }))}>Start investigation</button>
        <button className="btn" disabled={!!busy} onClick={() => run(() => request({ incidentId: incident.id, tier: 'deep', mode }))}>Investigate further</button>
        {busy && me.role === 'commander' && <button className="btn danger" onClick={() => run(() => cancel({ runId: current.id }))}>Stop investigation</button>}
      </div>
    </div>
    {firstConflict && <ReasoningGraph a={evidenceText(firstConflict.evidenceIdA)} b={evidenceText(firstConflict.evidenceIdB)} reason={firstConflict.reason} assessment={current?.summary || undefined} revised={revised} />}
    <div className="two-col">
      <section>
        <div className="section-head"><h2>What the agent did</h2><span className="eyebrow">{busy ? 'IN PROGRESS' : current ? `RUN #${current.id}` : 'NOT STARTED'}</span></div>
        {!current && <p className="empty-note">Add evidence, then start an investigation. Practice and replay runs make no NVIDIA calls.</p>}
        {current?.status === 'queued' && <p className="empty-note">Waiting for the agent. Make sure its worker is running and its access is active below.</p>}
        {current?.status === 'running' && !steps.length && <p className="empty-note">The agent has started · waiting for its first update <span className="trace-cursor">▌</span></p>}
        <div className="step-pipeline" ref={pipeline}>
          {steps.map((s, i) => {
            const active = current?.status === 'running' && i === steps.length - 1;
            return (
              <div key={s.id.toString()} className={`tool-step ${active ? 'current' : s.kind === 'error' ? 'pending' : 'complete'}`}>
                <span className="step-icon">{s.kind === 'error' ? '×' : s.kind === 'call' ? '→' : '✓'}</span>
                <div><strong title={s.name}>{toolLabel(s.name)}</strong><p>{s.kind === 'call' ? 'Request' : s.kind === 'error' ? 'Error' : 'Result'} · {fmtUtc(tsToDate(s.createdAt)).slice(11)}</p></div>
                <span>{active ? <>WORKING <span className="tool-progress"><i /></span></> : s.kind === 'call' ? 'REQUESTED' : s.kind === 'error' ? 'FAILED' : 'RECEIVED'}</span>
              </div>
            );
          })}
        </div>
        {current?.summary && (
          <div ref={conclusion} className={`conclusion ${revised ? 'revised' : ''}`}>
            <span className="eyebrow green">{current.status === 'failed' ? 'RUN FAILED' : revised ? 'UPDATED ASSESSMENT' : 'ASSESSMENT'}</span>
            {revised && <del>{current.previousSummary}</del>}
            <p style={{ whiteSpace: 'pre-wrap' }}>{current.summary}</p>
            <small className="dim" style={{ display: 'block', marginTop: 12 }}>{current.mode.toUpperCase()} · {modelLabel(current.modelId)} · {(elapsed / 1000).toFixed(1)}s{revised && current.finishedAt ? ` · revised ${fmtUtc(tsToDate(current.finishedAt))}` : ''}</small>
          </div>
        )}
        {steps.length > 0 && (
          <details style={{ marginTop: 24 }}>
            <summary className="quiet" style={{ cursor: 'pointer' }}>Step details · technical</summary>
            <div className="trace">{steps.map(s => (
              <details key={s.id.toString()}><summary>{s.name} · {s.kind}</summary><pre>{jsonDisplay(s.inputJson)}{'\n'}{jsonDisplay(s.outputJson)}</pre></details>
            ))}</div>
          </details>
        )}
        {conflicts.length > 0 && (
          <div className="section-divider">
            <div className="section-head"><h2>Two reports disagree</h2><span className="eyebrow">{conflicts.length} RECORDED</span></div>
            {conflicts.map(c => <div className="callout" key={c.id.toString()} style={{ marginTop: 12 }}>
              <span className="amber mono" style={{ fontSize: 11 }}>CONFLICT #{c.id.toString()} · EVIDENCE #{c.evidenceIdA.toString()} ↔ #{c.evidenceIdB.toString()}</span>
              <p style={{ marginTop: 8 }}>{c.reason}</p>
            </div>)}
          </div>
        )}
        <AgentAuthorisation incident={incident} me={me} />
      </section>
      <aside>
        <div className="section-head"><h2>Reports &amp; evidence</h2><span className="eyebrow">{evidence.length} RECORDS</span></div>
        {!evidence.length && <p className="empty-note">No evidence submitted yet.</p>}
        {evidence.map(e => (
          <article className="evidence" key={e.id.toString()}>
            <div className="eyebrow">EVIDENCE #{e.id.toString()} · {fmtUtc(tsToDate(e.createdAt), false)}</div>
            <details><summary>{clip(e.text.split('\n')[0] ?? '', 80)}</summary><p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.text}</p></details>
          </article>
        ))}
        <button className="btn" onClick={() => setAdding(true)}>+ Add evidence</button>
        <div className="callout" style={{ marginTop: 20 }}>
          <span className="eyebrow">WHAT THE AGENT CAN DO</span>
          <p style={{ marginTop: 10 }}>The agent can create tasks, raise severity and flag conflicting reports. Only people can manage access, change roles or approve closure.</p>
        </div>
        <p className="section-note" style={{ marginTop: 15 }}>Reports can contain misleading instructions. They are treated as evidence, not authority.</p>
      </aside>
    </div>
    <Modal open={adding} onClose={() => setAdding(false)} title="Add evidence" intro="Paste a report or log for the team and the investigation agent to review.">
      <form onSubmit={async e => { e.preventDefault(); if (await run(() => submit({ incidentId: incident.id, text }))) { setText(''); setAdding(false); } }}>
        <label>Report or log<textarea className="mono" value={text} onChange={e => setText(e.target.value)} maxLength={32000} required placeholder="Paste a log or incident report" /></label>
        <div className="form-actions"><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" type="submit">Add evidence</button></div>
      </form>
    </Modal>
  </>;
}
