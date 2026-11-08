import { useEffect, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import { Chip } from './Chip';
import { ScopePane } from './ScopePane';
import { ClosurePane } from './ClosurePane';
import { useRun } from './Toast';
import { CONTAINMENT, CONTAINMENT_TONE, SEVERITIES, SEVERITY_TONE, STATUSES, STATUS_TONE, typeLabel } from '../lib/vocab';
import { fmtUtc, tsToDate } from '../lib/format';

const Meta = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <span className="label">{label}</span>
    <span className="truncate font-mono text-[13px] text-text-0">{children}</span>
  </div>
);

function Control({ label, value, options, onPick, disabled }: {
  label: string;
  value: string;
  options: readonly string[];
  onPick: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-[112px_1fr] items-center gap-3">
      <span className="label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(o => (
          <button key={o} type="button" aria-pressed={o === value} disabled={disabled} onClick={() => o !== value && onPick(o)} className="disabled:cursor-not-allowed disabled:opacity-60">
            {o[0].toUpperCase() + o.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function IncidentDetail({ incident, team, canWrite, me }: { incident: Incident; team: readonly TeamMember[]; canWrite: boolean; me: TeamMember }) {
  const [taskRows] = useTable(tables.tasks);
  const incidentTasks = taskRows.filter(task => task.incidentId === incident.id);
  const updateIncident = useReducer(reducers.updateIncident);
  const run = useRun();
  const [systems, setSystems] = useState(incident.systemsAffected);
  useEffect(() => { setSystems(incident.systemsAffected); }, [incident.id, incident.systemsAffected]);

  const reporter = team.find(m => m.identity.isEqual(incident.reportedBy));
  const sev = SEVERITY_TONE[incident.severity];

  const update = (patch: Partial<Pick<Incident, 'severity' | 'status' | 'containmentStatus' | 'systemsAffected'>>) =>
    run(() =>
      updateIncident({
        incidentId: incident.id,
        expectedUpdatedAt: incident.updatedAt,
        severity: patch.severity ?? incident.severity,
        status: patch.status ?? incident.status,
        containmentStatus: patch.containmentStatus ?? incident.containmentStatus,
        systemsAffected: patch.systemsAffected ?? incident.systemsAffected,
      })
    );

  return (
    <div className="flex flex-col">
      {/* "How bad, and is it contained?" answered in one band (References #3). */}
      <div className="flex flex-col gap-3 border-b border-line px-6 py-4">
        <div className="flex items-baseline gap-3">
          <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-text-2">INC-{incident.id.toString()}</span>
          <h1 className="min-w-0 truncate text-[20px] font-semibold leading-tight">{incident.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[28px] font-semibold uppercase leading-none" style={{ color: sev?.color }}>
            {sev?.glyph} {incident.severity}
          </span>
          <Chip tone={STATUS_TONE[incident.status]}>{incident.status}</Chip>
          <Chip tone={CONTAINMENT_TONE[incident.containmentStatus]}>containment · {incident.containmentStatus}</Chip>
          <Chip>{typeLabel(incident.incidentType)}</Chip>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-4 border-b border-line px-6 py-4">
        <Meta label="Detected">{fmtUtc(tsToDate(incident.detectedAt), false)}</Meta>
        <Meta label="Reported by">{reporter?.displayName ?? incident.reportedBy.toHexString().slice(0, 8)}</Meta>
        <Meta label="Filed">{fmtUtc(tsToDate(incident.createdAt))}</Meta>
        <Meta label="Last update">{fmtUtc(tsToDate(incident.updatedAt))}</Meta>
      </div>

      <div className="flex flex-col gap-3 border-b border-line px-6 py-4">
        <div className="flex items-center justify-between">
          <span className="label">Update</span>
          {!canWrite && <span className="font-mono text-[11px] text-text-2">READ-ONLY · OBSERVER</span>}
        </div>
        <Control label="Severity" value={incident.severity} options={SEVERITIES} disabled={!canWrite || incident.status==='closed'} onPick={v => update({ severity: v })} />
        <Control label="Status" value={incident.status} options={STATUSES.filter(s => s !== 'closed')} disabled={!canWrite} onPick={v => update({ status: v })} />
        <Control label="Containment" value={incident.containmentStatus} options={CONTAINMENT} disabled={!canWrite} onPick={v => update({ containmentStatus: v })} />
        <form
          className="grid grid-cols-[112px_1fr_auto] items-center gap-3"
          onSubmit={e => {
            e.preventDefault();
            update({ systemsAffected: systems });
          }}
        >
          <span className="label">Systems</span>
          <input className="field font-mono" value={systems} maxLength={500} disabled={!canWrite} onChange={e => setSystems(e.target.value)} placeholder="None recorded" />
          <button className="btn" type="submit" disabled={!canWrite || incident.status==='closed' || systems === incident.systemsAffected}>
            Save
          </button>
        </form>
      </div>

      <ClosurePane key={`closure-${incident.id}`} incident={incident} me={me} team={team} />
      <ScopePane key={incident.id.toString()} incidentId={incident.id} canWrite={canWrite} />
      <div className="flex flex-col gap-2 px-6 py-4">
        <span className="label">Tasks</span>
        {incidentTasks.length === 0 ? <p className="text-text-2">No tasks assigned.</p> : incidentTasks.map(task => (
          <div key={task.id.toString()} className="flex gap-3 border-b border-line py-2">
            <span className="font-mono text-[12px] text-text-1">#{task.id.toString()}</span>
            <span className="flex-1">{task.text}</span>
            <span className="font-mono text-[11px] uppercase text-text-1">{task.assigneeRole} · {task.createdBy}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
