import type { ReactNode } from 'react';
import type { Incident } from '../module_bindings/types';
import { containmentLabel, displayValue, incidentNumber } from '../lib/copy';
import { fmtUtc, tsToDate } from '../lib/format';

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const GLYPH: Record<string, string> = { critical: '▲', high: '◆', medium: '◆', low: '○' };

// Open incidents first, then by severity, then newest.
function order(a: Incident, b: Incident) {
  const closed = (i: Incident) => (i.status === 'closed' ? 1 : 0);
  return closed(a) - closed(b) || (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || (a.id > b.id ? -1 : 1);
}

export function IncidentList({ incidents, selectedId, onSelect, onNew, canCreate, foot }: {
  incidents: readonly Incident[]; selectedId?: bigint; onSelect: (id: bigint) => void; onNew: () => void; canCreate: boolean; foot: ReactNode;
}) {
  const sorted = [...incidents].sort(order);
  return (
    <aside className="rail">
      <div className="rail-head">
        <span className="eyebrow">INCIDENTS</span>
        <button className="icon-button" onClick={onNew} disabled={!canCreate} aria-label="New incident" title={canCreate ? 'New incident (N)' : 'Observers can’t create incidents'}>+</button>
      </div>
      <div className="rail-filter"><span>All incidents</span><span>{String(incidents.length).padStart(2, '0')}</span></div>
      <div id="incident-list" role="list" aria-label="Incidents">
        {!sorted.length && <p className="section-note" style={{ padding: '0 8px' }}>No incidents yet.</p>}
        {sorted.map(i => (
          <button key={i.id.toString()} role="listitem" className={`incident ${i.id === selectedId ? 'active' : ''} ${i.status === 'closed' ? 'is-closed' : ''}`}
            aria-current={i.id === selectedId ? 'true' : undefined} onClick={() => onSelect(i.id)}>
            <span className="number">{incidentNumber(i.id)}<span className={i.severity === 'critical' ? 'red' : i.severity === 'high' ? 'amber' : 'dim'}>{GLYPH[i.severity] ?? '·'} {displayValue(i.severity).toUpperCase()}</span></span>
            <strong>{i.title}</strong>
            <small>{i.status === 'closed' ? 'Closed' : containmentLabel(i.containmentStatus)} <span style={{ float: 'right' }}>{fmtUtc(tsToDate(i.detectedAt)).slice(11, 16)}</span></small>
          </button>
        ))}
      </div>
      <div className="rail-foot">{foot}</div>
    </aside>
  );
}
