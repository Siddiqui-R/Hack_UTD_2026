// On-stage attack 2: the attacker owns the database and quietly edits one audit row.
// The hash chain must name the edited row. The row is always restored afterwards so this re-runs.
// TODO(slice 4): also call the module's verifyChain and expect the same brokenAt (and the red bar in the UI).
// TODO(slice 9): rewrite the WHOLE chain consistently, then expect the anchor mismatch to catch it.
import { ownerSql, auditRows, verifyChainIndependent, record, write, signIn, runTag, color as C } from '../lib.mjs';

export const label = 'ATTACK 2';
export const title = 'Rewrite the audit log as the database owner';

const say = s => console.log(`  ${C.dim}${s}${C.reset}`);
const q = s => `'${String(s).replace(/'/g, "''")}'`;

export async function run() {
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

  const target = rows[Math.floor(rows.length / 2)];
  const seq = Number(target.seq);
  say(`attacker (DB owner) rewrites seq ${seq}: action "${target.action}" → "nothing_happened"`);
  try {
    const upd = ownerSql(`UPDATE audit SET action = 'nothing_happened' WHERE seq = ${seq}`);
    if (!upd.ok) return record('A2', 'owner edits audit row', 'SKIP', `UPDATE failed: ${upd.out.trim().slice(0, 120)}`);

    const after = verifyChainIndependent(await auditRows());
    const caught = !after.ok && after.brokenAt === seq;
    record('A2a', 'edited audit row is named by the chain', caught ? 'PASS' : 'VULN',
      caught ? `DETECTED: broken at seq ${seq} (${after.reason})` : `not detected (${JSON.stringify(after)})`);
  } finally {
    ownerSql(`UPDATE audit SET action = ${q(target.action)} WHERE seq = ${seq}`);
  }

  const repaired = verifyChainIndependent(await auditRows());
  record('A2b', 'row restored, chain clean again', repaired.ok ? 'PASS' : 'VULN',
    repaired.ok ? `${repaired.checked} rows verified` : `still broken at seq ${repaired.brokenAt}: repair by hand`);
}
