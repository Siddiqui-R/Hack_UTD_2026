import { useCallback, useEffect, useRef, useState } from 'react';
import { useProcedure, useSpacetimeDB } from 'spacetimedb/react';
import { procedures } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import { useRun } from '../components/Toast';
import { downloadSnapshot, exportPdf, PDF_ENDPOINT, USE_PDF_PROXY } from '../lib/pdfExport';
import { formatMicros, type RecordSnapshot } from '../lib/recordTypes';
import { eventLabel, incidentNumber } from '../lib/copy';
import { enter } from '../lib/motion';

function Hash({ stored, recomputed }: { stored: string; recomputed: string }) {
  const first = [...stored].findIndex((c, i) => c !== recomputed[i]);
  const mark = (s: string) => [...s].map((c, i) => <span key={i} className={i === first ? 'hash-diff' : ''}>{c}</span>);
  return <>
    <p className="eyebrow">STORED HASH</p><p className="hash" style={{ marginTop: 10 }}>{mark(stored)}</p>
    <p className="eyebrow" style={{ marginTop: 25 }}>RECOMPUTED IN THE MODULE</p><p className="hash" style={{ marginTop: 10 }}>{mark(recomputed)}</p>
    {first >= 0 && <p className="red mono" style={{ marginTop: 10, fontSize: 11 }}>HASH MISMATCH · FIRST DIFFERENCE AT CHARACTER {first + 1}</p>}
  </>;
}
// Decorative bars derived from a real stored hash (shape only, no meaning beyond "this hash").
const bars = (hash: string) => Array.from({ length: 12 }, (_, i) => 8 + (parseInt(hash.slice(i * 2, i * 2 + 2) || '0', 16) % 15));

