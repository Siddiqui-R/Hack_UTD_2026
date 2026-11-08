// Slice 2: invite codes → session identity → role.
import { newIdentity, call, sql, ownerSql, record, expectDenied, signIn, getCommander, randomCode, CODE_ALPHABET, write } from '../lib.mjs';

export const slice = 2;
export const title = 'Invite codes and sessions';

const BAD = 'invalid or expired code';

export async function run() {
  const anon = await newIdentity();
  const probe = await call(anon, 'redeem_invite', [randomCode(), 'probe']);
  if (probe.status === 404) return record('S0', 'slice 2 not published', 'SKIP');

  const cmd = await getCommander();

  // --- Who can mint codes -----------------------------------------------------
  expectDenied('S1', 'non-owner calls issue_bootstrap_invite', await call(anon, 'issue_bootstrap_invite', [randomCode()]));
  expectDenied('S2', 'commander calls issue_bootstrap_invite', await call(cmd, 'issue_bootstrap_invite', [randomCode()]));
  const resp = await signIn('responder');
  expectDenied('S3', 'responder mints a commander invite', await call(resp, 'create_invite', [randomCode(), 'commander']));
  expectDenied('S4', 'outside caller triggers sweep_sessions', await call(anon, 'sweep_sessions', [{ scheduled_id: 0, scheduled_at: { Interval: { __time_duration_micros__: 1 } } }]));

  // --- Redeem abuse ------------------------------------------------------------
  expectDenied('S5', 'forged well-formed code', probe);

  const code = randomCode();
  await call(cmd, 'create_invite', [code, 'responder']);
  // Race: two identities redeem the same code at the same moment.
  const [a, b] = [await newIdentity(), await newIdentity()];
  const [ra, rb] = await Promise.all([call(a, 'redeem_invite', [code, 'race-a']), call(b, 'redeem_invite', [code, 'race-b'])]);
  const winners = [ra, rb].filter(r => r.ok).length;
  record('S6', 'two identities race one code', winners === 1 ? 'PASS' : 'VULN', `${winners} redeemed`);

  expectDenied('S7', 'replay a used code (different formatting)',
    await call(await newIdentity(), 'redeem_invite', [`${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`, 'replay']));

  // Error oracle: every failure should look identical.
  const malformed = await call(anon, 'redeem_invite', ['!!', 'x']);
  const errs = new Set([probe.error, malformed.error].map(e => e.includes(BAD)));
  record('S8', 'failure messages are not an oracle', errs.size === 1 && errs.has(true) ? 'PASS' : 'VULN',
    'forged and malformed give the same error');

  // Weak, hand-picked codes. The server accepts any 8 chars from the alphabet.
  const weak = await call(cmd, 'create_invite', ['AAAAAAAA', 'observer']);
  // "already exists" on a re-run means an earlier run's AAAAAAAA was accepted.
  const weakOk = weak.ok || weak.error.includes('already exists');
  record('S9', 'weak code accepted (AAAAAAAA)', weakOk ? 'VULN' : 'PASS',
    weakOk ? 'guessable codes allowed; bootstrap codes are typed by hand' : weak.error.split('\n')[0]);

  // Brute-force rate from one machine. Informational: how long would one live code survive?
  const N = 200, t0 = performance.now();
  const ids = await Promise.all(Array.from({ length: 10 }, () => newIdentity()));
  await Promise.all(Array.from({ length: N }, (_, i) => call(ids[i % ids.length], 'redeem_invite', [randomCode(), 'bf'])));
  const rate = N / ((performance.now() - t0) / 1000);
  const space = CODE_ALPHABET.length ** 8;
  const hours = space / 2 / rate / 3600;
  record('S10', 'online brute force of one live code', hours > 1 ? 'PASS' : 'VULN',
    `${Math.round(rate)} guesses/s → ~${hours.toExponential(1)} h expected (code lives 0.5 h)`);

  // --- Sessions -------------------------------------------------------------------
  const live = await signIn('responder');
  expectDenied('S11', 'redeem a second code while signed in', await call(live, 'redeem_invite', [randomCode(), 'again']));

  // Expire the session the way the sweep does (delete the row), then replay the token.
  ownerSql(`DELETE FROM session WHERE identity = ${live.identity}`);
  expectDenied('S12', 'replay token after session expiry (write)', await write(live, 'replayed'));
  const t = await sql(live, 'SELECT * FROM team');
  record('S13', 'replay token after session expiry (read team)', t.rows.length ? 'VULN' : 'PASS',
    t.rows.length ? `${t.rows.length} rows still served` : 'no data served');
}
