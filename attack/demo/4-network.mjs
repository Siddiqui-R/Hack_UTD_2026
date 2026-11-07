// On-stage attack 4: kill one device's network; the other keeps working and resyncs.
import { record } from '../lib.mjs';
export const label = 'ATTACK 4';
export const title = 'Cut the network on one device';
export async function run() {
  // TODO: Playwright (ask Sensei before adding it) — two browser contexts, setOffline(true) on one,
  // write from the other, setOffline(false), assert the first resyncs.
  record('A4', 'network cut + resync', 'SKIP', 'needs Playwright approval');
}
