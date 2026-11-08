import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import type { TeamMember } from '../module_bindings/types';
import { IncidentList } from '../components/IncidentList';
import { NewIncidentForm } from '../components/IncidentForms';
import { CommandView, type Tab } from '../components/CommandView';
import { Drawer, TeamPanel, ChatPanel } from '../components/Panels';
import { Modal } from '../components/Modal';
import { Investigate } from './Investigate';
import { RecordView } from './Record';
import { useChainVerification } from '../lib/useChainVerification';
import { agentStateFor } from '../lib/agentState';
import { displayValue } from '../lib/copy';
import { enter, spring } from '../lib/motion';
import { createdIncident, type IncidentInput, type PendingIncident } from '../lib/incidentSelection';
import { ThemeToggle } from '../components/ThemeToggle';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
type View = 'command' | 'investigate' | 'record';

function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(id); }, []);
  return <span className="mono">{now.toISOString().slice(11, 19)}Z</span>;
}

// Integrity states mirror the previous chrome exactly: offline / unavailable / checking / broken /
// anchor mismatch / verified, with anchoring reported separately from internal chain consistency.
function useIntegrity(linkUp: boolean) {
  const { result, error, anchor } = useChainVerification();
  const anchorMismatch = linkUp && !error && anchor?.anchorOk === false;
  const broken = !!(linkUp && !error && result && (!result.ok || anchorMismatch));
  const verified = !!(linkUp && !error && result?.ok && !anchorMismatch);
  const label = !linkUp ? '○ History check offline' : error ? '○ History check unavailable' : !result ? '○ Checking history…'
    : broken ? (anchorMismatch ? '▲ Checkpoint mismatch' : '▲ History needs review') : `✓ History check passed · ${result.checked.toString()} records`;
  const anchorNote = !verified ? '' : anchor?.anchorOk === true ? `Anchored #${anchor.lastAnchorSeq?.toString()}` : anchor?.status === 'local' ? 'Local checkpoint only'
    : anchor?.status === 'unavailable' ? 'Checkpoint unavailable' : 'Not independently anchored';
  return { result, error, anchor, anchorMismatch, broken, verified, label, anchorNote };
}

