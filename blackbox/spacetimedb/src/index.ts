import { schema, table, t, SenderError } from 'spacetimedb/server';

// Gate 0: one public table, one reducer.
const ping = table(
  { name: 'ping', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    text: t.string(),
  }
);

const spacetimedb = schema({ ping });
export default spacetimedb;

export const addPing = spacetimedb.reducer(
  { text: t.string() },
  (ctx, { text }) => {
    const trimmed = text.trim();
    if (!trimmed) throw new SenderError('text required');
    if (trimmed.length > 500) throw new SenderError('text too long');
    ctx.db.ping.insert({ id: 0n, text: trimmed });
  }
);
