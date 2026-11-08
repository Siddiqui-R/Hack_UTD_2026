// Runs ONE existing demo script from attack/demo/ and reports its results as JSON.
// No attack logic lives here — it only imports Rabeet's scripts. Local targets only (guardTarget).
//   node runner.mjs <1-4>      run that demo
//   node runner.mjs restore    undo a pending demo-2 edit via its recovery record, then verify the chain
import { readdir } from 'node:fs/promises';
process.env.ATTACK_EVENTS = '1'; // demo 2 prints @@PHASE lines and waits for "release" on stdin
const n = process.argv[2];
const lib = await import('../attack/lib.mjs');
lib.guardTarget();
const dir = new URL('../attack/demo/', import.meta.url);
const want = n === 'restore' ? '2' : n;
const file = (await readdir(dir)).find(f => f.startsWith(`${want}-`) && f.endsWith('.mjs'));
if (!file) { console.log(`no demo script for ${n}`); process.exit(2); }
const mod = await import(new URL(file, dir));
console.log(n === 'restore' ? '> Restore the demo edit' : `> ${mod.title}`);
let code = 0;
try { await (n === 'restore' ? mod.recover() : mod.run()); }
catch (e) { lib.results.push({ id: file, title: e.message, outcome: 'ERROR' }); console.log(`ERROR ${e.message}`); code = 1; }
console.log('@@RESULT ' + JSON.stringify(lib.results));
process.exit(code); // stdin stays open for "release"; exit explicitly
