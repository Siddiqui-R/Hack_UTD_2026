import { useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings';

export default function App() {
  const { isActive, identity } = useSpacetimeDB();
  const [pings, isReady] = useTable(tables.ping);
  const addPing = useReducer(reducers.addPing);
  const [text, setText] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addPing({ text });
      setText('');
    } catch (err) {
      console.error('addPing failed', err);
      alert(String(err));
    }
  };

  const sorted = [...pings].sort((a, b) => (a.id < b.id ? -1 : 1));

  return (
    <main style={{ fontFamily: 'monospace', padding: 16 }}>
      <h1>GATE 0 · ping</h1>
      <p>
        {isActive ? 'CONNECTED' : 'DISCONNECTED'} · {identity?.toHexString().slice(0, 12) ?? '—'} ·{' '}
        {isReady ? `${pings.length} rows` : 'loading'}
      </p>
      <form onSubmit={submit}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="type and press enter" />
        <button type="submit" disabled={!isActive}>send</button>
      </form>
      <ul data-testid="pings">
        {sorted.map(p => (
          <li key={p.id.toString()}>#{p.id.toString()} {p.text}</li>
        ))}
      </ul>
    </main>
  );
}
