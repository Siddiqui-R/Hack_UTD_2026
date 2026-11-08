import { useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { Identity } from 'spacetimedb';
import { reducers, tables } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import { useRun } from './Toast';
import { Chip } from './Chip';
import { agentStateFor, parseIdentityHex } from '../lib/agentState';
import { shortId } from '../lib/format';

// Commander enrols a service identity for the selected incident. The server (enrollAgent) enforces
// commander-only, refuses human/owner/revoked identities and writes the agent.enroll audit row.
export function AgentEnrollment({ incident, me }: { incident: Incident; me: TeamMember }) {
  const [agents] = useTable(tables.agentStatus);
  const [runs] = useTable(tables.investigationRuns);
  const enroll = useReducer(reducers.enrollAgent);
  const run = useRun();
  const [input, setInput] = useState('');
  const state = agentStateFor(incident.id, agents, runs);
  const hex = parseIdentityHex(input);
  const enrolledHere = agents.filter(a => a.incidentId === incident.id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hex) return;
    if (await run(() => enroll({ target: Identity.fromString(hex), incidentId: incident.id }))) setInput('');
  };

  return (
    <div className="flex flex-col gap-2 border-b border-line px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Agent service</span>
        <Chip tone={state.tone}>{state.label}</Chip>
        {enrolledHere.map(a => (
          <span key={a.identity.toHexString()} className="font-mono text-[11px] text-text-2" title={a.identity.toHexString()}>
            {shortId(a.identity.toHexString())}
            {a.revoked ? ' revoked' : a.sessionActive ? '' : ' expired'}
          </span>
        ))}
      </div>
      {me.role === 'commander' && (
        <form className="flex gap-2" onSubmit={submit}>
          <input
            aria-label="Agent identity"
            className="field font-mono text-[12px]"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Paste the identity the agent worker prints (64 hex characters)"
            spellCheck={false}
          />
          <button type="submit" className="btn btn-primary h-7" disabled={!hex}>
            {state.needsEnrol && enrolledHere.length ? 'Re-enrol' : 'Enrol'} for INC-{incident.id.toString()}
          </button>
        </form>
      )}
      {me.role === 'commander' && input && !hex && (
        <p className="font-mono text-[11px] text-medium">No 64-character hex identity found in that text.</p>
      )}
    </div>
  );
}
