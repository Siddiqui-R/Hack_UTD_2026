import { useEffect, useRef, useState } from 'react';
import { useReducer, useSpacetimeDB } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import { ThemeToggle } from './ThemeToggle';

// Must match the module's CODE_ALPHABET / CODE_LENGTH.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;
const LOCK_MS = 200;

type State = 'idle' | 'busy' | 'error' | 'ok';

// Demo link: /?invite=CODE&name=CALLSIGN fills the form and signs in, so nobody types a code on stage.
// The server still checks the code (single use, 30-minute expiry). The params leave the address bar at once.
// Judge demo: /?demo asks /api/demo-invite for a fresh responder code, then signs in the same way.
function readInviteLink(): { code: string; name: string; demo?: boolean } | null {
  try {
    const p = new URLSearchParams(location.search);
    if (!p.has('invite') && !p.has('demo')) return null;
    history.replaceState(null, '', location.pathname + location.hash);
    const name = (p.get('name') ?? '').trim().slice(0, 40);
    if (p.has('demo')) return { code: '', name: name || 'Judge', demo: true };
    const code = [...(p.get('invite') ?? '').toUpperCase()].filter(c => ALPHABET.includes(c)).join('').slice(0, LENGTH);
    return code.length === LENGTH ? { code, name: name || 'Demo' } : null;
  } catch {
    return null;
  }
}
const LINK = readInviteLink();
let pendingLink = LINK; // consumed once, even under StrictMode's double effects

// DESIGN §6.1. `onHold(true)` keeps this screen up through the 200ms green lock after
// the session appears; `onHold(false)` releases it for the hard cut to COMMAND.
export function Login({ onHold }: { onHold: (hold: boolean) => void }) {
  const { isActive } = useSpacetimeDB();
  const redeem = useReducer(reducers.redeemInvite);
  const [code, setCode] = useState(LINK?.code ?? '');
  const [name, setName] = useState(LINK?.name ?? '');
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { codeRef.current?.focus(); }, []);

  const onCodeChange = (raw: string) => {
    const next = [...raw.toUpperCase()].filter(c => ALPHABET.includes(c)).join('').slice(0, LENGTH);
    setCode(next);
    if (state === 'error') setState('idle');
    if (next.length === LENGTH && !name.trim()) nameRef.current?.focus();
  };

  const submit = async (c = code, n = name) => {
    if (state === 'busy' || state === 'ok') return;
    if (c.length !== LENGTH) return codeRef.current?.focus();
    if (!n.trim()) return nameRef.current?.focus();
    setState('busy');
    onHold(true);
    try {
      await redeem({ code: c, displayName: n.trim() });
      setState('ok');
      window.setTimeout(() => onHold(false), LOCK_MS);
    } catch (err) {
      onHold(false);
      setState('error');
      setMessage(err instanceof Error ? err.message.toUpperCase() : 'REJECTED');
      setShakeKey(k => k + 1);
      codeRef.current?.focus();
    }
  };

  // Demo link: sign in as soon as the connection is up.
  useEffect(() => {
    const link = pendingLink;
    if (!link || !isActive) return;
    pendingLink = null;
    if (!link.demo) { submit(); return; }
    fetch('/api/demo-invite', { method: 'POST' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('demo sign-in unavailable'))))
      .then(({ code: c }: { code: string }) => { setCode(c); submit(c, link.name); })
      .catch(err => { setState('error'); setMessage(String(err.message ?? err).toUpperCase()); });
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const boxColor =
    state === 'error' ? 'var(--color-critical)' : state === 'ok' ? 'var(--color-ok)' : undefined;

  const box = (i: number) => {
    const ch = code[i];
    const isCursor = i === code.length && state !== 'ok';
    return (
      <div
        key={i}
        className="flex h-14 w-11 items-center justify-center rounded-[4px] border bg-bg-1 font-mono text-[32px] font-semibold"
        style={{
          borderColor: boxColor ?? (isCursor ? 'var(--color-accent)' : 'var(--color-line)'),
          color: boxColor ?? 'var(--color-text-0)',
        }}
      >
        {ch && (
          <span key={`${i}-${ch}`} className="code-char inline-block">
            {ch}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="relative flex h-full flex-col bg-bg-deep">
      <div className="scanlines" aria-hidden />

      <header className="flex h-11 items-center justify-between px-4">
        <span className="font-mono text-[13px] font-semibold tracking-[0.2em] text-text-0">BLACKBOX</span>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <span className="font-mono text-[12px]" style={{ color: isActive ? 'var(--color-text-2)' : 'var(--color-critical)' }}>
            {isActive ? 'LINK UP' : 'LINK DOWN'}
          </span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
        <div className="label">Enter invite code</div>

        <form
          className="flex flex-col items-center gap-6"
          onSubmit={e => {
            e.preventDefault();
            submit();
          }}
        >
          <div
            key={shakeKey}
            className={`flex cursor-text items-center gap-2 ${shakeKey ? 'code-shake' : ''}`}
            onClick={() => codeRef.current?.focus()}
          >
            {[0, 1, 2, 3].map(box)}
            <span className="w-4 text-center font-mono text-[32px] text-text-2" aria-hidden>
              -
            </span>
            {[4, 5, 6, 7].map(box)}
          </div>
          <input
            ref={codeRef}
            aria-label="Invite code, 8 characters"
            value={code}
            onChange={e => onCodeChange(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="absolute h-px w-px opacity-0"
            disabled={state === 'busy' || state === 'ok'}
          />

          <label className="flex w-[260px] flex-col gap-1">
            <span className="label">Callsign</span>
            <input
              ref={nameRef}
              className="field"
              value={name}
              maxLength={40}
              onChange={e => setName(e.target.value)}
              placeholder="Name shown to your team"
              disabled={state === 'busy' || state === 'ok'}
            />
          </label>

          <button type="submit" className="btn btn-primary w-[260px] justify-center" disabled={state === 'busy' || state === 'ok'}>
            Enter <span className="kbd">⏎</span>
          </button>
        </form>

        <p className="h-4 font-mono text-[12px]" style={{ color: state === 'error' ? 'var(--color-critical)' : 'var(--color-text-2)' }}>
          {state === 'error' ? message : state === 'ok' ? 'ACCEPTED' : 'Single-use code from your incident commander. No passwords, no corporate SSO.'}
        </p>
      </main>
    </div>
  );
}
