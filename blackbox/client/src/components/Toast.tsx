import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// DESIGN §7: bottom-left, 13px mono (server messages are machine text), 4s, one at a time.
const ToastCtx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 4000);
  }, []);
  // A modal <dialog> sits in the browser's top layer, above any z-index. Showing the toast as a manual
  // popover (re-shown per message) puts it above the open dialog, so a form's error is never hidden.
  useEffect(() => {
    const el = box.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!el?.showPopover) return;
    try { el.hidePopover?.(); } catch { /* not shown */ }
    if (msg) try { el.showPopover(); } catch { /* unsupported: stays a fixed element */ }
  }, [msg]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div
        ref={box}
        role="status"
        {...{ popover: 'manual' }}
        hidden={!msg}
        className="toast fixed bottom-4 left-4 z-50 m-0 max-w-[480px] rounded-[4px] border border-critical bg-bg-1 px-3 py-2 font-mono text-[13px] text-text-0"
        style={{ inset: 'auto auto 16px 16px' }}
      >
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}

// Runs a reducer call; a failure surfaces as one toast carrying the server's message.
export function useRun(serial = false) {
  const toast = useContext(ToastCtx);
  const pending = useRef(false);
  return useCallback(
    async (fn: () => Promise<unknown>) => {
      if (serial && pending.current) return false;
      pending.current = true;
      try {
        await fn();
        return true;
      } catch (err) {
        console.error(err);
        toast(`DENIED · ${err instanceof Error ? err.message : String(err)}`);
        return false;
      } finally {
        pending.current = false;
      }
    },
    [toast, serial]
  );
}
