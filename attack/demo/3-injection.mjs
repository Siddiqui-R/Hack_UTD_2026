// On-stage attack 3: prompt injection inside evidence. Needs slice 7 (agent service).
import { record } from '../lib.mjs';
export const label = 'ATTACK 3';
export const title = 'Prompt injection hidden in uploaded evidence';
export async function run() {
  // TODO(slice 7): submit payloads from ../injection/payloads.mjs with AGENT_MODE=mock,
  // assert severity unchanged, tasks still created, conflict/injection flagged.
  record('A3', 'evidence prompt injection', 'SKIP', 'waiting on slice 7');
}
