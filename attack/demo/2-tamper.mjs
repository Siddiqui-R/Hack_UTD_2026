// On-stage attack 2: the attacker owns the database and quietly edits one audit row.
// BLACKBOX cannot stop the owner's SQL edit; the hash chain must DETECT it and name the edited row.
// Also checks the module's own verifyChain (slice 4), which drives the red bar in the UI.
// Recovery: before editing, the original value is written to attack/.tamper-recovery.json (gitignored). The file is
// removed only after the row is restored AND the chain verifies, so a killed run can always be undone with recover().
// TAMPER_INCIDENT=<id> edits a row of that incident (the stage points the judges' RECORD view at it).
// ATTACK_EVENTS=1 (set by attacker/runner.mjs) prints @@PHASE lines and holds until "release" on stdin or
// TAMPER_HOLD_MAX_MS (default 30 s); otherwise the edit is held TAMPER_HOLD_MS (default 4 s) for open clients.
// TODO(slice 9): rewrite the WHOLE chain consistently, then expect the anchor mismatch to catch it.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DB, ownerSql, auditRows, verifyChainIndependent, verifyChainRemote, getCommander, record, write, signIn, runTag, color as C } from '../lib.mjs';

export const label = 'ATTACK 2';
export const title = 'Rewrite the audit log as the database owner';

const say = s => console.log(`  ${C.dim}${s}${C.reset}`);
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const EVENTS = process.env.ATTACK_EVENTS === '1';
const phase = (name, data = {}) => { if (EVENTS) console.log('@@PHASE ' + JSON.stringify({ phase: name, ...data })); };
const TAMPERED = 'nothing_happened';
export const RECOVERY_FILE = fileURLToPath(new URL('../.tamper-recovery.json', import.meta.url));

export function pendingRecovery() {
  try { return JSON.parse(fs.readFileSync(RECOVERY_FILE, 'utf8')); } catch { return null; }
}

// Restored only if the row holds its original value again and the whole chain verifies; then the record is cleared.
async function verifyRestored(rec) {
  const rows = await auditRows();
  const row = rows.find(r => Number(r.seq) === rec.seq);
  const chain = verifyChainIndependent(rows);
  const ok = row?.action === rec.original && chain.ok;
  if (ok) fs.rmSync(RECOVERY_FILE, { force: true });
  phase(ok ? 'VERIFIED' : 'RESTORE FAILED', { seq: rec.seq, checked: chain.checked, brokenAt: chain.brokenAt });
  return { ok, chain, row };
}

// Undo exactly the recorded demo edit (Restore demo edit in the console). Never touches a row in any other state.
export async function recover() {
  const rec = pendingRecovery();
  if (!rec) { say('no pending demo edit'); return record('R2', 'no pending demo edit', 'PASS', 'nothing to restore'); }
  if (rec.db !== DB) return record('R2', 'restore demo edit', 'SKIP', `recovery is for database ${rec.db}, not ${DB}`);
  phase('RESTORING', rec);
  say(`restoring record #${rec.seq}: action "${TAMPERED}" → "${rec.original}"`);
  const row = (await auditRows()).find(r => Number(r.seq) === rec.seq);
  if (!row) return record('R2', 'restore demo edit', 'SKIP', `record #${rec.seq} not found`);
  if (row.action === rec.tampered) ownerSql(`UPDATE audit SET action = ${q(rec.original)} WHERE seq = ${rec.seq} AND action = ${q(rec.tampered)}`);
  else if (row.action !== rec.original) return record('R2', 'restore demo edit', 'SKIP', `record #${rec.seq} holds "${row.action}"; not touching it`);
  const v = await verifyRestored(rec);
  record('R2', 'demo edit restored, chain verified', v.ok ? 'PASS' : 'VULN',
    v.ok ? `${v.chain.checked} rows verified` : `still broken at seq ${v.chain.brokenAt}: ${v.chain.reason}`);
}

