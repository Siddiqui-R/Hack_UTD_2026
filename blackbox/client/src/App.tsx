import { useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings';

const ROLES = ['commander', 'responder', 'observer'] as const;

// Slice 1 harness. Unstyled on purpose: the design system lands in slice 3.
export default function App() {
  const { isActive, identity } = useSpacetimeDB();
  const [team, teamReady] = useTable(tables.team);
  const [pings] = useTable(tables.ping);
  const register = useReducer(reducers.register);
  const setRole = useReducer(reducers.setRole);
  const addPing = useReducer(reducers.addPing);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const me = identity ? team.find(m => m.identity.isEqual(identity)) : undefined;

  const run = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (err) {
      console.error(err);
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  const sorted = [...pings].sort((a, b) => (a.id < b.id ? -1 : 1));

  return (
    <main style={{ fontFamily: 'monospace', padding: 16 }}>
      <h1>SLICE 1 · roles</h1>
      <p>
        {isActive ? 'CONNECTED' : 'DISCONNECTED'} · {identity?.toHexString().slice(0, 12) ?? '—'} ·{' '}
        {me ? `${me.displayName} [${me.role}]` : 'not registered'}
      </p>
      {error && <p data-testid="error" style={{ color: 'red' }}>DENIED: {error}</p>}

      {teamReady && !me && (
        <form onSubmit={e => { e.preventDefault(); run(() => register({ displayName: name })); }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="display name" />
          <button type="submit">register</button>
        </form>
      )}

      <h2>team</h2>
      <ul data-testid="team">
        {team.map(m => (
          <li key={m.identity.toHexString()}>
            {m.displayName} [{m.role}] {m.identity.toHexString().slice(0, 8)}
            {m.flagged && ' FLAGGED'}
            {ROLES.filter(r => r !== m.role).map(r => (
              <button key={r} onClick={() => run(() => setRole({ target: m.identity, role: r }))}>
                make {r}
              </button>
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
    </main>
  );
}
