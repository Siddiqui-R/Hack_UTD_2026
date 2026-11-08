// On-stage attack 1: an attacker copies a responder's session token off their laptop,
// waits for the session to expire, then replays it.
import { call, sql, ownerSql, record, signIn, runTag, color as C, write } from '../lib.mjs';

export const label = 'ATTACK 1';
export const title = 'Replay a stolen session token';

const say = s => console.log(`  ${C.dim}${s}${C.reset}`);

export async function run() {
  const victim = await signIn('responder', `Dana ${runTag}`); // unique per run so re-runs survive a unique-name rule
  say(`stolen token: ${victim.token.slice(0, 24)}…`);

  say('fast-forward 15 min: session expires and the sweep removes it');
  ownerSql(`DELETE FROM session WHERE identity = ${victim.identity}`);

  say('attacker replays the token: write to the incident…');
  const w = await write(victim, 'attacker was here');
  record('A1a', 'replayed token writes', w.ok ? 'VULN' : 'PASS', w.ok ? 'ACCEPTED' : `REJECTED: ${w.error}`);

  say('…and read the team roster');
  const r = await sql(victim, 'SELECT * FROM team');
  record('A1b', 'replayed token reads', r.rows.length ? 'VULN' : 'PASS',
    r.rows.length ? `${r.rows.length} rows served` : 'REJECTED: no data served');
}
