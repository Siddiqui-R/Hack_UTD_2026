import { useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import type { Identity } from 'spacetimedb';
import { reducers, tables } from '../module_bindings';
import type { Incident, Task, TaskState, TeamMember } from '../module_bindings/types';
import { useRun } from './Toast';
import { Modal } from './Modal';
import { displayValue } from '../lib/copy';
import { fmtUtc, tsToDate } from '../lib/format';

// Task progress is recorded by people; "done" means a person recorded completion, not that a system was checked.
// The server enforces every rule below; the UI only offers the actions the server would accept.
const STATUS: Record<string, { label: string; glyph: string; badge: string }> = {
  open: { label: 'Open', glyph: '○', badge: '' },
  in_progress: { label: 'In progress', glyph: '◐', badge: '' },
  blocked: { label: 'Blocked', glyph: '⊘', badge: 'critical' },
  done: { label: 'Done', glyph: '●', badge: 'ok' },
};
type NoteTarget = { taskId: bigint; text: string; to: 'blocked' | 'done' | 'open'; version: bigint };
type AssignTarget = { taskId: bigint; text: string; current?: Identity; version: bigint };

const NOTE_COPY = {
  blocked: { title: 'Mark task blocked', label: 'What is blocking it?', submit: 'Mark blocked' },
  done: { title: 'Mark task done', label: 'What was done?', submit: 'Mark done' },
  open: { title: 'Reopen task', label: 'Why reopen it?', submit: 'Reopen task' },
} as const;

function NoteForm({ target, liveVersion, draft, setDraft, onDone }: {
  target: NoteTarget; liveVersion: bigint; draft: string; setDraft: (v: string) => void; onDone: (saved: boolean) => void;
}) {
  const update = useReducer(reducers.updateTaskStatus), run = useRun(true);
  const [pending, setPending] = useState(false);
  const copy = NOTE_COPY[target.to], stale = liveVersion !== target.version;
  return (
    <form onSubmit={async e => {
      e.preventDefault();
      setPending(true);
      const ok = await run(() => update({ taskId: target.taskId, status: target.to, note: draft, expectedVersion: target.version }));
      setPending(false);
      if (ok) onDone(true);
    }}>
      <p className="section-note">{target.text}</p>
      {stale && <p className="section-note red" role="alert">Someone changed this task after you opened this. Close it, review the latest status, then try again. Your note is kept.</p>}
      <label>{copy.label}<textarea value={draft} onChange={e => setDraft(e.target.value)} minLength={3} maxLength={1000} rows={3} required /></label>
      {target.to === 'done' && <p className="section-note">This records that you completed the work. BLACKBOX does not check the system itself.</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => onDone(false)}>Cancel</button>
        <button className="btn primary" type="submit" disabled={pending || stale}>{pending ? 'Saving…' : copy.submit}</button>
      </div>
    </form>
  );
}

function AssignForm({ target, liveVersion, team, onDone }: { target: AssignTarget; liveVersion: bigint; team: readonly TeamMember[]; onDone: () => void }) {
  const assign = useReducer(reducers.assignTask), run = useRun(true);
  const eligible = team.filter(m => (m.role === 'commander' || m.role === 'responder') && !m.revoked);
  const [choice, setChoice] = useState(target.current?.toHexString() ?? '');
  const [pending, setPending] = useState(false);
  const stale = liveVersion !== target.version;
  const currentListed = !target.current || eligible.some(m => m.identity.isEqual(target.current!));
  return (
    <form onSubmit={async e => {
      e.preventDefault();
      setPending(true);
      const assignee = eligible.find(m => m.identity.toHexString() === choice)?.identity;
      const ok = await run(() => assign({ taskId: target.taskId, assignee, expectedVersion: target.version }));
      setPending(false);
      if (ok) onDone();
    }}>
      <p className="section-note">{target.text}</p>
      {stale && <p className="section-note red" role="alert">Someone changed this task after you opened this. Close it and review the latest assignee before changing it.</p>}
      {!currentListed && <p className="section-note">The current assignee can no longer be assigned work. Their earlier work stays attributed to them.</p>}
      <label>Assign to<select value={choice} onChange={e => setChoice(e.target.value)}>
        <option value="">Unassigned</option>
        {eligible.map(m => <option key={m.identity.toHexString()} value={m.identity.toHexString()}>{m.displayName} · {displayValue(m.role)}{m.online ? '' : ' · offline'}</option>)}
      </select></label>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" type="submit" disabled={pending || stale}>{pending ? 'Saving…' : 'Save assignment'}</button>
      </div>
    </form>
  );
}

// Stays mounted inside its dialog, so a half-written task survives closing; only a successful save clears it.
function CreateForm({ incidentId, onDone }: { incidentId: bigint; onDone: () => void }) {
  const create = useReducer(reducers.createHumanTask), run = useRun(true);
  const [text, setText] = useState(''), [role, setRole] = useState('responder'), [pending, setPending] = useState(false);
  return (
    <form onSubmit={async e => {
      e.preventDefault();
      setPending(true);
      const ok = await run(() => create({ incidentId, text, assigneeRole: role }));
      setPending(false);
      if (ok) { setText(''); onDone(); }
    }}>
      <label>Task<textarea value={text} onChange={e => setText(e.target.value)} maxLength={1000} rows={3} required placeholder="e.g. Isolate payroll-07 from the network" /></label>
      <label>Intended for<select value={role} onChange={e => setRole(e.target.value)}>
        <option value="responder">Responder</option><option value="commander">Commander</option>
      </select></label>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Add task'}</button>
      </div>
    </form>
  );
}

export function TasksPanel({ incident, me, team, onInvestigate }: { incident: Incident; me: TeamMember; team: readonly TeamMember[]; onInvestigate: () => void }) {
  const [taskRows, tasksReady] = useTable(tables.tasks);
  const [stateRows] = useTable(tables.taskProgress);
  const { isActive } = useSpacetimeDB();
  const claim = useReducer(reducers.claimTask), setStatus = useReducer(reducers.updateTaskStatus), run = useRun(true);
  const [creating, setCreating] = useState(false);
  const [noting, setNoting] = useState<NoteTarget | null>(null);
  const [assigning, setAssigning] = useState<AssignTarget | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const canWrite = me.role === 'commander' || me.role === 'responder', isCommander = me.role === 'commander';
  const closed = incident.status === 'closed', editable = canWrite && !closed && isActive;
  const tasks = taskRows.filter(t => t.incidentId === incident.id).sort((a, b) => (a.id < b.id ? -1 : 1));
  const states = new Map(stateRows.filter(s => s.incidentId === incident.id).map(s => [s.taskId.toString(), s]));
  const stateOf = (t: Task): TaskState | undefined => states.get(t.id.toString());
  const versionOf = (id: bigint) => states.get(id.toString())?.version ?? 0n;
  const done = tasks.filter(t => stateOf(t)?.status === 'done').length;
  const person = (id?: Identity) => {
    if (!id) return undefined;
    const m = team.find(x => x.identity.isEqual(id));
    return m ? `${m.displayName}${m.revoked ? ' (access removed)' : ''}` : id.toHexString().slice(0, 8);
  };
  const creator = (t: Task) => t.createdBy === 'NEMOTRON' ? 'NEMOTRON' : team.find(m => m.identity.toHexString() === t.createdBy.replace(/^0x/, ''))?.displayName ?? t.createdBy.slice(0, 8);
  const quick = async (t: Task, fn: () => Promise<unknown>) => { setBusy(t.id.toString()); await run(fn); setBusy(''); };
  const draftKey = (n: NoteTarget) => `${n.taskId}:${n.to}`;

  const actions = (t: Task, s: TaskState | undefined) => {
    const status = s?.status ?? 'open', version = s?.version ?? 0n, assignee = s?.assignee;
    const mine = !!assignee && assignee.isEqual(me.identity), manage = mine || isCommander;
    const pending = busy === t.id.toString();
    const note = (to: NoteTarget['to']) => () => setNoting({ taskId: t.id, text: t.text, to, version });
    const list: React.ReactNode[] = [];
    if (status !== 'done' && !assignee) list.push(<button key="claim" className="btn" disabled={pending} onClick={() => quick(t, () => claim({ taskId: t.id, expectedVersion: version }))}>Claim</button>);
    if (manage && status === 'open') list.push(<button key="start" className="btn" disabled={pending} onClick={() => quick(t, () => setStatus({ taskId: t.id, status: 'in_progress', note: '', expectedVersion: version }))}>Start</button>);
    if (manage && status === 'blocked') list.push(<button key="resume" className="btn" disabled={pending} onClick={() => quick(t, () => setStatus({ taskId: t.id, status: 'in_progress', note: '', expectedVersion: version }))}>Resume</button>);
    if (manage && (status === 'open' || status === 'in_progress')) list.push(<button key="block" className="btn" onClick={note('blocked')}>Mark blocked…</button>);
    if (manage && status !== 'done') list.push(<button key="done" className="btn" onClick={note('done')}>Mark done…</button>);
    if (manage && status === 'done') list.push(<button key="reopen" className="btn" onClick={note('open')}>Reopen…</button>);
    if (isCommander && status !== 'done') list.push(<button key="assign" className="btn" onClick={() => setAssigning({ taskId: t.id, text: t.text, current: assignee, version })}>Assign…</button>);
    return list;
  };

  return (
    <div className="focused-section">
      <div className="section-head">
        <div>
          <h2>Response tasks</h2>
          <p className="section-note">Tasks from the investigation agent are labelled NEMOTRON. People claim, update and complete them here; the work itself happens in your own tools.</p>
        </div>
        <div className="action-row">
          {tasks.length > 0 && <span className="badge">{done} OF {tasks.length} DONE</span>}
          {editable && <button className="btn" onClick={() => setCreating(true)}>+ New task</button>}
          <button className="btn" onClick={onInvestigate}>Investigate ↗</button>
        </div>
      </div>
      {closed && <p className="section-note restricted-note">This incident is closed. Its tasks are read-only.</p>}
      {!closed && canWrite && !isActive && <p className="section-note restricted-note" role="status">Connection lost. Task changes are paused until it returns.</p>}
      {!canWrite && <p className="section-note restricted-note">Observers can follow task progress but can’t change it. Notes are visible to commanders and responders.</p>}
      {!tasksReady ? <p className="empty-note">Loading tasks…</p> : tasks.length ? tasks.map(t => {
        const s = stateOf(t), status = s?.status ?? 'open', look = STATUS[status] ?? { label: status, glyph: '?', badge: '' };
        const who = person(s?.assignee), list = editable ? actions(t, s) : [];
        return (
          <div className={`task task-${status}`} key={t.id.toString()}>
            <span className="task-marker" aria-hidden />
            <div className="task-content">
              <h3>{t.text}</h3>
              <p><span className={`badge ${look.badge}`}>{look.glyph} {look.label.toUpperCase()}</span> · For {displayValue(t.assigneeRole)} · {who ? `Assigned to ${who}` : 'Unassigned'} · Added by {creator(t)}</p>
              {status === 'done' && s?.completedBy && <p>Done by {person(s.completedBy)}{s.completedAt ? ` · ${fmtUtc(tsToDate(s.completedAt))}` : ''}</p>}
              {s?.note && (status === 'blocked' || status === 'done' || status === 'open') && <p>{status === 'blocked' ? 'Blocked: ' : status === 'done' ? 'Completion note: ' : 'Note: '}{s.note}</p>}
              {list.length > 0 && <div className="action-row" style={{ marginTop: 10 }}>{list}</div>}
            </div>
            <span className="eyebrow">#{t.id.toString()}</span>
          </div>
        );
      }) : <p className="empty-note">No tasks yet. {editable ? 'Add one with “+ New task”, or run an investigation to get suggestions.' : 'An investigation can suggest next steps.'}</p>}

      <Modal open={creating} onClose={() => setCreating(false)} title="New response task" intro="Write one concrete step for a person to carry out. The team sees it immediately.">
        <CreateForm incidentId={incident.id} onDone={() => setCreating(false)} />
      </Modal>
      <Modal open={!!noting} onClose={() => setNoting(null)} title={noting ? NOTE_COPY[noting.to].title : 'Update task'} intro="Notes are kept in the incident history and visible to commanders and responders.">
        {noting && <NoteForm key={draftKey(noting)} target={noting} liveVersion={versionOf(noting.taskId)} draft={drafts[draftKey(noting)] ?? ''}
          setDraft={v => setDrafts(d => ({ ...d, [draftKey(noting)]: v }))}
          onDone={saved => { if (saved) setDrafts(d => { const n = { ...d }; delete n[draftKey(noting)]; return n; }); setNoting(null); }} />}
      </Modal>
      <Modal open={!!assigning} onClose={() => setAssigning(null)} title="Assign task" intro="Assign a commander or responder. They don’t need to be online.">
        {assigning && <AssignForm key={`${assigning.taskId}:${assigning.version}`} target={assigning} liveVersion={versionOf(assigning.taskId)} team={team} onDone={() => setAssigning(null)} />}
      </Modal>
    </div>
  );
}
