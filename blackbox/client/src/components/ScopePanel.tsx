import { useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { tables, reducers } from '../module_bindings';
import type { ScopeItem } from '../module_bindings/types';
import { useRun } from './Toast';
import { Modal } from './Modal';
import { displayValue } from '../lib/copy';

export const SCOPE_STATES = ['unknown', 'compromised', 'encrypted', 'exfiltrated', 'unaffected'] as const;
export const SCOPE_CONFIDENCE = ['unconfirmed', 'likely', 'confirmed'] as const;
const Options = ({ values }: { values: readonly string[] }) => <>{values.map(v => <option key={v} value={v}>{displayValue(v)}</option>)}</>;

// Add form (addScopeItem). Its draft survives closing the dialog; only a successful save clears it.
function AddScope({ incidentId, onDone }: { incidentId: bigint; onDone: () => void }) {
  const add = useReducer(reducers.addScopeItem), run = useRun(true);
  const [asset, setAsset] = useState(''), [dataType, setDataType] = useState(''), [state, setState] = useState('unknown'),
    [confidence, setConfidence] = useState('unconfirmed'), [records, setRecords] = useState('0'), [note, setNote] = useState('');
  return (
    <form onSubmit={async e => {
      e.preventDefault();
      if (await run(async () => { await add({ incidentId, asset, dataType, state, confidence, records: BigInt(records), note }); })) {
        setAsset(''); setDataType(''); setNote(''); setRecords('0'); onDone();
      }
    }}>
      <label>System or asset<input className="mono" value={asset} onChange={e => setAsset(e.target.value)} maxLength={160} required /></label>
      <label>Data type<input value={dataType} onChange={e => setDataType(e.target.value)} maxLength={160} required /></label>
      <div className="form-grid">
        <label>What happened?<select value={state} onChange={e => setState(e.target.value)}><Options values={SCOPE_STATES} /></select></label>
        <label>How certain?<select value={confidence} onChange={e => setConfidence(e.target.value)}><Options values={SCOPE_CONFIDENCE} /></select></label>
        <label>Affected records<input type="number" min="0" step="1" className="mono" value={records} onChange={e => setRecords(e.target.value)} required /></label>
      </div>
      <label>Note<input value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></label>
      <div className="form-actions"><button type="button" className="btn" onClick={onDone}>Cancel</button><button className="btn primary" type="submit">Record system or data</button></div>
    </form>
  );
}

// The module supports updating impact and certainty only (updateScopeItem; records pass through unchanged).
function EditScope({ item, onDone }: { item: ScopeItem; onDone: () => void }) {
  const update = useReducer(reducers.updateScopeItem), run = useRun(true);
  const [state, setState] = useState(item.state), [confidence, setConfidence] = useState(item.confidence);
  return (
    <form onSubmit={async e => {
      e.preventDefault();
      if (await run(() => update({ scopeId: item.id, state, confidence, records: item.records, expectedUpdatedAt: item.updatedAt }))) onDone();
    }}>
      <dl className="key-facts detail-facts">
        <div><dt>System or asset</dt><dd className="mono">{item.asset}</dd></div>
        <div><dt>Data type</dt><dd>{item.dataType}</dd></div>
        <div><dt>Affected records</dt><dd className="mono">{item.records.toLocaleString()}</dd></div>
      </dl>
      <div className="form-grid">
        <label>What happened?<select value={state} onChange={e => setState(e.target.value)}><Options values={SCOPE_STATES} /></select></label>
        <label>How certain?<select value={confidence} onChange={e => setConfidence(e.target.value)}><Options values={SCOPE_CONFIDENCE} /></select></label>
      </div>
      {item.note && <p className="section-note">Note: {item.note}</p>}
      <div className="form-actions"><button type="button" className="btn" onClick={onDone}>Cancel</button><button className="btn primary" type="submit">Save changes</button></div>
    </form>
  );
}

export function ScopePanel({ incidentId, canWrite }: { incidentId: bigint; canWrite: boolean }) {
  const [items] = useTable(tables.scopeItems.where(r => r.incidentId.eq(incidentId)));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ScopeItem | null>(null);
  if (!canWrite) return <p className="empty-note">Your observer role cannot view affected systems and data.</p>;
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
  return (
    <div className="focused-section">
      <div className="section-head">
        <div><h2>Affected systems &amp; data</h2><p className="section-note">Record what is affected and how certain you are. These are separate decisions.</p></div>
        <button className="btn" onClick={() => setAdding(true)}>+ Add system or data</button>
      </div>
      {sorted.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>SYSTEM / DATA</th><th>IMPACT</th><th>CERTAINTY</th><th>AFFECTED RECORDS</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{sorted.map(s => (
              <tr key={s.id.toString()}>
                <td><span className="mono">{s.asset}</span><small className="dim" style={{ display: 'block' }}>{s.dataType}</small>{s.note && <small className="dim" style={{ display: 'block' }}>{s.note}</small>}</td>
                <td><span className={s.state === 'encrypted' || s.state === 'exfiltrated' || s.state === 'compromised' ? 'red' : 'dim'}>{displayValue(s.state)}</span></td>
                <td>{displayValue(s.confidence)}</td>
                <td className="mono">{s.records.toLocaleString()}</td>
                <td><button onClick={() => setEditing(s)} aria-label={`Edit ${s.asset}`}>Edit ↗</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!sorted.length && <p className="empty-note">Nothing has been recorded yet. That does not mean there is no impact.</p>}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a system or data" intro="Record the impact and how certain you are. These are separate decisions.">
        <AddScope incidentId={incidentId} onDone={() => setAdding(false)} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Update affected system or data" intro="Change the recorded impact or how certain you are.">
        {editing && <EditScope key={editing.id.toString()} item={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
