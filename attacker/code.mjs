// Prints a fresh single-use commander code for the LOCAL judges' screen (127.0.0.1:5180). Nothing else.
//   node attacker/code.mjs
// Old codes simply expire after 30 minutes (or once used); each run gives a new one.
process.env.ATTACK_TARGET ??= 'http://127.0.0.1:3000';
process.env.ATTACK_DB ??= 'blackbox-attack';
const lib = await import('../attack/lib.mjs');
lib.guardTarget();
const code = lib.randomCode();
const r = lib.ownerCall('issue_bootstrap_invite', code);
if (!r.ok) { console.error('Could not make a code. Is the local server running (spacetime start)?'); process.exit(1); }
console.log(`${code.slice(0, 4)}-${code.slice(4)}`);
