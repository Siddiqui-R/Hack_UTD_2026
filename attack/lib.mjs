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

// fetch with one retry on a dropped connection (Windows sockets can hiccup under the brute-force burst).
async function req(url, opts) {
  try { return await fetch(url, opts); }
  catch { await new Promise(r => setTimeout(r, 250)); return fetch(url, opts); }
}

// A fresh identity each call. Each one is a brand-new "user" from SpacetimeDB's point of view.
export async function newIdentity() {
  const res = await req(`${TARGET}/v1/identity`, { method: 'POST' });
  if (!res.ok) throw new Error(`identity mint failed: HTTP ${res.status}`);
  const { identity, token } = await res.json();
  return { identity: identity.startsWith('0x') ? identity : `0x${identity}`, token };
}

// Call a reducer. Returns { ok, status, error }. args is the positional JSON array.
export async function call(who, reducer, args = []) {
  const headers = { 'Content-Type': 'application/json' };
  if (who?.token) headers.Authorization = `Bearer ${who.token}`;
  const res = await req(`${TARGET}/v1/database/${DB}/call/${reducer}`, {
    method: 'POST', headers, body: JSON.stringify(args),
  });
  const text = res.ok ? '' : (await res.text()).trim();
  return { ok: res.ok, status: res.status, error: text };
}

// Timestamp argument in SpacetimeDB's JSON format.
export const ts = (ms = Date.now()) => ({ __timestamp_micros_since_unix_epoch__: Math.round(ms * 1000) });

// A timestamp column as returned by SQL ([micros] or {__timestamp…}) → reducer argument form.
export const tsArg = v => ({ __timestamp_micros_since_unix_epoch__: Array.isArray(v) ? v[0] : (v?.__timestamp_micros_since_unix_epoch__ ?? v) });

// The standard "try to write something" call: a valid create_incident (slice 3+).
export function write(who, title = 'atk write', over = {}) {
  const a = { title, type: 'ransomware', severity: 'high', detectedAt: ts(Date.now() - 60_000), systems: 'fin-db-02', containment: 'none', ...over };
  return call(who, 'create_incident', [a.title, a.type, a.severity, a.detectedAt, a.systems, a.containment]);
}

