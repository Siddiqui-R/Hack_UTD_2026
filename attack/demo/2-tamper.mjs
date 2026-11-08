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
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DB, ownerSql, auditRows, auditHash, verifyChainIndependent, verifyChainRemote, getCommander, record, write, signIn, runTag, color as C } from '../lib.mjs';

export const label = 'ATTACK 2';
export const title = 'Rewrite the audit log as the database owner';

const say = s => console.log(`  ${C.dim}${s}${C.reset}`);
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const EVENTS = process.env.ATTACK_EVENTS === '1';
// The bridge passes a per-run secret so no other output line can forge a phase marker.
const MARK = process.env.DEMO_MARKER ?? 'local';
const phase = (name, data = {}) => { if (EVENTS) console.log(`@@PHASE:${MARK} ` + JSON.stringify({ phase: name, ...data })); };
const TAMPERED = 'nothing_happened';
export const RECOVERY_FILE = fileURLToPath(new URL('../.tamper-recovery.json', import.meta.url));

// null only when no file exists. An unreadable, malformed or invalid file is { invalid: true, error } and must block
// tampering: it may stand for an edit nobody can undo automatically. The file is never deleted here.
export function pendingRecovery() {
  let text;
  try { text = fs.readFileSync(RECOVERY_FILE, 'utf8'); }
  catch (e) { return e.code === 'ENOENT' ? null : { invalid: true, error: `recovery file unreadable (${e.code ?? e.message})` }; }
  let rec;
  try { rec = JSON.parse(text); } catch { return { invalid: true, error: 'recovery file is not valid JSON' }; }
  const ok = rec && typeof rec === 'object' && typeof rec.db === 'string' && Number.isInteger(rec.seq) && rec.seq > 0
    && rec.column === 'action' && typeof rec.original === 'string' && rec.tampered === TAMPERED;
  return ok ? rec : { invalid: true, error: 'recovery file is missing or has wrong db/seq/column/original/tampered fields' };
}
const recoveryHelp = r => `${r.error}: check that audit record's action by hand (owner SQL), fix it, then delete attack/.tamper-recovery.json`;

// Restored only if the row holds its original value again and the whole chain verifies; then the record is cleared.
async function verifyRestored(rec) {
  const rows = await auditRows();
  const row = rows.find(r => Number(r.seq) === rec.seq);
  const chain = verifyChainIndependent(rows);
  const ok = row?.action === rec.original && chain.ok;
  // Delete only our own record: another run's file (or a hand-made one) is never removed here.
  const current = pendingRecovery();
  if (ok && current && !current.invalid && current.token === rec.token) fs.rmSync(RECOVERY_FILE, { force: true });
  phase(ok ? 'VERIFIED' : 'RESTORE FAILED', { seq: rec.seq, checked: chain.checked, brokenAt: chain.brokenAt });
  return { ok, chain, row };
}

// Undo exactly the recorded demo edit (Restore demo edit in the console). Never touches a row in any other state.
export async function recover() {
  const rec = pendingRecovery();
  if (!rec) { say('no pending demo edit'); return record('R2', 'no pending demo edit', 'PASS', 'nothing to restore'); }
  if (rec.invalid) return record('R2', 'RECOVERY REQUIRED', 'SKIP', recoveryHelp(rec));
  if (rec.db !== DB) return record('R2', 'restore demo edit', 'SKIP', `recovery is for database ${rec.db}, not ${DB}`);
  phase('RESTORING', rec);
  say(`restoring record #${rec.seq}: action "${TAMPERED}" → "${rec.original}"`);
  const row = (await auditRows()).find(r => Number(r.seq) === rec.seq);
  if (!row) return record('R2', 'restore demo edit', 'SKIP', `record #${rec.seq} not found`);
  // A recovery file can be stale or hand-edited: only write a value that makes the record's stored hash match again.
  if (row.action === rec.tampered && auditHash({ ...row, action: rec.original }) !== row.event_hash)
    return record('R2', 'restore demo edit', 'SKIP', `"${rec.original}" does not reproduce record #${rec.seq}'s stored hash; recovery file is wrong, not touching the record`);
  if (row.action === rec.tampered) ownerSql(`UPDATE audit SET action = ${q(rec.original)} WHERE seq = ${rec.seq} AND action = ${q(rec.tampered)}`);
  else if (row.action !== rec.original) return record('R2', 'restore demo edit', 'SKIP', `record #${rec.seq} holds "${row.action}"; not touching it`);
  const v = await verifyRestored(rec);
  record('R2', 'demo edit restored, chain verified', v.ok ? 'PASS' : 'VULN',
    v.ok ? `${v.chain.checked} rows verified` : `still broken at seq ${v.chain.brokenAt}: ${v.chain.reason}`);
}

