// One command for the attack segment: a local BLACKBOX client and the attacker console, both on the
// LOCAL `blackbox-attack` database, so judges watch the client react while the console attacks it.
// Run from repo root:  node attacker/stage.mjs
//   http://127.0.0.1:5180  BLACKBOX client on blackbox-attack (sign in with the printed commander code)
//   http://127.0.0.1:4400  attacker console
// Never touches Maincloud: refuses unless both the attacks and the client point at 127.0.0.1:3000.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SERVER = 'http://127.0.0.1:3000';
const DB = 'blackbox-attack';
const CLIENT_PORT = 5180; // own origin, so its saved login never mixes with the 5173 (local blackbox) client

// Pin the attack scripts to the local test database before lib.mjs reads the environment.
if (process.env.ATTACK_TARGET && process.env.ATTACK_TARGET.replace(/\/$/, '') !== SERVER) {
  console.error(`REFUSING: ATTACK_TARGET=${process.env.ATTACK_TARGET}; the stage only runs against ${SERVER}`);
  process.exit(2);
}
if (process.env.ATTACK_ALLOW_REMOTE) { console.error('REFUSING: unset ATTACK_ALLOW_REMOTE for the stage'); process.exit(2); }
Object.assign(process.env, { ATTACK_TARGET: SERVER, ATTACK_DB: DB });

// A stale dev server on [::1] would answer "localhost" with the wrong database, so both ports must be free on both stacks.
const taken = (host, port) => new Promise(res => {
  const s = connect({ host, port }, () => { s.destroy(); res(true); });
  s.on('error', () => res(false));
});
for (const port of [CLIENT_PORT, 4400]) for (const host of ['127.0.0.1', '::1']) {
  if (await taken(host, port)) { console.error(`REFUSING: something already listens on ${host.includes(':') ? `[${host}]` : host}:${port}; stop it first`); process.exit(1); }
}

const ping = await fetch(`${SERVER}/v1/ping`).catch(() => null);
if (!ping?.ok) { console.error(`Local SpacetimeDB not reachable at ${SERVER}; run \`spacetime start\` first`); process.exit(1); }

// First run on a machine: create the suite's owner login and publish blackbox-attack (keeps data on re-runs).
const hasDb = (await fetch(`${SERVER}/v1/database/${DB}`).catch(() => null))?.ok;
if (!hasDb || !existsSync(new URL('../attack/.env.owner-cli.toml', import.meta.url))) {
  console.log(`publishing ${DB} locally…`);
  const r = spawnSync(process.execPath, ['local-db.mjs'], { cwd: root + 'attack', stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Fresh single-use commander code for the judges' window, minted by the blackbox-attack owner.
const lib = await import('../attack/lib.mjs');
lib.guardTarget();
const code = lib.randomCode();
const b = lib.ownerCall('issue_bootstrap_invite', code);
if (!b.ok) { console.error(`could not mint a commander code: ${b.out.trim().split('\n').pop()}`); process.exit(1); }

// One named incident for the tamper demo, so the judges' RECORD view sits on the record that gets edited.
const STAGE_TITLE = 'Ransomware on payroll hosts (stage)';
const findStage = async () => (await lib.sql(lib.owner(), `SELECT id, title FROM incident WHERE title = '${STAGE_TITLE}'`)).rows?.[0];
let stage = await findStage();
if (!stage) {
  const cmd = await lib.getCommander();
  const w = await lib.write(cmd, STAGE_TITLE, { systems: 'payroll-07, fs01' });
  if (!w.ok) { console.error(`could not create the stage incident: ${w.error}`); process.exit(1); }
  stage = await findStage();
  await lib.call(cmd, 'submit_evidence', [stage.id, 'EDR alert: payroll-07 is encrypting files on \\\\fs01\\payroll']);
}
const recovery = (await import('../attack/demo/2-tamper.mjs')).pendingRecovery(); // same validator as the script

const children = [];
const start = (name, cmd, args, opts) => {
  const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const tag = s => s.toString().split(/\r?\n/).filter(Boolean).forEach(l => console.log(`[${name}] ${l}`));
  c.stdout.on('data', tag); c.stderr.on('data', tag);
  c.on('exit', code => { console.log(`[${name}] exited (${code})`); shutdown(code ?? 1); });
  children.push(c);
};
// Shell-free npm launch: run Vite's own entry with node so Windows needs no .cmd shim.
const vite = fileURLToPath(new URL('../blackbox/client/node_modules/vite/bin/vite.js', import.meta.url));
start('client', process.execPath, [vite, '--port', String(CLIENT_PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: root + 'blackbox/client',
  // Real env vars beat the client's .env files in Vite, so this window cannot drift to blackbox or Maincloud.
  env: { ...process.env, VITE_STDB_URI: 'ws://127.0.0.1:3000', VITE_STDB_DB: DB },
});
start('console', process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  cwd: root, env: { ...process.env, TAMPER_INCIDENT: String(stage.id), TAMPER_INCIDENT_TITLE: STAGE_TITLE },
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));

console.log(`
  ATTACK SEGMENT — everything local, database ${DB} on ${SERVER}
  BLACKBOX (judges' window)  http://127.0.0.1:${CLIENT_PORT}
  COMMANDER CODE             ${code.slice(0, 4)}-${code.slice(4)}   (single use, 30 min)
  ATTACKER CONSOLE           http://127.0.0.1:4400
  TAMPER TARGET              INC-${stage.id} ${STAGE_TITLE}: open it in BLACKBOX, RECORD tab, before attack 2
  Ctrl+C stops both.
`);
if (recovery?.invalid) console.log(`  ! RECOVERY REQUIRED: ${recovery.error}. Attack 2 is blocked: check the audit record by hand, fix it, then delete attack/.tamper-recovery.json.\n`);
else if (recovery) console.log(`  ! DEMO EDIT PENDING: record #${recovery.seq} is still edited. Press RESTORE DEMO EDIT in the console first.\n`);
