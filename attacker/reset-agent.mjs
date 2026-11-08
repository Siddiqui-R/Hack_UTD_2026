// Puts the LOCAL judges' screen (127.0.0.1:5180) back to "NO AGENT ENROLLED", so the demo can show a commander
// authorising the agent again with the same identity. Local test database only; never touches production.
//   node attacker/reset-agent.mjs
// The running worker keeps waiting and resumes as soon as it is authorised again.
process.env.ATTACK_TARGET ??= 'http://127.0.0.1:3000';
process.env.ATTACK_DB ??= 'blackbox-attack';
const lib = await import('../attack/lib.mjs');
lib.guardTarget();
// Owner-level cleanup of demo state (no reducer un-enrols an agent). Sessions first, then enrolments.
const list = lib.ownerSql('SELECT identity FROM agent_identity');
if (!list.ok) { console.error('Could not reset. Is the local server running (spacetime start)?'); process.exit(1); }
const ids = [...new Set(list.out.match(/0x[0-9a-f]{64}/g) ?? [])];
for (const id of ids) lib.ownerSql(`DELETE FROM session WHERE identity = ${id}`);
lib.ownerSql('DELETE FROM agent_identity');
console.log(`Agent reset (${ids.length} removed): 5180 now shows NO AGENT ENROLLED.`);
