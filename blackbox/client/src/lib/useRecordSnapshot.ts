import { useCallback, useEffect, useRef, useState } from 'react';
import { useProcedure } from 'spacetimedb/react';
import { procedures } from '../module_bindings';
import type { RecordSnapshot } from './recordTypes';

// Polls getRecord for one incident. At most one request at a time; a reply is applied only if it answers the
// newest request, for the incident still shown, while the view is mounted. A failed refresh keeps the last good
// snapshot and reports the error instead of replacing what people are reading.
export function useRecordSnapshot(incidentId: bigint, everyMs = 5000) {
  const load = useProcedure(procedures.getRecord);
  const [state, setState] = useState<{ id: string; snapshot?: RecordSnapshot; updatedAt?: number; error?: string }>({ id: incidentId.toString() });
  const latest = useRef(0), busy = useRef(false), shown = useRef('');

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const id = incidentId.toString(), mine = ++latest.current;
    try {
      const next = JSON.parse(await load({ incidentId })) as RecordSnapshot;
      if (mine === latest.current && id === shown.current && String(next.incident?.id) === id) setState({ id, snapshot: next, updatedAt: Date.now() });
    } catch (err) {
      if (mine === latest.current && id === shown.current) setState(s => ({ ...s, id, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      if (mine === latest.current) busy.current = false;
    }
  }, [load, incidentId]);

  useEffect(() => {
    shown.current = incidentId.toString();
    busy.current = false;
    void refresh();
    const timer = window.setInterval(() => void refresh(), everyMs);
    return () => { window.clearInterval(timer); latest.current++; busy.current = false; };
  }, [refresh, incidentId, everyMs]);

  const same = state.id === incidentId.toString();
  return { snapshot: same ? state.snapshot : undefined, updatedAt: same ? state.updatedAt : undefined, error: same ? state.error : undefined, refresh };
}
