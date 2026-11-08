// Queue requests are mock/replay only. This process has no path from a queue request to live mode.
import { config } from './config.mjs';
import { procedure, reducer, u64, serviceIdentity } from './db.mjs';
import { executeRun, replayRecording } from './run.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const once = process.argv.includes('--once');
const identity = await serviceIdentity();
const lockFile = path.join(config.logDir, `worker-${createHash('sha256').update(identity.identity).digest('hex')}.lock`);
try { fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx', mode: 0o600 }); }
catch { console.error('Another worker holds this service identity. Check the worker lock/PID before restarting.'); process.exit(1); }
process.once('exit', () => { fs.unlinkSync(lockFile); });
process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
console.log(`BLACKBOX worker (${config.target}) ${config.stdbUrl} db=${config.stdbDb}`);
console.log(`Service identity ${identity.identity}: mock/replay queue only, never live`);
const json = value => {
  const text = JSON.stringify(value ?? null);
  return text.length <= 32000 ? text : JSON.stringify({ truncated: true, preview: text.slice(0, 30000) });
};

async function consume() {
  const request = await procedure('next_agent_run', []);
  if (!request) return false;
  if (!['mock', 'replay'].includes(request.mode) || !['fast', 'deep'].includes(request.tier)) throw new Error('Unsupported queue request; no live fallback');
  const runId = u64(Number(request.runId), 'runId');
  const incidentId = u64(Number(request.incidentId), 'incidentId');
  const requestedModel = request.tier === 'deep' ? config.modelDeep : config.modelFast;
  const modelId = request.mode === 'mock' ? `mock:${requestedModel}` : requestedModel;
  await reducer('begin_agent_run', [runId, modelId]);
  console.log(`Claimed run #${runId} (${request.mode}/${request.tier})`);
  let summary, failed = false;
  const trace = async e => {
    // Additive endpoint from 4eb367f: check this exact request, even if the same identity
    // has since claimed a different run. Server-side atomic expected-run guards remain Q1.
    const status = await procedure('agent_run_status', [runId]);
    if (status.status !== 'running' || String(status.runId) !== String(runId)) throw new Error('requested investigation is no longer running');
    await reducer('record_agent_step', [e.kind, e.name, json(e.input), json(e.output)]);
  };
  try {
    const recording = request.mode === 'replay' ? replayRecording(requestedModel, incidentId) : undefined;
    ({ summary } = await executeRun({ mode: request.mode, modelId: requestedModel, incidentId, recording, onTrace: trace }));
  } catch (err) {
    failed = true;
    summary = `Investigation stopped: ${err.message}`.slice(0, 16000);
    // If cancelled/revoked, trace/finish are refused as well. Never retry a tool or restart the run.
    try { await trace({ kind: 'error', name: 'worker', output: { error: err.message } }); } catch { /* no active trace */ }
  }
  try {
    await reducer('finish_agent_run', [runId, summary, failed]);
    console.log(`Run #${runId} ${failed ? 'failed' : 'completed'}`);
  } catch (err) {
    console.log(`Run #${runId} stopped; completion refused (${err.message})`);
  }
  return true;
}

// Until a commander enrols this identity (and again after its 15-minute session lapses), the poll is refused.
// Keep polling slowly instead of exiting, so a re-enrolment resumes work without a restart. This only repeats
// the read-only poll; a claimed run is never retried and a refused claim is never executed.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let waiting = '';
do {
  try {
    await consume();
    if (waiting) { console.log('Enrolled: watching the queue'); waiting = ''; }
  } catch (err) {
    if (once) { console.error(`Worker stopped: ${err.message}`); process.exitCode = 1; break; }
    if (err.message !== waiting) console.log(`Waiting (${new Date().toLocaleTimeString()}): ${err.message}`);
    waiting = err.message;
    await sleep(5000);
    continue;
  }
  if (!once) await sleep(config.pollMs);
} while (!once);
