import { useEffect, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import type { Timestamp } from 'spacetimedb';
import { reducers } from '../module_bindings';
import type { Incident } from '../module_bindings/types';
import { useRun } from './Toast';
import { CONTAINMENT, INCIDENT_TYPES, SEVERITIES, STATUSES } from '../lib/vocab';
import { displayValue } from '../lib/copy';
import { dateToTs, fromUtcInput, toUtcInput } from '../lib/format';
import type { IncidentInput } from '../lib/incidentSelection';

// <option value> is always the module's value; only the visible text is friendlier.
const Options = ({ values }: { values: readonly string[] }) => <>{values.map(v => <option key={v} value={v}>{displayValue(v)}</option>)}</>;

// Structured intake (createIncident). Status starts at triage on the server.
export function NewIncidentForm({ onDone, onCreateStart }: { onDone: (created: boolean) => void; onCreateStart: (input: IncidentInput) => (ok: boolean) => void }) {
  const createIncident = useReducer(reducers.createIncident);
  const run = useRun(true);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [incidentType, setIncidentType] = useState<string>('ransomware');
  const [severity, setSeverity] = useState<string>('high');
  const [detected, setDetected] = useState(() => toUtcInput(new Date()));
  const [systems, setSystems] = useState('');
  const [containment, setContainment] = useState<string>('none');
  const [busy, setBusy] = useState(false);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const input = {
      title, incidentType, severity, detectedAt: dateToTs(fromUtcInput(detected)), systemsAffected: systems, containmentStatus: containment,
    };
    const finish = onCreateStart(input);
    const ok = await run(() => createIncident(input));
    finish(ok);
    setBusy(false);
    if (ok) { setTitle(''); setSystems(''); setDetected(toUtcInput(new Date())); onDone(true); }
  };

  return (
    <form onSubmit={submit}>
      <label>Incident title<input ref={titleRef} value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="What is happening, in one line" required /></label>
      <div className="form-grid">
        <label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)}><Options values={SEVERITIES} /></select></label>
        <label>Incident type<select value={incidentType} onChange={e => setIncidentType(e.target.value)}>{INCIDENT_TYPES.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>
        <label>First detected (UTC)<input type="datetime-local" value={detected} onChange={e => setDetected(e.target.value)} required /></label>
        <label>Containment<select value={containment} onChange={e => setContainment(e.target.value)}><Options values={CONTAINMENT} /></select></label>
      </div>
      <label>Affected systems <small className="dim">comma-separated</small><input className="mono" value={systems} maxLength={500} onChange={e => setSystems(e.target.value)} placeholder="FS-PAYROLL-01, FS-PAYROLL-02" /></label>
      <p className="section-note">New incidents start as “{displayValue('triage')}”.</p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => onDone(false)}>Cancel</button>
        <button className="btn primary" type="submit" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create incident'}</button>
      </div>
    </form>
  );
}

type Draft = { base: bigint; severity: string; status: string; containmentStatus: string; systemsAffected: string };
const draftOf = (i: Incident): Draft => ({ base: i.updatedAt.microsSinceUnixEpoch, severity: i.severity, status: i.status, containmentStatus: i.containmentStatus, systemsAffected: i.systemsAffected });

// updateIncident with every field. expectedUpdatedAt is the version the form was opened on, so a
// teammate's change in the meantime is refused by the server (stale-version check) instead of overwritten.
export function UpdateIncidentForm({ incident, open, onDone }: { incident: Incident; open: boolean; onDone: () => void }) {
  const updateIncident = useReducer(reducers.updateIncident);
  const run = useRun(true);
  const [draft, setDraft] = useState<Draft>(() => draftOf(incident));
  const [opened, setOpened] = useState<Timestamp>(incident.updatedAt);
  const [busy, setBusy] = useState(false);
  // Reopening keeps an unsaved draft unless the incident changed since; while open it never resets,
  // so a concurrent change surfaces as the warning below. (The parent keys this form by incident id.)
  useEffect(() => {
    if (!open) return;
    if (draft.base !== incident.updatedAt.microsSinceUnixEpoch) { setDraft(draftOf(incident)); setOpened(incident.updatedAt); }
  }, [open]);
  const closed = incident.status === 'closed';
  const changedMeanwhile = incident.updatedAt.microsSinceUnixEpoch !== opened.microsSinceUnixEpoch;
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft(d => ({ ...d, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await run(() => updateIncident({
      incidentId: incident.id, expectedUpdatedAt: opened,
      severity: draft.severity, status: draft.status, containmentStatus: draft.containmentStatus, systemsAffected: draft.systemsAffected,
    }));
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <label>Severity<select value={draft.severity} onChange={set('severity')} disabled={closed}><Options values={SEVERITIES} /></select></label>
        <label>Status<select value={draft.status} onChange={set('status')}>
          {closed && <option value="closed" disabled>{displayValue('closed')}</option>}
          <Options values={STATUSES.filter(s => s !== 'closed')} />
        </select></label>
        <label>Containment<select value={draft.containmentStatus} onChange={set('containmentStatus')}><Options values={CONTAINMENT} /></select></label>
      </div>
      <label>Affected systems<input className="mono" value={draft.systemsAffected} maxLength={500} onChange={set('systemsAffected')} disabled={closed} placeholder="None recorded" /></label>
      {changedMeanwhile && <p className="form-warning" role="alert">This incident changed after you opened this form. Saving will be refused; cancel and reopen to see the latest version.</p>}
      {closed && <p className="section-note">This incident is closed. Severity and affected systems can’t be changed.</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => { setDraft(draftOf(incident)); setOpened(incident.updatedAt); onDone(); }}>Cancel</button>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}