// Call a read procedure. Procedures return a JSON string; parsed into `data` when ok.
export async function proc(who, name, args = []) {
  const res = await req(`${TARGET}/v1/database/${DB}/call/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) },
    body: JSON.stringify(args),
  });
  if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).trim(), data: null };
  const body = await res.json();
  return { ok: true, status: res.status, error: '', data: typeof body === 'string' ? JSON.parse(body) : body };
}

// A fresh service identity enrolled as NEMOTRON for `incidentId` by the run's commander.
export async function enrollAgent(incidentId) {
  const cmd = await getCommander();
  const ag = await newIdentity();
  const r = await call(cmd, 'enroll_agent', [{ __identity__: ag.identity }, incidentId]);
  if (!r.ok) throw new Error(`enroll_agent failed: ${r.error}`);
  return ag;
}

// Run SQL as `who` (or anonymous). Returns { ok, rows, cols, error }.
export async function sql(who, query) {
  const headers = { 'Content-Type': 'text/plain' };
  if (who?.token) headers.Authorization = `Bearer ${who.token}`;
  const res = await req(`${TARGET}/v1/database/${DB}/sql`, { method: 'POST', headers, body: query });
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

// Reducer call as the database OWNER (the identity that published) via the spacetime CLI.
export function ownerCall(reducer, ...args) {
  const local = TARGET.includes('127.0.0.1') || TARGET.includes('localhost');
  const cli = ['call', ...(local ? ['--server', 'local'] : []), '--no-config', DB, reducer, ...args.map(a => JSON.stringify(a))];
  const r = spawnSync('spacetime', cli, { encoding: 'utf8' });
  if (r.error) throw new Error(`spacetime CLI not found on PATH: ${r.error.message}`);
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

// The owner as an HTTP caller (token from `spacetime login show --token`; never printed).
let ownerWho;
export function owner() {
  if (ownerWho) return ownerWho;
  const r = spawnSync('spacetime', ['login', 'show', '--token'], { encoding: 'utf8' });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const token = out.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0];
  if (!token) throw new Error('could not read owner token from spacetime CLI');
  const hex = out.match(/logged in as ([0-9a-f]{64})/i)?.[1];
  return (ownerWho = { token, identity: hex ? `0x${hex}` : undefined });
}

// Independent re-implementation of the module's canonicalJson + chain formula, used to
// verify the audit log from outside. Deliberately NOT imported from the module.
import { createHash } from 'node:crypto';
export function canonical(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'bigint') return JSON.stringify(v.toString());
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}
const micros = ts => BigInt(ts?.__timestamp_micros_since_unix_epoch__ ?? ts);
export function auditHash(row) {
  const body = canonical({
    seq: BigInt(row.seq), incidentId: BigInt(row.incident_id), actor: row.actor, action: row.action,
    payloadJson: row.payload_json, prevHash: row.prev_hash, createdAt: micros(row.created_at),
  });
  return createHash('sha256').update(body + row.prev_hash, 'utf8').digest('hex');
}
export async function auditRows() {
  const r = await sql(owner(), 'SELECT * FROM audit');
  return r.rows.sort((a, b) => Number(a.seq) - Number(b.seq));
}

// Independent verifier with the same result shape slice 4's verifyChain must return.
export const GENESIS = '0'.repeat(64);
export function verifyChainIndependent(rows) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], seq = Number(r.seq);
    if (seq !== i + 1) return { ok: false, checked: i, brokenAt: seq, reason: `seq gap: expected ${i + 1}` };
    if (r.prev_hash !== (i ? rows[i - 1].event_hash : GENESIS)) return { ok: false, checked: i, brokenAt: seq, reason: 'prev_hash link broken' };
    if (auditHash(r) !== r.event_hash) return { ok: false, checked: i, brokenAt: seq, reason: 'event_hash mismatch (row edited)' };
  }
  return { ok: true, checked: rows.length, brokenAt: null, reason: '' };
}

// The module's own verifyChain (slice 4) over HTTP. Raw result is the SATS product
// [ok, checked, option, reason] with option [0, seq] = Some, [1, []] = None.
export async function verifyChainRemote(who) {
  const res = await req(`${TARGET}/v1/database/${DB}/call/verify_chain`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(who?.token ? { Authorization: `Bearer ${who.token}` } : {}) },
    body: '[]',
  });
  if (!res.ok) return { called: false, status: res.status, error: (await res.text()).trim() };
  const v = await res.json();
  if (!Array.isArray(v)) return { called: true, ...v, brokenAt: v.brokenAt == null ? null : Number(v.brokenAt.some ?? v.brokenAt) };
  const [ok, checked, opt, reason] = v;
  return { called: true, ok, checked: Number(checked), brokenAt: opt?.[0] === 0 ? Number(opt[1]) : null, reason };
}

// Random invite code in the module's format (8 chars, no I/L/O/0/1).
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode() {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const c = [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (new Set(c).size >= 5) return c; // the weak-code rule (fix S9) would reject the rest
  }
}

// One commander per run, made via the owner-only bootstrap invite.
let commander;
export async function getCommander() {
  if (commander) return commander;
  const code = randomCode();
  const b = ownerCall('issue_bootstrap_invite', code);
  if (!b.ok) throw new Error(`bootstrap failed (are you the owner?): ${b.out.trim().split('\n').pop()}`);
  const who = await newIdentity();
  const r = await call(who, 'redeem_invite', [code, `atk-cmd-${runTag}`]);
  if (!r.ok) throw new Error(`redeem bootstrap failed: ${r.error}`);
  return (commander = who);
}

// A fresh signed-in user with `role`, invited by the run's commander.
export async function signIn(role, name = `atk-${role}-${runTag}-${Math.random().toString(36).slice(2, 6)}`) {
  const cmd = await getCommander();
  const code = randomCode();
  const c = await call(cmd, 'create_invite', [code, role]);
  if (!c.ok) throw new Error(`create_invite failed: ${c.error}`);
  const who = await newIdentity();
  const r = await call(who, 'redeem_invite', [code, name]);
  if (!r.ok) throw new Error(`redeem failed: ${r.error}`);
  return { ...who, name };
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
