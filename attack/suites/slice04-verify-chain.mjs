// Slice 4: the module's verifyChain. Who may call it, and does it name the right record when
// the database owner edits the audit log? Every edit is restored in finally{} so the suite re-runs.
import { newIdentity, call, ownerSql, record, signIn, getCommander, auditRows, verifyChainIndependent, verifyChainRemote, sql, owner } from '../lib.mjs';

export const slice = '4';
export const title = 'Chain verification';

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const denied = (id, t, r) => record(id, t, r.called ? 'VULN' : 'PASS', r.called ? `served: ${JSON.stringify(r)}` : r.error.split('\n').pop().slice(0, 80));

export async function run() {
  const cmd = await getCommander();
  const probe = await verifyChainRemote(cmd);
  if (!probe.called && probe.status === 404) return record('K0', 'verify_chain not published', 'SKIP');

  // --- Who may verify ---------------------------------------------------------------
  denied('K1', 'outsider calls verify_chain', await verifyChainRemote(await newIdentity()));
  const gone = await signIn('responder');
  await call(cmd, 'revoke_session', [{ __identity__: gone.identity }]);
  denied('K2', 'revoked user calls verify_chain', await verifyChainRemote(gone));
  const stale = await signIn('observer');
  ownerSql(`DELETE FROM session WHERE identity = ${stale.identity}`);
  denied('K3', 'expired session calls verify_chain', await verifyChainRemote(stale));

  // --- Clean chain ------------------------------------------------------------------
  const rows = await auditRows();
  const mine = verifyChainIndependent(rows);
  const theirs = await verifyChainRemote(cmd);
  record('K4', 'clean chain: module agrees with independent verifier',
    theirs.ok === mine.ok && theirs.checked === mine.checked ? 'PASS' : 'VULN',
    `module ok=${theirs.ok} checked=${theirs.checked}, independent ok=${mine.ok} checked=${mine.checked}`);
  record('K5', 'verifying writes no audit rows', (await auditRows()).length === rows.length ? 'PASS' : 'VULN');
  if (!mine.ok || rows.length < 3) return record('K6', 'tamper checks', 'SKIP', 'chain not clean or too short');

  // --- Owner edits ------------------------------------------------------------------
  const target = rows[Math.floor(rows.length / 2)], seq = Number(target.seq);
  const tamper = async (id, t, edit, restore, expectAt, expectReason) => {
    try {
      const e = ownerSql(edit);
      if (!e.ok) return record(id, t, 'SKIP', e.out.trim().slice(0, 100));
      const r = await verifyChainRemote(cmd);
      const hit = r.ok === false && r.brokenAt === expectAt && r.reason === expectReason;
      record(id, t, hit ? 'PASS' : 'VULN', hit ? `DETECTED at seq ${r.brokenAt}: ${r.reason}` : `got ${JSON.stringify(r)}`);
    } finally { ownerSql(restore); }
  };
  await tamper('K6', 'owner edits an audit payload',
    `UPDATE audit SET payload_json = '{"tampered":true}' WHERE seq = ${seq}`,
    `UPDATE audit SET payload_json = ${q(target.payload_json)} WHERE seq = ${seq}`, seq, 'event hash mismatch');
  await tamper('K7', 'owner rewrites the actor on a row',
    `UPDATE audit SET actor = 'someone-else' WHERE seq = ${seq}`,
    `UPDATE audit SET actor = ${q(target.actor)} WHERE seq = ${seq}`, seq, 'event hash mismatch');
  await tamper('K8', 'owner breaks a prev_hash link',
    `UPDATE audit SET prev_hash = '${'f'.repeat(64)}' WHERE seq = ${seq}`,
    `UPDATE audit SET prev_hash = ${q(target.prev_hash)} WHERE seq = ${seq}`, seq, 'previous hash mismatch');
  const head = (await sql(owner(), 'SELECT * FROM chain_head')).rows[0];
  if (head) await tamper('K9', 'owner corrupts chain_head',
    `UPDATE chain_head SET head_hash = '${'0'.repeat(64)}' WHERE id = 0`,
    `UPDATE chain_head SET head_hash = ${q(head.head_hash)} WHERE id = 0`, Number(head.seq), 'chain head hash mismatch');

  const after = await verifyChainRemote(cmd);
  record('K10', 'all edits restored, module reports clean', after.ok ? 'PASS' : 'VULN',
    after.ok ? `${after.checked} rows` : `still broken at seq ${after.brokenAt}: repair by hand`);
}
