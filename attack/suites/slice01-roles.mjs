// Slice 1: users + roles + ctx.sender checks.
import { newIdentity, call, sql, ownerSql, record, expectDenied, runTag } from '../lib.mjs';

export const slice = 1;
export const title = 'Users, roles, ctx.sender checks';

export async function run() {
  // Precondition probe: if `register` doesn't exist, the slice hasn't been published.
  const anon = await newIdentity();
  const probe = await call(anon, 'add_ping', ['probe']);
  if (probe.status === 404) return record('R0', 'slice 1 not published', 'SKIP');

  // --- Unregistered caller -------------------------------------------------
  expectDenied('R1', 'unregistered caller writes (add_ping)', probe);
  expectDenied('R2', 'unregistered caller changes a role (set_role)',
    await call(anon, 'set_role', [{ __identity__: anon.identity }, 'commander']));

  const priv = await sql(anon, 'SELECT * FROM user');
  record('R3', 'read private `user` table directly', priv.ok ? 'VULN' : 'PASS',
    priv.ok ? `${priv.rows.length} rows leaked` : 'table is private');

  const teamAnon = await sql(anon, 'SELECT * FROM team');
  record('R4', 'unregistered caller reads `team` view', teamAnon.rows.length ? 'VULN' : 'PASS',
    teamAnon.rows.length ? `${teamAnon.rows.length} members leaked` : 'empty for unregistered');

  // --- Bootstrap: whoever registers first on an empty DB becomes commander ---
  const empty = (ownerSql('SELECT * FROM user').out.match(/^\s*0x/gm) ?? []).length === 0;
  const first = await newIdentity();
  await call(first, 'register', [`atk-first-${runTag}`]);
  if (empty) {
    const v = await sql(first, `SELECT role FROM team WHERE display_name = 'atk-first-${runTag}'`);
    record('R5', 'anonymous stranger registers first → commander', v.rows[0]?.role === 'commander' ? 'VULN' : 'PASS',
      `role=${v.rows[0]?.role ?? '?'} (slice 2 invite codes should close this)`);
  } else {
    record('R5', 'first-registrant-becomes-commander', 'SKIP', 'DB not empty; republish with --delete-data to test');
  }

  // --- Registered observer --------------------------------------------------
  const obs = await newIdentity();
  await call(obs, 'register', [`atk-obs-${runTag}`]);
  expectDenied('R6', 'observer writes (add_ping)', await call(obs, 'add_ping', ['observer write']));
  expectDenied('R7', 'observer self-promotes to commander',
    await call(obs, 'set_role', [{ __identity__: obs.identity }, 'commander']));
  expectDenied('R8', 'observer demotes another user',
    await call(obs, 'set_role', [{ __identity__: first.identity }, 'observer']));
  expectDenied('R9', 'bogus role string',
    await call(obs, 'set_role', [{ __identity__: first.identity }, 'superadmin']));
  expectDenied('R10', 'register twice with same identity', await call(obs, 'register', ['again']));

  // --- Display-name impersonation ------------------------------------------
  const dupe = await newIdentity();
  const d = await call(dupe, 'register', [`atk-obs-${runTag}`]);
  record('R11', 'duplicate display name (impersonation)', d.ok ? 'VULN' : 'PASS',
    d.ok ? 'two users now share one name' : 'rejected');

  const bidi = await newIdentity();
  const b = await call(bidi, 'register', [`atk-‮redna​mmoc-${runTag}`]);
  record('R12', 'bidi-override / zero-width chars in name', b.ok ? 'VULN' : 'PASS',
    b.ok ? 'U+202E / U+200B stored; can render as a fake name' : 'rejected');

  // --- Duress flag visibility -----------------------------------------------
  // Owner flips a victim's duress flag, then we check who can see it. Always restored after.
  const victim = await newIdentity();
  const vname = `atk-victim-${runTag}`;
  await call(victim, 'register', [vname]);
  const set = ownerSql(`UPDATE user SET is_duressed = true WHERE display_name = '${vname}'`);
  if (!set.ok) {
    record('R13', 'duress flag hidden from victim', 'SKIP', 'owner SQL unavailable');
    record('R14', 'duress flag hidden from observers', 'SKIP', 'owner SQL unavailable');
    return;
  }
  try {
    const own = await sql(victim, `SELECT flagged FROM team WHERE display_name = '${vname}'`);
    record('R13', 'duress flag hidden from the coerced user', own.rows[0]?.flagged === false ? 'PASS' : 'VULN',
      `victim sees flagged=${own.rows[0]?.flagged}`);
    const seen = await sql(obs, `SELECT flagged FROM team WHERE display_name = '${vname}'`);
    record('R14', 'duress flag hidden from observers', seen.rows[0]?.flagged ? 'VULN' : 'PASS',
      seen.rows[0]?.flagged ? 'any registered observer (incl. self-registered strangers) sees FLAGGED' : 'hidden');
  } finally {
    ownerSql(`UPDATE user SET is_duressed = false WHERE display_name = '${vname}'`);
  }
}
