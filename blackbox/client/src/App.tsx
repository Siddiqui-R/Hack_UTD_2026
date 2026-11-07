import { useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings';
import { generateInviteCode } from './inviteCode';

const ROLES = ['commander', 'responder', 'observer'] as const;
const TOUCH_EVERY_MS = 60_000;

// Slice 2 harness. Unstyled on purpose: the design system lands in slice 3.
export default function App() {
  const { isActive, identity } = useSpacetimeDB();
  const [team, teamReady] = useTable(tables.team);
  const [pings] = useTable(tables.ping);
  const redeemInvite = useReducer(reducers.redeemInvite);
  const createInvite = useReducer(reducers.createInvite);
  const touchSession = useReducer(reducers.touchSession);
  const setRole = useReducer(reducers.setRole);
  const addPing = useReducer(reducers.addPing);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('responder');
  const [issued, setIssued] = useState<{ code: string; role: string } | null>(null);
  const [error, setError] = useState('');
  const lastTouch = useRef(0);

  const me = identity ? team.find(m => m.identity.isEqual(identity)) : undefined;

  // Refresh the 15-minute session on real user activity, at most once a minute.
  useEffect(() => {
    if (!me) return;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastTouch.current < TOUCH_EVERY_MS) return;
      lastTouch.current = now;
      touchSession().catch(err => console.error('touchSession', err));
    };
    window.addEventListener('keydown', onActivity);
    window.addEventListener('pointerdown', onActivity);
    return () => {
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('pointerdown', onActivity);
    };
  }, [me, touchSession]);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (err) {
      console.error(err);
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  const issue = () =>
    run(async () => {
      const c = generateInviteCode();
      await createInvite({ code: c, role: inviteRole });
      setIssued({ code: c, role: inviteRole });
    });

  const sorted = [...pings].sort((a, b) => (a.id < b.id ? -1 : 1));

  return (
    <main style={{ fontFamily: 'monospace', padding: 16 }}>
      <h1>SLICE 2 · invite codes</h1>
      <p>
        {isActive ? 'CONNECTED' : 'DISCONNECTED'} · {identity?.toHexString().slice(0, 12) ?? '—'} ·{' '}
        {me ? `${me.displayName} [${me.role}]` : 'signed out'}
      </p>
      {error && <p data-testid="error" style={{ color: 'red' }}>DENIED: {error}</p>}

      {teamReady && !me && (
        <form onSubmit={e => { e.preventDefault(); run(async () => { await redeemInvite({ code, displayName: name }); setCode(''); }); }}>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="invite code" autoComplete="off" />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="display name" />
          <button type="submit">enter</button>
        </form>
      )}

      {me && (
        <>
          <h2>issue invite (commander)</h2>
          <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={issue}>generate code</button>
          {issued && <p data-testid="issued">CODE {issued.code} · {issued.role} · single use · expires in 30 min</p>}

          <h2>team</h2>
          <ul data-testid="team">
            {team.map(m => (
              <li key={m.identity.toHexString()}>
                {m.displayName} [{m.role}] {m.identity.toHexString().slice(0, 8)}
                {m.flagged && ' FLAGGED'}
                {ROLES.filter(r => r !== m.role).map(r => (
                  <button key={r} onClick={() => run(() => setRole({ target: m.identity, role: r }))}>make {r}</button>
                ))}
              </li>
            ))}
          </ul>

          <h2>pings (commander/responder can write)</h2>
          <form onSubmit={e => { e.preventDefault(); run(async () => { await addPing({ text }); setText(''); }); }}>
            <input value={text} onChange={e => setText(e.target.value)} placeholder="ping text" />
            <button type="submit">send</button>
          </form>
          <ul data-testid="pings">
            {sorted.map(p => <li key={p.id.toString()}>#{p.id.toString()} {p.text}</li>)}
          </ul>
        </>
      )}
    </main>
  );
}
