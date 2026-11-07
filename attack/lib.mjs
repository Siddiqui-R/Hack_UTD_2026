// Shared helpers: target guard, identities, reducer calls, SQL, result printing.
// Talks to SpacetimeDB over its plain HTTP API so the script has no dependencies.
import { spawnSync } from 'node:child_process';

export const TARGET = (process.env.ATTACK_TARGET ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
export const DB = process.env.ATTACK_DB ?? 'blackbox';

// Safety: never attack anything but a local server unless explicitly told to.
// Attack 2 rewrites audit rows; running it against the live demo DB by accident would be fatal.
export function guardTarget() {
  const host = new URL(TARGET).hostname;
  const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!local && process.env.ATTACK_ALLOW_REMOTE !== '1') {
    console.error(`REFUSING: target ${TARGET} is not local. Set ATTACK_ALLOW_REMOTE=1 to override.`);
    process.exit(2);
  }
}

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' };
export const color = C;

// A fresh identity each call. Each one is a brand-new "user" from SpacetimeDB's point of view.
export async function newIdentity() {
  const res = await fetch(`${TARGET}/v1/identity`, { method: 'POST' });
  if (!res.ok) throw new Error(`identity mint failed: HTTP ${res.status}`);
  const { identity, token } = await res.json();
  return { identity: identity.startsWith('0x') ? identity : `0x${identity}`, token };
}

// Call a reducer. Returns { ok, status, error }. args is the positional JSON array.
export async function call(who, reducer, args = []) {
  const headers = { 'Content-Type': 'application/json' };
  if (who?.token) headers.Authorization = `Bearer ${who.token}`;
  const res = await fetch(`${TARGET}/v1/database/${DB}/call/${reducer}`, {
    method: 'POST', headers, body: JSON.stringify(args),
  });
  const text = res.ok ? '' : (await res.text()).trim();
  return { ok: res.ok, status: res.status, error: text };
}

// Run SQL as `who` (or anonymous). Returns { ok, rows, cols, error }.
export async function sql(who, query) {
  const headers = { 'Content-Type': 'text/plain' };
  if (who?.token) headers.Authorization = `Bearer ${who.token}`;
  const res = await fetch(`${TARGET}/v1/database/${DB}/sql`, { method: 'POST', headers, body: query });
  if (!res.ok) return { ok: false, rows: [], cols: [], error: (await res.text()).trim() };
  const [first] = await res.json();
  const cols = first.schema.elements.map(e => e.name?.some ?? '');
  const rows = first.rows.map(r => Object.fromEntries(r.map((v, i) => [cols[i], v])));
  return { ok: true, rows, cols, error: '' };
}

// SQL as the database OWNER via the spacetime CLI (the "attacker owns the DB" position).
export function ownerSql(query) {
  const local = TARGET.includes('127.0.0.1') || TARGET.includes('localhost');
  const args = ['sql', ...(local ? ['--server', 'local'] : []), '--no-config', DB, query];
  const r = spawnSync('spacetime', args, { encoding: 'utf8' });
  if (r.error) throw new Error(`spacetime CLI not found on PATH: ${r.error.message}`);
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

// Results: PASS = defense held, VULN = attack succeeded, SKIP = slice not landed / precondition missing.
export const results = [];
export function record(id, title, outcome, detail = '') {
  results.push({ id, title, outcome, detail });
  const tag = outcome === 'PASS' ? `${C.green}PASS${C.reset}`
    : outcome === 'VULN' ? `${C.red}${C.bold}VULN${C.reset}`
    : `${C.yellow}SKIP${C.reset}`;
  console.log(`  ${tag}  ${id.padEnd(5)} ${title}${detail ? `${C.dim}  — ${detail}${C.reset}` : ''}`);
}

// The attack "should be rejected": PASS if the call failed, VULN if it went through.
export function expectDenied(id, title, r) {
  record(id, title, r.ok ? 'VULN' : 'PASS', r.ok ? 'call was ACCEPTED' : r.error.split('\n')[0].slice(0, 90));
}

export function banner(text) {
  console.log(`\n${C.bold}━━ ${text} ${'━'.repeat(Math.max(0, 60 - text.length))}${C.reset}`);
}

// Unique suffix so re-runs never collide with earlier rows.
export const runTag = Date.now().toString(36).slice(-5);
