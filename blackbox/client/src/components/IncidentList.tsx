import { Plus } from 'lucide-react';
import type { Incident } from '../module_bindings/types';
import { SEVERITY_TONE } from '../lib/vocab';

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Open incidents first, then by severity, then newest.
function order(a: Incident, b: Incident) {
  const closed = (i: Incident) => (i.status === 'closed' ? 1 : 0);
  return (
    closed(a) - closed(b) ||
    (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
    (a.id > b.id ? -1 : 1)
  );
}

export function IncidentList({
  incidents,
  selectedId,
  onSelect,
  onNew,
  canCreate,
}: {
  incidents: readonly Incident[];
  selectedId?: bigint;
  onSelect: (id: bigint) => void;
  onNew: () => void;
  canCreate: boolean;
}) {
  const sorted = [...incidents].sort(order);
  return (
    <section className="flex min-h-0 flex-col border-r border-line bg-bg-1">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="label">
          Incidents <span className="font-mono text-text-2">{incidents.length}</span>
        </span>
        {canCreate && (
          <button className="btn h-6 px-2 text-[12px]" onClick={onNew} title="New incident (N)">
            <Plus size={14} strokeWidth={1.5} /> New <span className="kbd">N</span>
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Incidents">
        {sorted.length === 0 && <p className="px-3 py-3 text-text-2">No incidents filed.</p>}
        {sorted.map(i => {
          const tone = SEVERITY_TONE[i.severity];
          return (
            <div
              key={i.id.toString()}
              role="option"
              aria-selected={i.id === selectedId}
              className="row"
              onClick={() => onSelect(i.id)}
            >
              <span className="w-3 shrink-0 font-mono text-[12px]" style={{ color: tone?.color }} aria-label={i.severity}>
                {tone?.glyph}
              </span>
              <span className="shrink-0 font-mono text-[12px] text-text-2">INC-{i.id.toString()}</span>
              <span className={`min-w-0 flex-1 truncate ${i.status === 'closed' ? 'text-text-2 line-through' : ''}`} title={`${i.title} · ${i.status}`}>
                {i.title}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
