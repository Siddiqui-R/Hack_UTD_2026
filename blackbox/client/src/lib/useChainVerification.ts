import { useEffect, useState } from 'react';
import { useProcedure, useSpacetimeDB } from 'spacetimedb/react';
import { procedures } from '../module_bindings';
import type { ChainVerification, AnchorVerification } from '../module_bindings/types';

// Read-only polling catches SQL tampering even when no reducer or subscription event fires.
// Clear stale green state on disconnect, auth change or a failed verification request.
export function useChainVerification() {
  const { isActive, identity } = useSpacetimeDB();
  const verify = useProcedure(procedures.verifyIntegrity);
  const [result, setResult] = useState<ChainVerification>();
  const [error, setError] = useState('');
  const [anchor, setAnchor] = useState<AnchorVerification>();
  useEffect(() => {
    setResult(undefined);
    setAnchor(undefined);
    setError('');
    if (!isActive) return;
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const next = await verify();
        if (!cancelled) { setResult(next.chain); setAnchor(next.anchor); setError(''); }
      } catch (err) {
        if (!cancelled) {
          setResult(undefined);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(check, 2000);
      }
    };
    void check();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [verify, isActive, identity]);
  return { result, error, anchor };
}