async function holdForPresenter() {
  if (!EVENTS) {
    const ms = Number(process.env.TAMPER_HOLD_MS ?? 4000);
    if (ms > 0) { say(`holding the edit ${ms / 1000}s so open BLACKBOX windows show INTEGRITY BROKEN…`); await new Promise(r => setTimeout(r, ms)); }
    return;
  }
  const max = Number(process.env.TAMPER_HOLD_MAX_MS ?? 30_000);
  say(`holding the detected edit until the presenter restores it (automatic in ${max / 1000}s)`);
  await new Promise(resolve => {
    const done = () => { clearTimeout(timer); process.stdin.off('data', onData); process.stdin.off('end', done); process.stdin.pause(); resolve(); };
    const onData = d => { if (String(d).includes('release')) done(); };
    const timer = setTimeout(done, max);
    process.stdin.on('data', onData);
    process.stdin.on('end', done); // bridge gone: restore now rather than wait
    process.stdin.resume();
  });
}

export async function run() {
  const pending = pendingRecovery();
  if (pending) return record('A2', 'previous demo edit restored', 'SKIP', `record #${pending.seq} is still edited: use Restore demo edit (recover())`);

  let rows = await auditRows();
  if (rows.length < 3) { // make sure there is history to tamper with
    const cmd = await signIn('commander', `Ops ${runTag}`);
    await write(cmd, 'Ransomware on payroll hosts');
    rows = await auditRows();
  }
  if (rows.length < 3) return record('A2', 'tamper audit row', 'SKIP', `only ${rows.length} audit rows`);

  const before = verifyChainIndependent(rows);
  if (!before.ok) return record('A2', 'chain clean before attack', 'SKIP', `already broken at seq ${before.brokenAt}: ${before.reason}`);
  say(`chain clean: ${before.checked} rows verified`);

  const pinned = process.env.TAMPER_INCIDENT ? rows.filter(r => String(r.incident_id) === String(process.env.TAMPER_INCIDENT)) : [];
  const pool = pinned.length ? pinned : rows;
  const target = pool[Math.floor(pool.length / 2)];
  const seq = Number(target.seq);
  const rec = { db: DB, seq, incidentId: Number(target.incident_id), column: 'action', original: target.action, tampered: TAMPERED, at: new Date().toISOString() };
  fs.writeFileSync(RECOVERY_FILE, JSON.stringify(rec, null, 2), { mode: 0o600 }); // before the edit, so a kill can be undone

  phase('EDITING', rec);
  say(`attacker (DB owner) rewrites record #${seq} of incident ${rec.incidentId}: action "${target.action}" → "${TAMPERED}"`);
  try {
    const upd = ownerSql(`UPDATE audit SET action = ${q(TAMPERED)} WHERE seq = ${seq}`);
    if (!upd.ok) { fs.rmSync(RECOVERY_FILE, { force: true }); return record('A2', 'owner edits audit row', 'SKIP', `UPDATE failed: ${upd.out.trim().slice(0, 120)}`); }
    say('the edit succeeded: the owner can change rows; BLACKBOX has to detect it');

    phase('DETECTION CHECK', { seq });
    const after = verifyChainIndependent(await auditRows());
    const caught = !after.ok && after.brokenAt === seq;
    record('A2a', 'edited audit row is named by the chain', caught ? 'PASS' : 'VULN',
      caught ? `DETECTED: broken at seq ${seq} (${after.reason})` : `not detected (${JSON.stringify(after)})`);
    const mod = await verifyChainRemote(await getCommander());
    const modCaught = mod.called && mod.ok === false && mod.brokenAt === seq;
    if (mod.called) record('A2c', "module's verifyChain names the same row (red bar)", modCaught ? 'PASS' : 'VULN',
      `module: brokenAt ${mod.brokenAt}, ${mod.reason}`);
    phase('DETECTED', { seq, independent: caught, module: modCaught, holdMaxMs: EVENTS ? Number(process.env.TAMPER_HOLD_MAX_MS ?? 30_000) : 0 });
    await holdForPresenter();
  } finally {
    phase('RESTORING', rec);
    ownerSql(`UPDATE audit SET action = ${q(target.action)} WHERE seq = ${seq} AND action = ${q(TAMPERED)}`);
  }

  const v = await verifyRestored(rec);
  record('A2b', 'original value restored, chain verified', v.ok ? 'PASS' : 'VULN',
    v.ok ? `${v.chain.checked} rows verified` : `still broken at seq ${v.chain.brokenAt}: use Restore demo edit`);
}
