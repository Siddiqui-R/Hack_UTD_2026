// Runs ONE existing demo script from attack/demo/ and reports its results as JSON.
// No attack logic lives here — it only imports Rabeet's scripts. Local targets only (guardTarget).
import { readdir } from 'node:fs/promises';
const n = process.argv[2];
const lib = await import('../attack/lib.mjs');
lib.guardTarget();
const dir = new URL('../attack/demo/', import.meta.url);
const file = (await readdir(dir)).find(f => f.startsWith(`${n}-`) && f.endsWith('.mjs'));
if (!file) { console.log(`no demo script for ${n}`); process.exit(2); }
const mod = await import(new URL(file, dir));
console.log(`> ${mod.title}`);
try { await mod.run(); }
catch (e) { lib.results.push({ id: file, title: e.message, outcome: 'ERROR' }); console.log(`ERROR ${e.message}`); }
console.log('@@RESULT ' + JSON.stringify(lib.results));
