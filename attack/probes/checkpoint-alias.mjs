// Optional local-only reproduction; owned anchor-store implementation awaits its owner's fix.
import { guardTarget, results } from '../lib.mjs';
guardTarget();
process.env.BLACKBOX_PROBE_CHECKPOINT_ALIAS = '1';
await (await import('../suites/slice09-anchor-store.mjs')).run();
process.exitCode = results.some(r => r.outcome === 'VULN' || r.outcome === 'ERROR') ? 1 : 0;
