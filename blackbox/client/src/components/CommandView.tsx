import { useEffect, useRef, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import { useRecordSnapshot } from '../lib/useRecordSnapshot';
import { Modal } from './Modal';
import { UpdateIncidentForm } from './IncidentForms';
import { ScopePanel } from './ScopePanel';
import { TasksPanel } from './TasksPanel';
import { ClosurePanel, useClosure } from './ClosurePanel';
import { IncidentPicture, type NextStep } from './IncidentPicture';
import { containmentLabel, displayValue, eventLabel, incidentNumber, statusLabel } from '../lib/copy';
import { typeLabel } from '../lib/vocab';
import { fmtUtc, tsToDate } from '../lib/format';
import { formatMicros } from '../lib/recordTypes';
import { enter } from '../lib/motion';

export type Tab = 'overview' | 'tasks' | 'scope' | 'activity' | 'approvals' | 'details';
type Go = (view: 'investigate' | 'record', seq?: string) => void;

const actorName = (actor: string, team: readonly TeamMember[]) =>
  actor === 'NEMOTRON' ? 'NEMOTRON' : team.find(m => m.identity.toHexString() === actor.replace(/^0x/, ''))?.displayName ?? actor.slice(0, 8);

// Incident activity = this incident's audit events, read through the existing getRecord procedure.
// Polls only while the Activity tab is open.
function ActivityPanel({ incident, team }: { incident: Incident; team: readonly TeamMember[] }) {
  const { snapshot, updatedAt, error } = useRecordSnapshot(incident.id);
  return (
    <section className="focused-section">
      <div className="section-head"><div><span className="eyebrow">INCIDENT HISTORY</span><h2>Activity</h2></div>
        <span className={`badge ${error ? 'critical' : ''}`}>{error ? 'REFRESH FAILED · SHOWING LAST LOADED' : updatedAt ? `UPDATED ${new Date(updatedAt).toISOString().slice(11, 19)} UTC` : 'FROM THE INCIDENT RECORD'}</span></div>
      {error && !snapshot && <p className="empty-note" role="status">Couldn’t load activity: {error}</p>}
      {!snapshot ? (!error && <p className="empty-note">Loading activity…</p>) : !snapshot.audit.length ? <p className="empty-note">No activity recorded yet.</p> : (
        <div className="timeline">{[...snapshot.audit].reverse().map(e => (
          <div className="event" key={e.seq}>
            <time>{formatMicros(e.createdAt).slice(11, 16)} UTC</time>
            <p><strong title={e.action}>{eventLabel(e.action)}</strong><br />{actorName(e.actor, team)} · record #{e.seq}</p>
          </div>
        ))}</div>
      )}
    </section>
  );
}

export function CommandView({ incident, me, team, broken, go, tab, setTab }: {
  incident: Incident; me: TeamMember; team: readonly TeamMember[]; broken: boolean; go: Go; tab: Tab; setTab: (t: Tab) => void;
}) {
  const canWrite = me.role === 'commander' || me.role === 'responder';
  const [scope] = useTable(tables.scopeItems.where(r => r.incidentId.eq(incident.id)));
  const [tasks, tasksReady] = useTable(tables.tasks);
  const [taskProgress, progressReady] = useTable(tables.taskProgress);
  const completedTasks = new Set(taskProgress.filter(t => t.incidentId === incident.id && t.status === 'done').map(t => t.taskId));
  const [conflictRows] = useTable(tables.investigationConflicts);
  const [evidenceRows] = useTable(tables.investigationEvidence);
  const [runs] = useTable(tables.investigationRuns);
  const conflicts = conflictRows.filter(c => c.incidentId === incident.id).length;
  const evidence = evidenceRows.filter(e => e.incidentId === incident.id).length;
  const latestRun = runs.filter(r => r.incidentId === incident.id).sort((a, b) => (a.id > b.id ? -1 : 1))[0];
  const { pending, counted } = useClosure(incident, team);
  const [editing, setEditing] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  const reporter = team.find(m => m.identity.isEqual(incident.reportedBy));
  const closed = incident.status === 'closed';

  useEffect(() => { enter(heading.current ? Array.from(heading.current.children) : null, { opacity: [0, 1], y: [10, 0] }, { staggerBy: 0.055 }); }, [incident.id]);
  useEffect(() => { enter(document.querySelector('.command-content') , { opacity: [0.3, 1], y: [12, 0] }); }, [tab, incident.id]);

  // One next action, chosen from real state in priority order.
  let next: NextStep & { action?: () => void; label?: string; urgent?: boolean } = { title: 'Your team is responding.', copy: `Status: ${statusLabel(incident.status)}. Containment: ${containmentLabel(incident.containmentStatus).toLowerCase()}.` };
  if (closed) next = { title: 'Incident closed with two-person approval.', copy: 'The incident record stays available for review and export.', action: () => go('record'), label: 'Open incident record →' };
  else if (broken) next = { title: 'The incident history failed its check.', copy: 'A stored record no longer matches its hash. Review it before relying on the history.', action: () => go('record'), label: 'Review the record →', urgent: true };
  else if (canWrite && conflicts) next = { title: 'Two reports disagree.', copy: 'Review both reports before changing the response.', action: () => go('investigate'), label: 'Compare reports →', urgent: true };
  else if (pending) next = { title: 'Closing is waiting for a second approval.', copy: `${counted}/2 valid approvals so far.`, action: () => setTab('approvals'), label: 'Review the close request →' };
  else if (canWrite && !evidence) next = { title: 'Add the first evidence.', copy: 'Paste a log or report so the team and the investigation agent can work from it.', action: () => go('investigate'), label: 'Add evidence →' };
  else if (canWrite && !scope.length) next = { title: 'Record affected systems & data.', copy: 'Note what is affected and how certain you are.', action: () => setTab('scope'), label: 'Record systems & data →' };

  const tabs: [Tab, string, string | number][] = [
    ['overview', 'Overview', ''], ['tasks', 'Tasks', tasksReady && progressReady ? tasks.filter(t => t.incidentId === incident.id && !completedTasks.has(t.id)).length : '…'], ['scope', 'Systems & data', canWrite ? scope.length : ''],
    ['activity', 'Activity', ''], ['approvals', 'Close incident', pending && !closed ? '1 pending' : ''], ['details', 'Details', ''],
  ];
  const onTabKey = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex(([k]) => k === tab);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[n][0]);
    requestAnimationFrame(() => document.getElementById(`incident-tab-${tabs[n][0]}`)?.focus());
  };
  const updateButton = <button className="btn" onClick={() => setEditing(true)} disabled={!canWrite}>Update incident ↗</button>;
  const sevClass = incident.severity === 'critical' ? 'red' : incident.severity === 'high' ? 'amber' : 'dim';

  let body;
  if (tab === 'overview') body = <>
    {/* Observers see the systems listed on the incident (as before) but no recorded impact or evidence. */}
    <IncidentPicture incident={incident} scope={scope} canReadScope={canWrite} conflicts={canWrite ? conflicts : 0} evidence={evidence} next={next} onScope={() => setTab('scope')} />
    <section className={`next-decision ${next.urgent ? '' : 'quiet-decision'}`}>
      {next.urgent && <span className="decision-symbol" aria-hidden>!</span>}
      <div><span className="eyebrow">{next.action ? 'YOUR NEXT STEP' : 'SITUATION'}</span><h2>{next.title}</h2><p>{next.copy}</p></div>
      {next.action && <button className={`btn ${next.urgent ? 'primary' : ''}`} onClick={next.action}>{next.label}</button>}
    </section>
    {!canWrite && <p className="section-note restricted-note">Your observer role can view the incident summary and history, but not affected data or evidence.</p>}
  </>;
  else if (tab === 'tasks') body = <TasksPanel key={incident.id.toString()} incident={incident} me={me} team={team} onInvestigate={() => go('investigate')} />;
  else if (tab === 'scope') body = <ScopePanel key={incident.id.toString()} incidentId={incident.id} canWrite={canWrite} />;
  else if (tab === 'activity') body = <ActivityPanel incident={incident} team={team} />;
  else if (tab === 'approvals') body = <ClosurePanel key={`closure-${incident.id}`} incident={incident} me={me} team={team} />;
  else body = (
    <section className="focused-section">
      <div className="section-head"><div><span className="eyebrow">THE FULL PICTURE</span><h2>Incident details</h2></div>{updateButton}</div>
      <dl className="key-facts detail-facts">
        <div><dt>Severity</dt><dd className={sevClass}>▲ {displayValue(incident.severity)}</dd></div>
        <div><dt>Status</dt><dd>{statusLabel(incident.status)}</dd></div>
        <div><dt>Containment</dt><dd>{containmentLabel(incident.containmentStatus)}</dd></div>
        <div><dt>Incident type</dt><dd>{typeLabel(incident.incidentType)}</dd></div>
        <div><dt>Affected systems</dt><dd className="mono">{incident.systemsAffected || 'None recorded'}</dd></div>
        <div><dt>First detected</dt><dd className="mono">{fmtUtc(tsToDate(incident.detectedAt), false)}</dd></div>
        <div><dt>Reported by</dt><dd>{reporter?.displayName ?? incident.reportedBy.toHexString().slice(0, 8)}</dd></div>
        <div><dt>Opened</dt><dd className="mono">{fmtUtc(tsToDate(incident.createdAt))}</dd></div>
        <div><dt>Last update</dt><dd className="mono">{fmtUtc(tsToDate(incident.updatedAt))}</dd></div>
      </dl>
      {!canWrite && <p className="section-note">Observers can read the incident but can’t change it.</p>}
      <div className="agent-summary">
        <div className="eyebrow"><span>INVESTIGATION</span><span>{latestRun ? `RUN #${latestRun.id} · ${latestRun.status.toUpperCase()}` : 'NOT STARTED'}</span></div>
        <p>{!canWrite ? 'Investigation details are restricted to commanders and responders.' : latestRun?.summary ? latestRun.summary : latestRun ? 'The latest investigation has no assessment yet.' : 'No investigation yet. Add evidence to get started.'}</p>
        {canWrite && <button onClick={() => go('investigate')}>View investigation →</button>}
      </div>
    </section>
  );

  return <>
    <div className="command-heading" ref={heading}>
      <div>
        <div className="kicker"><span>{incidentNumber(incident.id)}</span><span className="slash">/</span><span>COMMAND</span></div>
        <h1>{incident.title}</h1>
        <div className="command-status">
          <span className={sevClass}>▲ {displayValue(incident.severity).toUpperCase()}</span><span className="status-divider" />
          <span>{containmentLabel(incident.containmentStatus)}</span><span className="status-divider" />
          <span>{statusLabel(incident.status)}</span>
        </div>
      </div>
      {updateButton}
    </div>
    <nav className="subnav command-tabs" role="tablist" aria-label="Incident sections" onKeyDown={onTabKey}>
      {tabs.map(([key, label, count]) => (
        <button key={key} role="tab" id={`incident-tab-${key}`} aria-controls="incident-panel" tabIndex={tab === key ? 0 : -1} aria-selected={tab === key}
          className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
          {label} {count !== '' && <span className={`count ${key === 'approvals' ? 'amber' : ''}`}>{count}</span>}
        </button>
      ))}
    </nav>
    <div className="command-content" id="incident-panel" role="tabpanel" aria-labelledby={`incident-tab-${tab}`}>{body}</div>
    <Modal open={editing} onClose={() => setEditing(false)} title="Update incident" intro="Keep the team’s shared picture up to date. Changes are saved to the incident for everyone.">
      <UpdateIncidentForm key={incident.id.toString()} incident={incident} open={editing} onDone={() => setEditing(false)} />
    </Modal>
  </>;
}
