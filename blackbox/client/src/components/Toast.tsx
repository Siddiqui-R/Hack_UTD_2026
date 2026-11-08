import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

// DESIGN §7: bottom-left, 13px mono (server messages are machine text), 4s, one at a time.
const ToastCtx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div
          role="status"
          className="fixed bottom-4 left-4 z-50 max-w-[480px] rounded-[4px] border border-critical bg-bg-1 px-3 py-2 font-mono text-[13px] text-text-0"
        >
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// Runs a reducer call; a failure surfaces as one toast carrying the server's message.
export function useRun() {
  const toast = useContext(ToastCtx);
  return useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return true;
      } catch (err) {
        console.error(err);
        toast(`DENIED · ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },
    [toast]
  );
}