export function RecordView({ incident, me, focus }: { incident: Incident; me: TeamMember; focus?: string }) {
  const { token } = useSpacetimeDB();
  const [pdfReady, setPdfReady] = useState(!USE_PDF_PROXY && !!PDF_ENDPOINT);
  useEffect(() => { if (!USE_PDF_PROXY) return; let active = true; fetch('/api/integrations').then(r => (r.ok ? r.json() : { pdfReady: false })).then(v => { if (active) setPdfReady(v.pdfReady === true); }).catch(() => { if (active) setPdfReady(false); }); return () => { active = false; }; }, []);
  const load = useProcedure(procedures.getRecord), inspect = useProcedure(procedures.inspectAuditEvent), run = useRun();
  const [snapshot, setSnapshot] = useState<RecordSnapshot>(), [selected, setSelected] = useState<string | undefined>(focus), [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<{ storedHash: string; recomputedHash: string; payloadJson: string }>();
  const focused = useRef<HTMLButtonElement>(null), chain = useRef<HTMLDivElement>(null);
  const refresh = useCallback(() => run(async () => { const next = JSON.parse(await load({ incidentId: incident.id })) as RecordSnapshot; setSnapshot(next); }), [load, incident.id, run]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { if (focus) setSelected(focus); }, [focus]);
  useEffect(() => { if (snapshot?.verification.brokenAt) setSelected(snapshot.verification.brokenAt); }, [snapshot?.verification.brokenAt]);
  useEffect(() => { setDetail(undefined); if (!selected || me.role === 'observer') return; let active = true; void run(async () => { const next = JSON.parse(await inspect({ seq: BigInt(selected) })); if (active) setDetail(next); }); return () => { active = false; }; }, [selected, me.role, inspect, run, snapshot?.generatedAt]);
  useEffect(() => { if (selected && selected === snapshot?.verification.brokenAt) focused.current?.scrollIntoView({ block: 'nearest' }); }, [selected, snapshot?.verification.brokenAt]);
  const loaded = !!snapshot;
  useEffect(() => { enter(chain.current?.querySelectorAll('.chain-block,.anchor-end') ?? null, { opacity: [0.2, 1], y: [8, 0] }, { staggerBy: 0.07 }); }, [loaded, incident.id]);
  const brokenNow = snapshot?.verification.brokenAt;
  useEffect(() => { if (brokenNow) enter(chain.current?.querySelector('.chain-block.corrupt') ?? null, { x: [0, -3, 2, 0] }, { duration: 0.28 }); }, [brokenNow]);

  const hero = <>
    <div className="kicker"><span>{incidentNumber(incident.id)}</span><span className="slash">/</span><span>INCIDENT RECORD</span></div>
    <div className="title-row"><div><h1>{incident.title}</h1><p>See what changed, who changed it, and what the history check shows.</p></div></div>
  </>;
  if (!snapshot) return <>{hero}<p className="empty-note">Loading the incident record…</p></>;

  const broken = snapshot.verification.brokenAt, anchor = snapshot.anchoredCheckpoint, ok = snapshot.verification.ok;
  const event = snapshot.audit.find(e => e.seq === selected);
  const recent = snapshot.audit.slice(-4);
  const actor = (a: string) => (a === 'NEMOTRON' ? 'NEMOTRON' : a.slice(0, 8));
  return <>
    {hero}
    <section className="chain-picture" ref={chain}>
      <div className="section-head"><div><span className="eyebrow">INCIDENT HISTORY</span><h2>A history you can inspect.</h2></div>
        <span className={`badge ${ok ? 'ok' : 'critical'}`}>{ok ? 'CHAIN INTERNALLY CONSISTENT' : `HISTORY CHECK FAILED · #${broken}`}</span></div>
      {recent.length ? (
        <div className="chain-flow">
          {recent.map((e, j) => <span key={e.seq} style={{ display: 'contents' }}>
            {j > 0 && <span className={`chain-link ${broken === e.seq ? 'severed' : ''}`}><i /></span>}
            <button className={`chain-block ${e.seq === selected ? 'chosen' : ''} ${broken === e.seq ? 'corrupt' : ''}`} onClick={() => setSelected(e.seq)} aria-label={`Record ${e.seq}: ${eventLabel(e.action)}`}>
              <span className="eyebrow">RECORD</span><strong>#{e.seq}</strong>
              <small>{broken === e.seq ? 'HASH MISMATCH' : 'LINKED TO THE LAST RECORD'}</small>
              <span className="hash-bars" aria-hidden>{bars(e.eventHash).map((h, i) => <i key={i} style={{ height: h }} />)}</span>
            </button>
          </span>)}
          <span className="chain-link external"><i /></span>
          <span className="anchor-end">
            <svg viewBox="0 0 24 24" width="25" height="25" aria-hidden><path d="M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6zM8 12l3 3 5-6" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
            <span>External<br />checkpoint</span>
            <small>{anchor ? <>#{anchor.seq}<br />{anchor.independentlyVerified ? 'INDEPENDENTLY VERIFIED' : 'NOT CONFIRMED INDEPENDENT'}</> : <>NONE CONFIRMED<br />NOT INDEPENDENTLY ANCHORED</>}</small>
          </span>
        </div>
      ) : <p className="empty-note">No events recorded for this incident yet.</p>}
      <p className="section-note">Hashes are computed in the module. Select a record to inspect it. A consistent chain alone does not prove an independent checkpoint.</p>
    </section>
    <div className="action-row" style={{ marginTop: 25 }}>
      <button className="btn" onClick={() => void refresh()}>Refresh record</button>
      <button className="btn" onClick={() => downloadSnapshot(snapshot)}>Download JSON</button>
      <button className="btn primary" disabled={!pdfReady || exporting} title={!pdfReady ? 'PDF renderer not connected' : undefined}
        onClick={async () => { setExporting(true); await run(() => exportPdf(snapshot, token)); setExporting(false); }}>{exporting ? 'Exporting PDF…' : 'Export PDF'}</button>
    </div>
    <p className="section-note" style={{ marginTop: 13 }}>
      SNAPSHOT {formatMicros(snapshot.generatedAt)} · {snapshot.audit.length} INCIDENT EVENTS · {snapshot.verification.checked} RECORDS CHECKED ACROSS THE DATABASE{!pdfReady && ' · PDF RENDERER NOT CONNECTED'}
    </p>
    <div className="two-col">
      <section>
        <div className="section-head"><h2>Incident history</h2><span className="eyebrow">{snapshot.audit.length} RECORDS</span></div>
        {!snapshot.audit.length && <p className="empty-note">No incident events recorded.</p>}
        {[...snapshot.audit].reverse().map(e => (
          <button key={e.seq} ref={e.seq === broken ? focused : undefined} onClick={() => setSelected(e.seq)} aria-pressed={selected === e.seq}
            className={`record-row ${selected === e.seq ? 'selected' : ''} ${broken && e.seq !== broken ? 'faded' : ''}`}>
            <span className="mono">#{e.seq}</span>
            <span className={broken === e.seq ? 'red' : ''} title={e.action}>{eventLabel(e.action)}</span>
            <span className="mono dim">{formatMicros(e.createdAt).slice(11, 19)}</span>
            <span className="mono" style={{ marginLeft: 'auto' }}>{actor(e.actor)}</span>
          </button>
        ))}
      </section>
      <aside>
        <div className="section-head"><h2>{selected ? `Record #${selected}` : 'Record details'}</h2>{selected && <span className={`badge ${broken === selected ? 'critical' : ''}`}>{broken === selected ? 'MISMATCH' : 'RECORDED'}</span>}</div>
        {selected ? <>
          {event ? <p className="mono dim" style={{ fontSize: 11, marginBottom: 18 }}>{event.action} · {formatMicros(event.createdAt)} · {actor(event.actor)}</p>
            : <p className="section-note">This record is outside this incident’s timeline. The history check covers the entire database.</p>}
          {me.role === 'observer' ? <p className="muted">Your observer role cannot open record details.</p>
            : detail ? <><Hash stored={detail.storedHash} recomputed={detail.recomputedHash} /><pre className="payload">{detail.payloadJson}</pre></>
            : <p className="muted">Loading record details…</p>}
        </> : <p className="muted">Select a record to inspect its stored and recomputed hashes.</p>}
        <div className="section-divider">
          <h3>History check</h3>
          <p className={`mono ${ok ? 'green' : 'red'}`} style={{ fontSize: 12, marginTop: 8 }}>{ok ? 'CHAIN INTERNALLY CONSISTENT' : `INTEGRITY BROKEN · #${broken}`}</p>
          <p className="section-note">{snapshot.verification.anchorReason}</p>
        </div>
        <div className="section-divider">
          <h3>External checkpoint</h3>
          {anchor ? <>
            <p className="mono" style={{ fontSize: 11, marginTop: 8 }}>#{anchor.seq} · {anchor.independentlyVerified ? 'INDEPENDENTLY VERIFIED' : 'NOT CONFIRMED INDEPENDENT'}</p>
            <p className="hash" style={{ marginTop: 8 }}>{anchor.headHash}</p>
            <p className="section-note">{formatMicros(anchor.at)}</p>
          </> : <p className="section-note">No external checkpoint confirmed. This record is not independently anchored.</p>}
        </div>
        <div className="section-divider">
          <h3>Current database head · #{snapshot.auditHead.seq}</h3>
          <p className="hash" style={{ marginTop: 8 }}>{snapshot.auditHead.hash}</p>
          <p className="section-note">The latest hash in the database. It is separate from any checkpoint stored outside the database and is not anchored by itself.</p>
        </div>
      </aside>
    </div>
  </>;
}
