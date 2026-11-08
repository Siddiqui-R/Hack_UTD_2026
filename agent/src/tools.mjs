// The 5 agent tools. Flat parameters only (Nemotron handles nested schemas poorly).
// Every input is Zod-validated by the AI SDK before execute() runs; a malformed call becomes a
// tool-error and the run stops (see run.mjs). Server-side checks are the real enforcement.
import { tool } from 'ai';
import { z } from 'zod';
import { reducer, procedure, u64 } from './db.mjs';

const SEVERITY = ['low', 'medium', 'high', 'critical'];
const ROLE = ['commander', 'responder', 'observer'];
const rank = s => SEVERITY.indexOf(s);

// `run` carries per-run state: the incident, the trace callback, and whether a conflict was flagged.
export function makeTools(run) {
  const step = async (name, input, fn) => {
    run.trace({ kind: 'call', name, input });
    try {
      const out = await fn();
      run.trace({ kind: 'result', name, output: out });
      return out;
    } catch (err) {
      const out = { error: err.message };
      run.trace({ kind: 'result', name, output: out, failed: true });
      return out; // reported to the model as data; never retried
    }
  };

  return {
    searchIncidents: tool({
      description: 'Search incidents by title text. Returns id, title, severity, status.',
      inputSchema: z.object({ query: z.string().max(200) }),
      execute: input => step('searchIncidents', input, () => procedure('search_incidents', [input.query])),
    }),

    getScope: tool({
      description: 'Get the compromised-data scope (assets, data types) for an incident.',
      inputSchema: z.object({ incidentId: z.number().int() }),
      execute: input => step('getScope', input, () => procedure('get_scope', [u64(input.incidentId, 'incidentId')])),
    }),

    createTask: tool({
      description: 'Create one concrete task for a responder role. Use short imperative text.',
      inputSchema: z.object({ text: z.string().min(1).max(1000), assigneeRole: z.enum(ROLE) }),
      execute: input => step('createTask', input, () => reducer('create_task', [input.text, input.assigneeRole])),
    }),

    updateSeverity: tool({
      description: 'Change the incident severity. Give a specific, evidence-based reason.',
      inputSchema: z.object({ incidentId: z.number().int(), severity: z.enum(SEVERITY), reason: z.string().min(1).max(2000) }),
      execute: input => step('updateSeverity', input, async () => {
        // Agent-side policy (defense in depth; the server should enforce this too, finding G19):
        // a downgrade is only allowed as a revision backed by a flagged evidence conflict in this run.
        if (rank(input.severity) < rank(run.incident.severity) && !run.flaggedConflict) {
          throw new Error('downgrade refused: lowering severity requires a flagged evidence conflict. Create a task asking a human to review instead.');
        }
        const r = await reducer('update_severity', [u64(input.incidentId, 'incidentId'), input.severity, input.reason]);
        run.incident.severity = input.severity;
        return r;
      }),
    }),

    flagConflict: tool({
      description: 'Flag two evidence records that contradict each other, and say what changed in your conclusion.',
      inputSchema: z.object({ evidenceIdA: z.number().int(), evidenceIdB: z.number().int(), reason: z.string().min(1).max(2000) }),
      execute: input => step('flagConflict', input, async () => {
        const r = await reducer('flag_conflict', [u64(input.evidenceIdA, 'evidenceIdA'), u64(input.evidenceIdB, 'evidenceIdB'), input.reason]);
        run.flaggedConflict = true;
        return r;
      }),
    }),
  };
}
