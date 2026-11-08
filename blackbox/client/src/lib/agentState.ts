import type { Tone } from './vocab';

type AgentRow = { identity: { toHexString(): string }; incidentId: bigint; sessionActive: boolean; revoked: boolean };
type RunRow = { id: bigint; incidentId: bigint; status: string };

export type AgentState = { label: string; tone: Tone; needsEnrol: boolean };

// One source of truth for the chrome label and the INVESTIGATE panel.
// "Enrolled" means the service identity has a live session; it does not prove the worker
// process is polling (worker reads do not extend the session), so the label never says "online".
export function agentStateFor(incidentId: bigint | undefined, agents: readonly AgentRow[], runs: readonly RunRow[]): AgentState {
  if (incidentId === undefined) return { label: 'SELECT AN INCIDENT', tone: { color: 'var(--color-text-2)', glyph: '○' }, needsEnrol: false };
  const running = runs.find(r => r.incidentId === incidentId && r.status === 'running');
  if (running) return { label: `INVESTIGATING · RUN #${running.id}`, tone: { color: 'var(--color-ok)', glyph: '●' }, needsEnrol: false };
  const mine = agents.filter(a => a.incidentId === incidentId && !a.revoked);
  if (mine.some(a => a.sessionActive)) return { label: 'AGENT ACCESS ACTIVE', tone: { color: 'var(--color-ok)', glyph: '●' }, needsEnrol: false };
  if (mine.length) return { label: 'AGENT ACCESS EXPIRED · RENEW', tone: { color: 'var(--color-medium)', glyph: '▲' }, needsEnrol: true };
  if (agents.some(a => a.incidentId === incidentId && a.revoked)) return { label: 'AGENT ACCESS REMOVED', tone: { color: 'var(--color-critical)', glyph: '✕' }, needsEnrol: true };
  return { label: 'AGENT SETUP NEEDED', tone: { color: 'var(--color-text-2)', glyph: '○' }, needsEnrol: true };
}

// Accepts the worker's printed line, a bare 64-hex identity, or a 0x-prefixed one.
export function parseIdentityHex(input: string): string | null {
  const m = /(?:0x)?([0-9a-f]{64})(?![0-9a-f])/i.exec(input.trim());
  return m ? m[1].toLowerCase() : null;
}
