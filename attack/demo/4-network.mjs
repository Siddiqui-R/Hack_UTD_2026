// On-stage attack 4: one device loses its network. The other keeps working, and the first
// catches up with nothing lost when it reconnects.
// Uses the real client bindings and the SpacetimeDB SDK over WebSockets, the same path the browser app uses.
// No browser automation package needed. Node 26 runs the generated .ts bindings directly; the hook below only
// adds the ".ts" extension the generated imports leave out.
import { registerHooks } from 'node:module';
import { TARGET, DB, signIn, getCommander, record, color as C } from '../lib.mjs';
import { incident, check } from '../slice-helpers.mjs';

export const label = 'ATTACK 4';
export const title = 'Cut the network on one device';

const say = s => console.log(`  ${C.dim}${s}${C.reset}`);
const pause = ms => new Promise(r => setTimeout(r, ms));
const BINDINGS = new URL('../../blackbox/client/src/module_bindings/index.ts', import.meta.url).href;

let hooked = false;
function hookBindings() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(spec, ctx, next) {
      try { return next(spec, ctx); } catch (e) {
        if (spec.startsWith('.') && ctx.parentURL?.includes('/module_bindings/')) return next(`${spec}.ts`, ctx);
        throw e;
      }
    },
  });
}

// Open a live connection as `who`, subscribed to chat. Resolves once the initial rows have arrived.
function device(DbConnection, who, incidentId) {
  return new Promise((resolve, reject) => {
    const seen = new Set();
    const mine = row => String(row.incidentId) === String(incidentId);
    const timer = setTimeout(() => reject(new Error('connect timed out')), 10000);
    DbConnection.builder()
      .withUri(TARGET.replace(/^http/, 'ws'))
      .withDatabaseName(DB)
      .withToken(who.token)
      .onConnect(conn => {
        conn.db.messages.onInsert((_ctx, row) => { if (mine(row)) seen.add(row.text); });
        conn.subscriptionBuilder()
          .onApplied(() => {
            for (const row of conn.db.messages.iter()) if (mine(row)) seen.add(row.text);
            clearTimeout(timer);
            resolve({ conn, seen });
          })
          .onError((_ctx, err) => { clearTimeout(timer); reject(err ?? new Error('subscription failed')); })
          .subscribe(['SELECT * FROM messages']);
      })
      .onConnectError((_ctx, err) => { clearTimeout(timer); reject(err); })
      .build();
  });
}

async function waitFor(test, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await pause(100)) if (test()) return true;
  return test();
}

export async function run() {
  hookBindings();
  let DbConnection;
  try { ({ DbConnection } = await import(BINDINGS)); }
  catch (e) { return record('A4', 'network cut + resync', 'SKIP', `client bindings not loadable: ${e.message.slice(0, 80)}`); }

  const cmd = await getCommander();
  const inc = await incident('netcut');
  const phone = await signIn('responder', `Phone-${inc.id}`);
  const id = BigInt(inc.id);
  const open = [];
  try {
    let laptop = await device(DbConnection, cmd, inc.id); open.push(laptop);
    const mobile = await device(DbConnection, phone, inc.id); open.push(mobile);
    say('laptop (commander) and phone (responder) are both live on the incident');

    const hello = `phone: on site at payroll-07 (${inc.id})`;
    await mobile.conn.reducers.sendMessage({ incidentId: id, text: hello });
    check('A4a', 'both online: laptop sees the phone message live', await waitFor(() => laptop.seen.has(hello)));

    say('✂  laptop loses its network');
    laptop.conn.disconnect(); open.splice(open.indexOf(laptop), 1);

    const dark = [`phone: pulled payroll-07 off the switch (${inc.id})`, `phone: fs01 snapshots intact (${inc.id})`];
    for (const text of dark) await mobile.conn.reducers.sendMessage({ incidentId: id, text });
    check('A4b', 'phone keeps working while the laptop is offline',
      await waitFor(() => dark.every(t => mobile.seen.has(t))), 'both messages confirmed by the server');

    say('laptop network back: reconnect with the same token');
    laptop = await device(DbConnection, cmd, inc.id); open.push(laptop);
    const all = [hello, ...dark];
    const synced = await waitFor(() => all.every(t => laptop.seen.has(t)));
    check('A4c', 'laptop catches up on everything it missed', synced && laptop.seen.size === all.length,
      `${laptop.seen.size}/${all.length} messages after resync`);
  } finally {
    for (const d of open) { try { d.conn.disconnect(); } catch { /* already closed */ } }
  }
}
