// One-time setup for judge demo sign-in (api/demo-invite.mjs).
//   node scripts/demo-commander.mjs <COMMANDER-INVITE-CODE>      (from blackbox/client)
// Creates a fresh Maincloud identity, redeems the commander code as "Demo desk" and writes its token to the
// gitignored .env.demo-token (never printed). Then: npx vercel env add DEMO_COMMANDER_TOKEN production < .env.demo-token
import fs from 'node:fs';

const SERVER = process.env.DEMO_STDB_HTTP ?? 'https://maincloud.spacetimedb.com';
const DB = process.env.DEMO_STDB_DB ?? 'blackbox-utd2026-abbas9x';
const code = (process.argv[2] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (code.length !== 8) { console.error('usage: node scripts/demo-commander.mjs <8-character commander invite code>'); process.exit(2); }

const id = await fetch(`${SERVER}/v1/identity`, { method: 'POST' });
if (!id.ok) { console.error(`identity mint failed: HTTP ${id.status}`); process.exit(1); }
const { token } = await id.json();
const r = await fetch(`${SERVER}/v1/database/${DB}/call/redeem_invite`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify([code, 'Demo desk']),
});
if (!r.ok) { console.error(`redeem failed: ${(await r.text()).trim()}`); process.exit(1); }
fs.writeFileSync(new URL('../.env.demo-token', import.meta.url), token);
console.log(`Demo desk signed in on ${DB}; token saved to .env.demo-token (gitignored).`);
