// Slice 1: users + roles + ctx.sender checks. (Users are created through slice 2 invites.)
import { newIdentity, call, sql, ownerSql, record, expectDenied, signIn, getCommander, runTag, write } from '../lib.mjs';

export const slice = 1;
export const title = 'Users, roles, ctx.sender checks';

export async function run() {
  const anon = await newIdentity();
  const probe = await write(anon, 'probe');
  if (probe.status === 404) return record('R0', 'slice 1 not published', 'SKIP');

  // --- Unregistered caller -------------------------------------------------
  expectDenied('R1', 'unregistered caller writes (create_incident)', probe);
  expectDenied('R2', 'unregistered caller changes a role (set_role)',
    await call(anon, 'set_role', [{ __identity__: anon.identity }, 'commander']));

  const priv = await sql(anon, 'SELECT * FROM user');
  record('R3', 'read private `user` table directly', priv.ok ? 'VULN' : 'PASS',
    priv.ok ? `${priv.rows.length} rows leaked` : 'table is private');

  const teamAnon = await sql(anon, 'SELECT * FROM team');
  record('R4', 'unregistered caller reads `team` view', teamAnon.rows.length ? 'VULN' : 'PASS',
    teamAnon.rows.length ? `${teamAnon.rows.length} members leaked` : 'empty for unregistered');

  // R5 (first registrant becomes commander) was fixed in slice 2: `register` no longer exists.
  const reg = await call(await newIdentity(), 'register', ['atk-first']);
  record('R5', 'stranger self-registers (old `register` reducer)', reg.ok ? 'VULN' : 'PASS',
    reg.ok ? 'register still exists' : 'reducer removed');

  // --- Signed-in observer ---------------------------------------------------
  const cmd = await getCommander();
  const obs = await signIn('observer');
  expectDenied('R6', 'observer writes (create_incident)', await write(obs, 'observer write'));
  expectDenied('R7', 'observer self-promotes to commander',
    await call(obs, 'set_role', [{ __identity__: obs.identity }, 'commander']));
  expectDenied('R8', 'observer demotes the commander',
    await call(obs, 'set_role', [{ __identity__: cmd.identity }, 'observer']));
  expectDenied('R9', 'bogus role string',
    await call(cmd, 'set_role', [{ __identity__: obs.identity }, 'superadmin']));
  expectDenied('R10', 'commander changes own role',
    await call(cmd, 'set_role', [{ __identity__: cmd.identity }, 'observer']));

  // --- Display-name impersonation ------------------------------------------
  let dupe = null;
  try { dupe = await signIn('observer', obs.name); } catch { /* rejected */ }
  record('R11', 'duplicate display name (impersonation)', dupe ? 'VULN' : 'PASS',
    dupe ? 'two users now share one name' : 'rejected');

  let bidi = null;
  try { bidi = await signIn('observer', `atk-‮redna​mmoc-${runTag}`); } catch { /* rejected */ }
  record('R12', 'bidi-override / zero-width chars in name', bidi ? 'VULN' : 'PASS',
    bidi ? 'U+202E / U+200B stored; can render as a fake name' : 'rejected');

  // --- Duress flag visibility -----------------------------------------------
  // Owner flips a victim's duress flag, then we check who can see it. Always restored after.
  const victim = await signIn('responder');
  const set = ownerSql(`UPDATE user SET is_duressed = true WHERE display_name = '${victim.name}'`);
  if (!set.ok) {
    record('R13', 'duress flag hidden from the coerced user', 'SKIP', 'owner SQL unavailable');
    record('R14', 'duress flag hidden from observers', 'SKIP', 'owner SQL unavailable');
    return;
  }
  try {
    const own = await sql(victim, `SELECT flagged FROM team WHERE display_name = '${victim.name}'`);
    record('R13', 'duress flag hidden from the coerced user', own.rows[0]?.flagged === false ? 'PASS' : 'VULN',
      `victim sees flagged=${own.rows[0]?.flagged}`);
    const seen = await sql(obs, `SELECT flagged FROM team WHERE display_name = '${victim.name}'`);
    record('R14', 'duress flag hidden from observers', seen.rows[0]?.flagged ? 'VULN' : 'PASS',
      seen.rows[0]?.flagged ? 'any observer sees FLAGGED' : 'hidden');
    // Guard against over-fixing R14: commanders must still see it, or the feature is useless.
    const cmdView = await sql(cmd, `SELECT flagged FROM team WHERE display_name = '${victim.name}'`);
    record('R15', 'commander still sees the duress flag', cmdView.rows[0]?.flagged ? 'PASS' : 'VULN',
      cmdView.rows[0]?.flagged ? 'visible to commander' : 'hidden from commanders too; duress is useless');
  } finally {
    ownerSql(`UPDATE user SET is_duressed = false WHERE display_name = '${victim.name}'`);
  }
}
