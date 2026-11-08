import { useEffect, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { useRun } from './Toast';
import { CONTAINMENT, INCIDENT_TYPES, SEVERITIES } from '../lib/vocab';
import { dateToTs, fromUtcInput, toUtcInput } from '../lib/format';

function Seg<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1">
    <span className="label">
      {label} {hint && <span className="font-mono font-normal normal-case tracking-normal text-text-2">{hint}</span>}
    </span>
    {children}
  </div>
);

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// Structured intake reflecting common incident-record fields: type, severity, detection time,
// affected systems, containment. Status starts at triage server-side.
export function IncidentForm({ onDone }: { onDone: (created: boolean) => void }) {
  const createIncident = useReducer(reducers.createIncident);
  const run = useRun();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [incidentType, setIncidentType] = useState<string>('ransomware');
  const [severity, setSeverity] = useState<string>('high');
  const [detected, setDetected] = useState(() => toUtcInput(new Date()));
  const [systems, setSystems] = useState('');
  const [containment, setContainment] = useState<string>('none');
  const [busy, setBusy] = useState(false);

  useEffect(() => titleRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const ok = await run(() =>
      createIncident({
        title,
        incidentType,
        severity,
        detectedAt: dateToTs(fromUtcInput(detected)),
        systemsAffected: systems,
        containmentStatus: containment,
      })
    );
    setBusy(false);
    if (ok) onDone(true);
  };

  return (
    <form onSubmit={submit} className="flex max-w-[720px] flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-medium">File incident</h2>
        <span className="font-mono text-[12px] text-text-2">STATUS ON CREATE · TRIAGE</span>
      </div>

      <Field label="Title" hint="what is happening, in one line">
        <input ref={titleRef} className="field" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="Ransomware on payroll file servers" required />
      </Field>

      <Field label="Type">
        <Seg label="Type" value={incidentType} options={INCIDENT_TYPES} onChange={setIncidentType} />
      </Field>

      <Field label="Severity">
        <Seg label="Severity" value={severity} options={SEVERITIES.map(s => [s, cap(s)] as const)} onChange={setSeverity} />
      </Field>

      <div className="grid grid-cols-[220px_1fr] gap-4">
        <Field label="Detected" hint="UTC">
          <input type="datetime-local" className="field font-mono [color-scheme:dark]" value={detected} onChange={e => setDetected(e.target.value)} required />
        </Field>
        <Field label="Containment">
          <Seg label="Containment" value={containment} options={CONTAINMENT.map(s => [s, cap(s)] as const)} onChange={setContainment} />
        </Field>
      </div>

      <Field label="Systems affected" hint="comma-separated">
        <input className="field font-mono" value={systems} maxLength={500} onChange={e => setSystems(e.target.value)} placeholder="FS-PAYROLL-01, FS-PAYROLL-02, AD-DC-03" />
      </Field>

      <div className="flex gap-2 pt-2">
        <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>
          File incident <span className="kbd">⏎</span>
        </button>
        <button type="button" className="btn" onClick={() => onDone(false)}>
          Cancel <span className="kbd">ESC</span>
        </button>
      </div>
    </form>
  );
}
