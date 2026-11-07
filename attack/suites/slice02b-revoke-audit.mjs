// Slice 2b: session revocation + early audit chain.
import { newIdentity, call, sql, record, expectDenied, signIn, getCommander, randomCode, auditRows, auditHash, owner } from '../lib.mjs';

export const slice = '2b';
export const title = 'Revocation and audit chain';

const GENESIS = '0'.repeat(64);

export async function run() {
  const cmd = await getCommander();
  const probe = await call(cmd, 'revoke_session', [{ __identity__: cmd.identity }]);
  if (probe.status === 404) return record('V0', 'revocation not published', 'SKIP');

  // --- Who can revoke -----------------------------------------------------------
  expectDenied('V1', 'commander revokes themselves', probe);
  const resp = await signIn('responder');
  const victim = await signIn('responder');
  expectDenied('V2', 'responder revokes someone', await call(resp, 'revoke_session', [{ __identity__: victim.identity }]));
  expectDenied('V3', 'outsider revokes someone', await call(await newIdentity(), 'revoke_session', [{ __identity__: victim.identity }]));

  // --- A revoked (stolen) token is dead ---------------------------------------------
  const rv = await call(cmd, 'revoke_session', [{ __identity__: victim.identity }]);
  if (!rv.ok) return record('V4', 'commander revokes a responder', 'VULN', `revoke failed: ${rv.error}`);
  expectDenied('V4', 'revoked token writes', await call(victim, 'add_ping', ['still here']));
  const t = await sql(victim, 'SELECT * FROM team');
  record('V5', 'revoked token reads team', t.rows.length ? 'VULN' : 'PASS', t.rows.length ? `${t.rows.length} rows` : 'no data');

  const fresh = randomCode();
  await call(cmd, 'create_invite', [fresh, 'commander']);
  expectDenied('V6', 'revoked token redeems a valid code', await call(victim, 'redeem_invite', [fresh, 'back again']));
  const realUser = await newIdentity();
  const reuse = await call(realUser, 'redeem_invite', [fresh, 'real person']);
  record('V7', 'code not burned by the revoked attempt', reuse.ok ? 'PASS' : 'VULN', reuse.ok ? 'real user got in' : reuse.error);
  expectDenied('V8', 'un-revoke via set_role', await call(cmd, 'set_role', [{ __identity__: victim.identity }, 'commander']));

  // Lockout: one compromised commander can permanently revoke every other commander.
  const peer = await signIn('commander');
  const lock = await call(cmd, 'revoke_session', [{ __identity__: peer.identity }]);
  record('V9', 'one commander permanently revokes another', lock.ok ? 'VULN' : 'PASS',
    lock.ok ? 'no second approver, no un-revoke → a stolen commander can lock out the team' : lock.error);

  // --- Audit chain ------------------------------------------------------------------
  let rows;
  try { rows = await auditRows(); } catch (e) { return record('C0', 'audit table readable by owner', 'SKIP', e.message); }
  if (!rows.length) return record('C0', 'audit rows exist', 'SKIP', 'no audit table yet');

  const anonAudit = await sql(await newIdentity(), 'SELECT * FROM audit');
  record('C1', 'outsider reads audit table', anonAudit.ok ? 'VULN' : 'PASS', anonAudit.ok ? 'readable' : 'private');

  const gaps = rows.filter((r, i) => Number(r.seq) !== i + 1).length;
  record('C2', 'seq strictly 1..N, no gaps', gaps ? 'VULN' : 'PASS', `${rows.length} rows, ${gaps} out of place`);

  const badLink = rows.findIndex((r, i) => r.prev_hash !== (i ? rows[i - 1].event_hash : GENESIS));
  record('C3', 'every prev_hash links to the row before', badLink < 0 ? 'PASS' : 'VULN', badLink < 0 ? 'linked' : `broken at seq ${rows[badLink].seq}`);

  const badHash = rows.find(r => auditHash(r) !== r.event_hash);
  record('C4', 'independent recompute of every event_hash', badHash ? 'VULN' : 'PASS',
    badHash ? `mismatch at seq ${badHash.seq}` : `${rows.length}/${rows.length} match`);

  const head = (await sql(owner(), 'SELECT * FROM chain_head')).rows[0];
  const last = rows.at(-1);
  record('C5', 'chain_head matches the last row', head?.head_hash === last.event_hash && Number(head?.seq) === Number(last.seq) ? 'PASS' : 'VULN',
    `head seq ${head?.seq}, last seq ${last.seq}`);

  // Exactly one row per successful mutation, zero per failed one.
  const count = async () => (await auditRows()).length;
  const checks = [
    ['C6', 'add_ping writes exactly 1 row', () => call(resp, 'add_ping', ['audit me']), 1],
    ['C7', 'create_invite writes exactly 1 row', () => call(cmd, 'create_invite', [randomCode(), 'observer']), 1],
    ['C8', 'set_role writes exactly 1 row', () => call(cmd, 'set_role', [{ __identity__: resp.identity }, 'observer']), 1],
    ['C9', 'failed call writes 0 rows', () => call(resp, 'add_ping', ['denied now']), 0],
  ];
  for (const [id, label, fn, want] of checks) {
    const before = await count();
    await fn();
    const got = (await count()) - before;
    record(id, label, got === want ? 'PASS' : 'VULN', `${got} row(s)`);
  }
}
