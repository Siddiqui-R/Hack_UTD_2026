// Fresh start for the LOCAL demo database (blackbox-attack): wipes every incident, user, task and agent enrolment
// left by earlier runs, recreates the stage incident and prints a new login code. Never touches production.
//   node attacker/reset.mjs
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.env.ATTACK_TARGET ??= 'http://127.0.0.1:3000';
process.env.ATTACK_DB ??= 'blackbox-attack';
const lib = await import('../attack/lib.mjs');
lib.guardTarget();
if (process.env.ATTACK_DB !== 'blackbox-attack') { console.error('REFUSING: reset only wipes the local blackbox-attack database'); process.exit(2); }
const { pendingRecovery } = await import('../attack/demo/2-tamper.mjs');
if (pendingRecovery()) { console.error('REFUSING: a tamper demo edit is still pending. Press RESTORE DEMO EDIT in the portal first.'); process.exit(1); }

const root = fileURLToPath(new URL('..', import.meta.url));
const config = fileURLToPath(new URL('../attack/.env.owner-cli.toml', import.meta.url));
if (!existsSync(config)) { console.error('No local owner login yet: run `node attacker/stage.mjs` once first.'); process.exit(1); }
console.log('Wiping the local demo database…');
const r = spawnSync('spacetime', ['--config-path', config, 'publish', 'blackbox-attack', '--server', 'local', '--module-path', root + 'blackbox/spacetimedb',
  '--no-config', '--yes', '--delete-data=always'], { encoding: 'utf8' });
if (r.status !== 0) { console.error((r.stderr || r.stdout || 'publish failed').trim().split('\n').slice(-3).join('\n')); process.exit(1); }

// Same stage incident stage.mjs creates, so the tamper target is ready again.
const title = 'Ransomware on payroll hosts (stage)';
const cmd = await lib.getCommander();
const w = await lib.write(cmd, title, { systems: 'payroll-07, fs01' });
if (!w.ok) { console.error(`Could not recreate the stage incident: ${w.error}`); process.exit(1); }
const inc = (await lib.sql(lib.owner(), `SELECT id FROM incident WHERE title = '${title}'`)).rows[0];
await lib.call(cmd, 'submit_evidence', [inc.id, 'EDR alert: payroll-07 is encrypting files on \\\\fs01\\payroll']);

const code = lib.randomCode();
lib.ownerCall('issue_bootstrap_invite', code);
console.log(`Fresh start. Only INC-${inc.id} exists, no agent enrolled.`);
if (String(inc.id) !== '1') console.log('The stage incident got a new number: restart `node attacker/stage.mjs` so attack 2 targets it.');
console.log(`Login code for 127.0.0.1:5180 (refresh the page first): ${code.slice(0, 4)}-${code.slice(4)}`);
