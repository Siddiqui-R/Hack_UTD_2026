// The 5 agent tools. Flat parameters only (Nemotron handles nested schemas poorly).
// Every input is Zod-validated by the AI SDK before execute() runs; a malformed call becomes a
// tool-error and the run stops (see run.mjs). Server-side checks are the real enforcement.
import { tool } from 'ai';
import { z } from 'zod';
import { reducer, procedure, u64 } from './db.mjs';

const SEVERITY = ['low', 'medium', 'high', 'critical'];
const ROLE = ['commander', 'responder', 'observer'];
const rank = s => SEVERITY.indexOf(s);

// `run` carries per-run state: the incident, the trace callback, whether a conflict was flagged, and the queue
// run id (undefined for a standalone CLI run). The run id is added here, outside every tool's input schema,
// so the model can never choose it; the server refuses a write whose run is not this worker's running run.
export function makeTools(run) {
  const runArg = () => run.runId === undefined ? { none: [] } : { some: u64(run.runId, 'runId') };
  const step = async (name, input, fn) => {
    // A refused trace (cancelled/revoked/rebound worker) must stop before the business action.
    await run.trace({ kind: 'call', name, input });
    let out;
    try {
      out = await fn();
    } catch (err) {
      out = { error: err.message };
      run.failed = true;
    }
    await run.trace({ kind: 'result', name, output: out, failed: !!out?.error });
    return out; // reported to the model as data; never retried
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
      execute: input => step('createTask', input, () => reducer('create_task', [input.text, input.assigneeRole, runArg()])),
    }),

    updateSeverity: tool({
      description: 'Change the incident severity. Give a specific, evidence-based reason.',
      inputSchema: z.object({ incidentId: z.number().int(), severity: z.enum(SEVERITY), reason: z.string().min(1).max(2000) }),
      execute: input => step('updateSeverity', input, async () => {
        if (rank(input.severity) < rank(run.incident.severity)) {
          throw new Error('downgrade refused: lowering severity requires human review. Create a task asking a human to review instead.');
        }
        const r = await reducer('update_severity', [u64(input.incidentId, 'incidentId'), input.severity, input.reason, runArg()]);
        run.incident.severity = input.severity;
        return r;
      }),
    }),

    flagConflict: tool({
      description: 'Flag two evidence records that contradict each other, and say what changed in your conclusion.',
      inputSchema: z.object({ evidenceIdA: z.number().int(), evidenceIdB: z.number().int(), reason: z.string().min(1).max(2000) }),
      execute: input => step('flagConflict', input, async () => {
        const r = await reducer('flag_conflict', [u64(input.evidenceIdA, 'evidenceIdA'), u64(input.evidenceIdB, 'evidenceIdB'), input.reason, runArg()]);
        run.flaggedConflict = true;
        await run.trace({ kind: 'revision', name: 'conflicting evidence', output: { evidenceIdA: input.evidenceIdA, evidenceIdB: input.evidenceIdB, reason: input.reason } });
        return r;
      }),
    }),
  };
}
