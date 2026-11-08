// On-stage attack 2: edit an audit row as DB owner. Needs slice 4 (chain) + slice 9 (anchor).
import { record } from '../lib.mjs';
export const label = 'ATTACK 2';
export const title = 'Rewrite the audit log as the database owner';
export async function run() {
  // TODO(slice 4/9): ownerSql UPDATE one audit row → expect verifyChain brokenAt = that seq.
  // Then recompute the whole chain → expect anchor mismatch. ALWAYS repair afterwards (finally{}),
  // so the attack is re-runnable.
  record('A2', 'tamper audit row', 'SKIP', 'waiting on slices 4 + 9');
}