// Presenter hold limit, clamped to 1-120 s so a bad env value can neither skip the hold nor leave the edit up.
const holdMax = () => Math.min(120_000, Math.max(1_000, Number(process.env.TAMPER_HOLD_MAX_MS) || 30_000));

// Set while an edit is live: ends the hold early so Ctrl+C / window close / bridge loss restores before exiting.
let endHold = () => {};

async function holdForPresenter() {
  if (!EVENTS) {
    const ms = Number(process.env.TAMPER_HOLD_MS ?? 4000);
    if (ms > 0) {
      say(`holding the edit ${ms / 1000}s so open BLACKBOX windows show INTEGRITY BROKEN…`);
      await new Promise(r => { const t = setTimeout(r, ms); endHold = () => { clearTimeout(t); r(); }; });
    }
    return;
  }
  const max = holdMax();
  say(`holding the detected edit until the presenter restores it (automatic in ${max / 1000}s)`);
  await new Promise(resolve => {
    const done = () => { endHold = () => {}; clearTimeout(timer); process.stdin.off('data', onData); process.stdin.off('end', done); process.stdin.pause(); resolve(); };
    const onData = d => { if (String(d).includes('release')) done(); };
    const timer = setTimeout(done, max);
    endHold = done;
    process.stdin.on('data', onData);
    process.stdin.on('end', done); // bridge gone: restore now rather than wait
    process.stdin.resume();
  });
}

export async function run() {
  const pending = pendingRecovery();
  if (pending?.invalid) return record('A2', 'RECOVERY REQUIRED', 'SKIP', recoveryHelp(pending));
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

  // An explicit target is a promise to the audience: never fall back to another incident's record.
  const wanted = process.env.TAMPER_INCIDENT;
  const pool = wanted ? rows.filter(r => String(r.incident_id) === String(wanted)) : rows;
  if (!pool.length) return record('A2', 'tamper target', 'SKIP', `TAMPER_INCIDENT=${wanted} has no audit record to edit; nothing was changed`);
  const target = pool[Math.floor(pool.length / 2)];
  const seq = Number(target.seq);
  const rec = { db: DB, seq, incidentId: Number(target.incident_id), column: 'action', original: target.action, tampered: TAMPERED, at: new Date().toISOString(), token: randomBytes(8).toString('hex') };
  // Before the edit, so a kill can be undone. Write-then-rename: a crash never leaves a half-written record.
  // Exclusive: link() fails if a record already exists, so two tamper runs can never share or overwrite one.
  const tmp = `${RECOVERY_FILE}.${process.pid}.${rec.token}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2), { mode: 0o600 });
  try { fs.linkSync(tmp, RECOVERY_FILE); }
  catch (e) { if (e.code === 'EEXIST') return record('A2', 'tamper lock', 'SKIP', 'another tamper run holds an edit (recovery file exists); nothing was changed'); throw e; }
  finally { fs.rmSync(tmp, { force: true }); }
  // While the row is edited, an interrupt ends the hold instead of killing the process, so finally restores it.
  const onSignal = () => { say('interrupted: restoring the edit before exiting'); endHold(); };
  const signals = ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM'];
  for (const sig of signals) process.on(sig, onSignal);
  let edited = false;

  phase('EDITING', rec);
  say(`attacker (DB owner) rewrites record #${seq} of incident ${rec.incidentId}: action "${target.action}" → "${TAMPERED}"`);
  try {
    const upd = ownerSql(`UPDATE audit SET action = ${q(TAMPERED)} WHERE seq = ${seq}`);
    if (!upd.ok) { fs.rmSync(RECOVERY_FILE, { force: true }); for (const sig of signals) process.off(sig, onSignal); return record('A2', 'owner edits audit row', 'SKIP', `UPDATE failed: ${upd.out.trim().slice(0, 120)}`); }
    edited = true;
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
    // Only a detection both verifiers agree on is held for the audience; anything else restores at once.
    if (caught && modCaught) {
      phase('DETECTED', { seq, holdMaxMs: EVENTS ? holdMax() : 0 });
      await holdForPresenter();
    } else if (!mod.called) {
      phase('INCOMPLETE', { seq, reason: `module verifyChain unavailable (${mod.status ?? ''} ${mod.error ?? ''})`.trim() });
    } else {
      phase('DETECTION FAILED', { seq, independent: caught, module: modCaught });
    }
  } finally {
    if (edited) {
      phase('RESTORING', rec);
      ownerSql(`UPDATE audit SET action = ${q(target.action)} WHERE seq = ${seq} AND action = ${q(TAMPERED)}`);
    }
  }

  const v = await verifyRestored(rec);
  for (const sig of signals) process.off(sig, onSignal);
  record('A2b', 'original value restored, chain verified', v.ok ? 'PASS' : 'VULN',
    v.ok ? `${v.chain.checked} rows verified` : `still broken at seq ${v.chain.brokenAt}: use Restore demo edit`);
}