export function Command({ me, team }: { me: TeamMember; team: readonly TeamMember[] }) {
  const { isActive } = useSpacetimeDB();
  const [incidents] = useTable(tables.incidents);
  const [agents] = useTable(tables.agentStatus);
  const [runs] = useTable(tables.investigationRuns);
  const [selectedId, setSelectedId] = useState<bigint | undefined>();
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<View>('command');
  const [tab, setTab] = useState<Tab>('overview');
  const [drawer, setDrawer] = useState<'team' | 'chat' | null>(null);
  const [focusSeq, setFocusSeq] = useState<string>();
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const pendingCreate = useRef<PendingIncident>();
  const [submittedCreate, setSubmittedCreate] = useState<PendingIncident>();
  const nav = useRef<HTMLDivElement>(null), indicator = useRef<HTMLSpanElement>(null), band = useRef<HTMLDivElement>(null);
  const canWrite = me.role === 'commander' || me.role === 'responder';
  const integrity = useIntegrity(isActive);
  const selected = incidents.find(i => i.id === selectedId);
  const [messages] = useTable(tables.messages.where(r => r.incidentId.eq(selectedId ?? 0n)));

  // After filing, jump to the incident this user just created.
  useEffect(() => {
    if (!submittedCreate || pendingCreate.current !== submittedCreate) return;
    const created = createdIncident(incidents, submittedCreate, me.identity);
    if (!created) return;
    pendingCreate.current = undefined;
    setSubmittedCreate(undefined);
    setSelectedId(created.id);
    setView('command'); setTab('overview');
  }, [incidents, me.identity, submittedCreate]);
  // Default selection: first incident, so the workspace is never blank when data exists.
  useEffect(() => { if (selectedId === undefined && incidents.length > 0) setSelectedId(incidents[0].id); }, [incidents, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
      if ((e.key === 'n' || e.key === 'N') && canWrite) { e.preventDefault(); setCreating(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canWrite]);

  // Spring indicator under the current workspace destination.
  useLayoutEffect(() => {
    const place = () => {
      const b = nav.current?.querySelector<HTMLElement>('[aria-current=page]'), el = indicator.current;
      if (!b || !el) return;
      if (!spring(el, { x: b.offsetLeft, width: b.offsetWidth })) { el.style.transform = `translateX(${b.offsetLeft}px)`; el.style.width = `${b.offsetWidth}px`; }
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [view]);
  useEffect(() => { if (integrity.broken) enter(band.current, { opacity: [0, 1], y: [-5, 0] }, { duration: 0.3 }); }, [integrity.broken]);

  const go = useCallback((v: 'investigate' | 'record', seq?: string) => { setView(v); setFocusSeq(seq); }, []);
  const clearPendingCreate = () => { pendingCreate.current = undefined; setSubmittedCreate(undefined); };
  const select = (id: bigint) => { clearPendingCreate(); setSelectedId(id); setTab('overview'); setFocusSeq(undefined); };
  const onCreateStart = (input: IncidentInput) => {
    const pending = { input, existingIds: new Set(incidents.map(i => i.id)) };
    pendingCreate.current = pending;
    return (ok: boolean) => {
      if (pendingCreate.current !== pending) return;
      if (ok) setSubmittedCreate(pending);
      else clearPendingCreate();
    };
  };
  const agent = agentStateFor(selected?.id, agents, runs);
  const online = team.filter(m => m.online && !m.revoked).length;
  const initials = me.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
  const chatKey = selected?.id.toString() ?? '';
  const brokenSeq = integrity.result?.brokenAt?.toString();

  return (
    <div className="bb">
      <header className="masthead">
        <span className="wordmark" aria-label="BLACKBOX">BLACKBOX<span className="brand-square" /></span>
        <span className="workspace">YOUR INCIDENT RESPONSE WORKSPACE</span>
        <div className="mast-actions">
          <button className={`integrity ${integrity.broken ? 'is-broken' : integrity.verified ? '' : 'is-neutral'}`} data-testid="chain-status"
            title={integrity.error || 'Internal hash-chain consistency only. Independent anchoring requires a separately hosted checkpoint store.'}
            onClick={() => selected && go('record', brokenSeq)}>
            {integrity.label}{integrity.anchorNote && <small> · {integrity.anchorNote}</small>}
          </button>
          <button className="team-trigger" onClick={() => setDrawer('team')}>◉ <span>{online}</span> signed in · Team</button>
          <ThemeToggle />
          <span className="identity">{initials} <span>{me.displayName}<small>{displayValue(me.role)}</small></span></span>
        </div>
      </header>
      <div className="app">
        <IncidentList incidents={incidents} selectedId={selectedId} onSelect={select} onNew={() => setCreating(true)} canCreate={canWrite}
          foot={<>
            <span className="small-dot" style={{ background: isActive ? undefined : 'var(--red)' }} /> {isActive ? 'LIVE · CONNECTED' : 'CONNECTION LOST'} · <UtcClock />
            <small>{isActive ? 'Updates from your team arrive as they happen.' : 'Reconnecting. Changes can’t be saved until the link is back.'}</small>
            <small className="mono" data-testid="agent-status-rail" style={{ color: agent.tone.color, fontSize: 10, marginTop: 12 }}>{agent.tone.glyph} {agent.label}</small>
          </>} />
        <div className="workspace-main">
          <nav className="primary-nav" aria-label="Workspace">
            <div ref={nav}>
              {(['command', 'investigate', 'record'] as const).map(v => (
                <button key={v} data-view={v} aria-current={view === v ? 'page' : undefined} onClick={() => { setView(v); setFocusSeq(undefined); }}>
                  {v === 'command' ? 'Command' : v === 'investigate' ? 'Investigate' : 'Incident record'}
                </button>
              ))}
              <span className="nav-indicator" ref={indicator} aria-hidden />
            </div>
            <button className="chat-trigger" onClick={() => setDrawer('chat')} disabled={!selected}>↗ Team chat <span className="counter" aria-label={`${messages.length} messages`}>{messages.length}</span></button>
          </nav>
          <div id="alert-band" ref={band}>
            {integrity.broken && (
              <div className="integrity-banner" role="alert" data-testid="integrity-band">
                <span aria-hidden>▲</span>
                <div>
                  <strong>{integrity.anchorMismatch ? `THE DATABASE DOESN’T MATCH ITS EXTERNAL CHECKPOINT #${integrity.anchor?.lastAnchorSeq?.toString()}` : `INCIDENT HISTORY MAY HAVE CHANGED · RECORD #${brokenSeq ?? '?'}`}</strong>
                  <p>{integrity.anchorMismatch ? integrity.anchor?.reason : integrity.result?.reason} · {integrity.result?.checked.toString()} records checked · {integrity.anchor?.anchorOk === true ? 'matches the independent checkpoint' : integrity.anchorMismatch ? 'external checkpoint history disagrees' : 'internal check · no independent checkpoint confirmed'}</p>
                </div>
                {selected && <button onClick={() => go('record', brokenSeq)}>Review {brokenSeq ? `record #${brokenSeq}` : 'the record'} →</button>}
              </div>
            )}
          </div>
          <main id="main">
            {!selected ? (
              <div className="empty-workspace"><h1>{incidents.length ? 'Select an incident.' : 'No incidents yet.'}</h1>
                <p className="section-note">{incidents.length ? 'Choose one from the list to see its picture and next step.' : canWrite ? 'Create the first incident with the + button or press N.' : 'A commander or responder will create the first incident.'}</p></div>
            ) : view === 'command' ? (
              <CommandView key={selected.id.toString()} incident={selected} me={me} team={team} broken={integrity.broken} go={go} tab={tab} setTab={setTab} />
            ) : view === 'investigate' ? (
              <Investigate key={selected.id.toString()} incident={selected} me={me} />
            ) : (
              <RecordView key={selected.id.toString()} incident={selected} me={me} focus={focusSeq} />
            )}
          </main>
          <footer className="page-foot"><span>BLACKBOX / COMMAND SYSTEM</span><span>A shared picture. A clear next step.</span><span>{isActive ? 'LIVE' : 'OFFLINE'} · {displayValue(me.role).toUpperCase()}</span></footer>
        </div>
      </div>
      <Drawer title="Response team" open={drawer === 'team'} onClose={() => setDrawer(null)}><TeamPanel team={team} me={me} /></Drawer>
      <Drawer title="Team chat" open={drawer === 'chat' && !!selected} onClose={() => setDrawer(null)}>
        {selected && <ChatPanel key={chatKey} incident={selected} me={me} team={team} draft={chatDrafts[chatKey] ?? ''} setDraft={v => setChatDrafts(d => ({ ...d, [chatKey]: v }))} />}
      </Drawer>
      <Modal open={creating} onClose={() => setCreating(false)} title="New incident" intro="Tell your team what happened and which systems need attention.">
        <NewIncidentForm onCreateStart={onCreateStart} onDone={created => { setCreating(false); if (!created) clearPendingCreate(); }} />
      </Modal>
    </div>
  );
}
