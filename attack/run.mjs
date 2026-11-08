// BLACKBOX attack runner.
//   npm run attack        → every slice's regression attacks (the security test suite)
//   npm run attack:demo   → the four on-stage attacks only
// Exit code 1 if any attack succeeded (VULN), so it can gate a push.
import { readdir } from 'node:fs/promises';
import { guardTarget, TARGET, DB, results, banner, color as C } from './lib.mjs';

guardTarget();
const demo = process.argv.includes('--demo');
const dir = demo ? 'demo' : 'suites';

console.log(`${C.bold}BLACKBOX ATTACK${C.reset}  target=${TARGET}  db=${DB}  mode=${demo ? 'demo' : 'full'}`);

const files = (await readdir(new URL(`./${dir}/`, import.meta.url))).filter(f => f.endsWith('.mjs')).sort();
for (const f of files) {
  const mod = await import(`./${dir}/${f}`);
  banner(`${mod.label ?? `SLICE ${mod.slice}`} · ${mod.title}`);
  try {
    await mod.run();
  } catch (err) {
    console.log(`  ${C.red}ERROR${C.reset}  ${err.message}`);
    results.push({ id: f, outcome: 'ERROR', title: err.message });
  }
}

const count = k => results.filter(r => r.outcome === k).length;
const vuln = count('VULN') + count('ERROR');
console.log(`\n${C.bold}${count('PASS')} held · ${vuln ? C.red : ''}${count('VULN')} succeeded${C.reset}${C.bold} · ${count('SKIP')} skipped · ${count('ERROR')} errors${C.reset}`);
process.exit(vuln ? 1 : 0);
