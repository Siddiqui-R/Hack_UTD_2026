// LOCAL DEV ONLY: seed a demo incident with two contradicting evidence records and enroll this agent.
// Uses the attack harness's owner/commander helpers, so it only runs against a local server.
import { guardTarget, getCommander, write, call, sql, runTag } from '../../attack/lib.mjs';
import { serviceIdentity } from '../src/db.mjs';

guardTarget();
const cmd = await getCommander();
const title = `Payroll ransomware ${runTag}`;
await write(cmd, title, { severity: 'high', systems: 'fin-db-02, fin-app-01', containment: 'partial' });
const inc = (await sql(cmd, `SELECT id FROM incidents WHERE title = '${title}'`)).rows[0];

const ev = [
  '2026-11-07T03:14:22Z fin-db-02 sshd[4411]: Accepted publickey for svc_backup from 10.4.2.17\n' +
  '2026-11-07T03:16:05Z fin-db-02 vssadmin.exe delete shadows /all /quiet\n' +
  '2026-11-07T03:18:40Z fin-db-02 *.payroll files renamed to *.locked (4,112 files)',
  'EDR summary (fin-app-01): initial access via phishing attachment opened by j.ramirez at 02:51Z;\n' +
  'no lateral movement observed to fin-db-02. svc_backup key last rotated 2026-10-01.',
];
for (const text of ev) await call(cmd, 'submit_evidence', [inc.id, text]);

const me = await serviceIdentity();
const r = await call(cmd, 'enroll_agent', [{ __identity__: me.identity }, inc.id]);
console.log(r.ok ? `enrolled agent ${me.identity.slice(0, 12)}… to incident #${inc.id} "${title}"` : `enroll failed: ${r.error}`);
