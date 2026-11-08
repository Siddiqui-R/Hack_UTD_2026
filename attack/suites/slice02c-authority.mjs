// Multi-call authority changes: direct endpoint checks alone miss these paths.
import { call, signIn, newIdentity, randomCode, ownerSql, runTag } from '../lib.mjs';
import { check, denied, ident, must, rows } from '../slice-helpers.mjs';

export const slice = '2c';
export const title = 'Commander lockout chains and authority loss on reauthentication';

export async function run() {
  const attacker = await signIn('commander');
  const peer = await signIn('commander');
  await denied('V10', 'commander cannot demote another commander before revoking them', attacker, 'set_role', [ident(peer), 'observer']);
  const state = await rows(`SELECT * FROM user WHERE identity = ${peer.identity}`);
  check('V11', 'denied commander demotion preserves the target role', state[0]?.role === 'commander');
  await denied('V12', 'demote then revoke cannot bypass peer commander protection', attacker, 'revoke_session', [ident(peer)]);
  const former = await signIn('commander');
  const outstanding = randomCode(), downgrade = randomCode();
  must(await call(former, 'create_invite', [outstanding, 'commander']));
  must(await call(attacker, 'create_invite', [downgrade, 'observer']));
  const expired = ownerSql(`DELETE FROM session WHERE identity = ${former.identity}`);
  if (!expired.ok) throw new Error('could not expire disposable test session');
  must(await call(former, 'redeem_invite', [downgrade, `atk-reauth-${runTag}`]));
  const fresh = await newIdentity();
  await denied('S14', 'former commander invite dies when reauthentication changes their role', fresh, 'redeem_invite', [outstanding, `atk-stale-invite-${runTag}`]);
  check('S15', 'reauthentication applies the reduced role', (await rows(`SELECT * FROM user WHERE identity = ${former.identity}`))[0]?.role === 'observer');
}
