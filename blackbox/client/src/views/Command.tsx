import { useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import type { TeamMember } from '../module_bindings/types';
import { Chrome } from '../components/Chrome';
import { IncidentList } from '../components/IncidentList';
import { IncidentForm } from '../components/IncidentForm';
import { IncidentDetail } from '../components/IncidentDetail';
import { Collaboration } from '../components/Collaboration';
import { Investigate } from './Investigate';
import { RecordView } from './Record';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

// DESIGN §8 view 1: incident list 280px · detail flex · team/chat 320px, divided by 1px lines.
export function Command({ me, team }: { me: TeamMember; team: readonly TeamMember[] }) {
  const { isActive } = useSpacetimeDB();
  const [incidents] = useTable(tables.incidents);
  const [selectedId, setSelectedId] = useState<bigint | undefined>();
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'command'|'investigate'|'record'>('command');
  const selectNewest = useRef(false);
  const canWrite = me.role === 'commander' || me.role === 'responder';

  // After filing, jump to the incident this user just created.
  useEffect(() => {
    if (!selectNewest.current) return;
    const mine = incidents.filter(i => i.reportedBy.isEqual(me.identity));
    if (mine.length === 0) return;
    selectNewest.current = false;
    setSelectedId(mine.reduce((a, b) => (a.id > b.id ? a : b)).id);
  }, [incidents, me.identity]);

  // Default selection: first incident, so the center pane is never blank when data exists.
  useEffect(() => {
    if (selectedId === undefined && incidents.length > 0 && !creating) setSelectedId(incidents[0].id);
  }, [incidents, selectedId, creating]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'n' || e.key === 'N') && canWrite) {
        e.preventDefault();
        setCreating(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canWrite]);

  const selected = incidents.find(i => i.id === selectedId);

  return (
    <div className="flex h-full min-w-[1120px] flex-col">
      <Chrome active={creating ? undefined : selected} me={me} team={team} linkUp={isActive} />
      <nav className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-bg-1 px-3" aria-label="Workspace">
        {(['command','investigate','record'] as const).map(v=><button key={v} className="btn h-7 border-0 bg-transparent font-mono text-[11px] uppercase" style={{color:view===v?'var(--color-accent)':undefined}} aria-current={view===v?'page':undefined} onClick={()=>{setCreating(false);setView(v);}}>{v}</button>)}
      </nav>
      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr_320px]">
        <IncidentList
          incidents={incidents}
          selectedId={creating ? undefined : selectedId}
          onSelect={id => {
            setCreating(false);
            setSelectedId(id);
          }}
          onNew={() => {setView('command');setCreating(true);}}
          canCreate={canWrite}
        />
        {view!=='command' ? <section className="col-span-2 min-h-0 overflow-hidden">{selected?(view==='record'?<RecordView key={selected.id.toString()} incident={selected} me={me}/>:<Investigate key={selected.id.toString()} incident={selected} me={me}/>):<p className="p-6 text-text-2">Select an incident.</p>}</section> : <>
        <main className="min-h-0 overflow-y-auto bg-bg-0">
          {creating ? (
            <IncidentForm
              onDone={created => {
                setCreating(false);
                if (created) selectNewest.current = true;
              }}
            />
          ) : selected ? (
            <IncidentDetail incident={selected} team={team} canWrite={canWrite} />
          ) : (
            <p className="p-6 text-text-2">
              {incidents.length === 0
                ? canWrite
                  ? 'No incidents filed. Press N to file the first one.'
                  : 'No incidents filed yet.'
                : 'Select an incident.'}
            </p>
          )}
        </main>
        <Collaboration incident={selected} team={team} me={me} />
        </>}
      </div>
    </div>
  );
}
