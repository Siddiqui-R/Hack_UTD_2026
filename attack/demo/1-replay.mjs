// On-stage attack 1: replay a captured / expired session token. Needs slice 2 (sessions).
import { record } from '../lib.mjs';
export const label = 'ATTACK 1';
export const title = 'Replay a stolen session token';
export async function run() {
  // TODO(slice 2): capture a session, expire/revoke it, replay it against a write reducer,
  // expect "session expired". SpacetimeDB identity tokens alone never expire — the app-level
  // session is what must reject the replay.
  record('A1', 'replay expired session', 'SKIP', 'waiting on slice 2');
}
