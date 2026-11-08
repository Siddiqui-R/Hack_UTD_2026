// Agent enrolment from the UI (813c13f) and the read-only agent_status view.
// The UI box only calls enroll_agent, so the server-side rules are what must hold.
import { getCommander, signIn, newIdentity, enrollAgent, call, sql, ownerSql, owner } from '../lib.mjs';
import { incident, check, denied, must, ident } from '../slice-helpers.mjs';
export const slice = '11/enrol';
export const title = 'Agent enrolment boundaries and agent_status visibility';

export async function run() {
  const cmd = await getCommander(), resp = await signIn('responder'), obs = await signIn('observer');
  const home = await incident('enrol'), target = await newIdentity();

  await denied('E-observer', 'observer cannot enrol an agent', obs, 'enroll_agent', [ident(target), home.id]);
  await denied('E-responder', 'responder cannot enrol an agent', resp, 'enroll_agent', [ident(target), home.id]);
  await denied('E-outsider', 'outsider cannot enrol an agent', await newIdentity(), 'enroll_agent', [ident(target), home.id]);
  await denied('E-human', 'a registered human cannot be enrolled as the agent', cmd, 'enroll_agent', [ident(resp), home.id]);
  const own = owner();
  if (own.identity) await denied('E-owner', 'the database owner cannot be enrolled as the agent', cmd, 'enroll_agent', [ident(own), home.id]);
  const stale = await enrollAgent(home.id);
  must(await call(cmd, 'revoke_session', [ident(stale)]));
  await denied('E-revoked', 'a revoked agent identity cannot be re-enrolled', cmd, 'enroll_agent', [ident(stale), home.id]);

  // agent_status: identity + incident + session flags, for signed-in humans only.
  const live = await enrollAgent(home.id);
  const hex = live.identity.replace(/^0x/, '').toLowerCase();
  const seen = async who => { const r = await sql(who, 'SELECT * FROM agent_status'); return r.ok ? r.rows : []; };
  const lists = rows => rows.some(r => JSON.stringify(r).toLowerCase().includes(hex));
  check('E-status-commander', 'commander sees the newly enrolled agent', lists(await seen(cmd)));
  check('E-status-agent', 'agent identity sees nothing in agent_status', (await seen(live)).length === 0);
  check('E-status-outsider', 'outsider sees nothing in agent_status', (await seen(await newIdentity())).length === 0);
  const lapsed = await signIn('responder');
  must(ownerSql(`DELETE FROM session WHERE identity = ${lapsed.identity}`));
  check('E-status-lapsed', 'human whose session was swept sees nothing', (await seen(lapsed)).length === 0);
  const revoked = await signIn('responder');
  must(await call(cmd, 'revoke_session', [ident(revoked)]));
  check('E-status-revoked', 'revoked human sees nothing in agent_status', (await seen(revoked)).length === 0);
}
