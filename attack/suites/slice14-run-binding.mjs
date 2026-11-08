// Q1: queue traces and agent writes are bound to their run; standalone (run-less) writes are fenced off from queue runs.
// The run id never appears in a tool's input; the worker's transport adds it (agent/src/tools.mjs).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCommander, signIn, enrollAgent, call, auditRows, TARGET, DB, NO_RUN, inRun } from '../lib.mjs';
import { incident, rows, read, check, must, audited } from '../slice-helpers.mjs';
export const slice = '14';
export const title = 'Run-bound agent traces and writes (Q1)';
const root = fileURLToPath(new URL('../../', import.meta.url));
const OWN = /own running investigation required/, NAMED = /must name its run/, AGENT = /agent session required/;

// Refused for the stated reason, with no audit row. A wrong argument count is refused too, so the reason is checked.
async function refused(id, title, who, name, args, why) {
  const before = (await auditRows()).length;
  const r = await call(who, name, args);
  if (r.status === 404) throw new Error(`${name} missing`);
  const ok = !r.ok && why.test(r.error) && (await auditRows()).length === before;
  check(id, title, ok, r.ok ? 'ACCEPTED' : r.error.split('\n')[0].slice(0, 95));
}

// A real standalone CLI run (`node src/run.mjs`, mock mode: scripted tools, no model call) with its own token file.
function standalone(tokenFile) {
  let output = '';
  const child = spawn(process.execPath, ['src/run.mjs'], {
    cwd: path.join(root, 'agent'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, STDB_URL: TARGET, STDB_DB: DB, STDB_TARGET: 'local', AGENT_MODE: 'mock', AGENT_TOKEN_FILE: tokenFile },
  });
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('standalone run exceeded 20 seconds')); }, 20000);
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

export async function run() {
  const cmd = await getCommander(), resp = await signIn('responder');
  const home = await incident('bind'), other = await incident('bind-other');
  const ag = await enrollAgent(home.id), rival = await enrollAgent(home.id), foreign = await enrollAgent(other.id);
  must(await call(cmd, 'submit_evidence', [home.id, 'Record A: VPN login for svc_backup at 03:14Z']));
  must(await call(cmd, 'submit_evidence', [home.id, 'Record B: no VPN session for svc_backup that night']));
  const [ea, eb] = (await read(cmd, 'evidence_records', [home.id])).map(e => Number(e.id));
  const count = async (table, incId = home.id) => (await rows(`SELECT * FROM ${table} WHERE incident_id = ${incId}`)).length;
  const runsOf = async incId => (await rows(`SELECT * FROM agent_run WHERE incident_id = ${incId}`)).sort((x, y) => Number(x.id) - Number(y.id));
  const request = async (incId = home.id) => { must(await call(resp, 'request_agent_run', [incId, 'fast', 'mock'])); return (await runsOf(incId)).at(-1); };
  const task = (text, runArg) => [text, 'responder', runArg];
  const raise = (severity, runArg) => [home.id, severity, 'Encryption confirmed on two hosts', runArg];
  const flag = runArg => [ea, eb, 'Records disagree on the access vector', runArg];
  const step = (runId, name) => [runId, 'call', name, '{}', 'null'];
  const incidents = [home.id, other.id];
  const logs = path.join(root, 'agent-logs');
  let dir;
  try {
    // Idle incident: a standalone run may write without a run id.
    await audited('R-none-idle', 'run-less write allowed while nothing is queued or running', ag, 'create_task', task('Standalone task', NO_RUN));

    // Queued: no run-less writes, and a run nobody has claimed cannot be named either.
    const a = await request();
    await refused('R-none-queued-task', 'run-less task refused while a run is queued', ag, 'create_task', task('Queued gap', NO_RUN), NAMED);
    await refused('R-none-queued-severity', 'run-less severity refused while a run is queued', ag, 'update_severity', raise('critical', NO_RUN), NAMED);
    await refused('R-none-queued-flag', 'run-less conflict flag refused while a run is queued', ag, 'flag_conflict', flag(NO_RUN), NAMED);
    await refused('R-queued-trace', 'trace naming an unclaimed queued run refused', ag, 'record_agent_step', step(a.id, 'early'), OWN);
    await refused('R-queued-write', 'write naming an unclaimed queued run refused', ag, 'create_task', task('Early', inRun(a.id)), OWN);

    // Running: run-less writes still refused; the worker's own run id works for traces and all three writes.
    must(await call(ag, 'begin_agent_run', [a.id, 'mock']));
    await refused('R-none-running-task', 'run-less task refused while a run is running', ag, 'create_task', task('Running gap', NO_RUN), NAMED);
    await refused('R-none-running-severity', 'run-less severity refused while a run is running', ag, 'update_severity', raise('critical', NO_RUN), NAMED);
    await refused('R-none-running-flag', 'run-less conflict flag refused while a run is running', ag, 'flag_conflict', flag(NO_RUN), NAMED);
    await audited('R-trace-own', 'own running run: trace stored with no audit row', ag, 'record_agent_step', step(a.id, 'createTask'), 0);
    await audited('R-task-own', 'own running run: task written with one audit row', ag, 'create_task', task('Isolate payroll-07', inRun(a.id)));
    await audited('R-severity-own', 'own running run: severity raised with one audit row', ag, 'update_severity', raise('critical', inRun(a.id)));
    await audited('R-flag-own', 'own running run: conflict flagged with one audit row', ag, 'flag_conflict', flag(inRun(a.id)));
    await refused('R-lower-own', 'agent still cannot lower severity inside its own run', ag, 'update_severity', raise('low', inRun(a.id)), /cannot lower/);
    const writes = (await auditRows()).filter(r => String(r.incident_id) === String(home.id) && r.actor === 'NEMOTRON' && ['task.create', 'incident.severity', 'conflict.flag'].includes(r.action));
    const runOf = r => JSON.parse(r.payload_json).runId;
    check('R-audit-run', 'run-bound writes record their run id in the audit row; the standalone write records none',
      writes.length === 4 && writes.filter(r => runOf(r) === String(a.id)).length === 3 && writes.filter(r => runOf(r) === undefined).length === 1,
      `${writes.length} agent writes`);

    // Nobody else can use this run, and this worker cannot name another incident's run.
    await refused('R-rival-trace', "another worker on the same incident cannot trace into this run", rival, 'record_agent_step', step(a.id, 'forged'), OWN);
    await refused('R-rival-write', 'another worker cannot write as this run', rival, 'create_task', task('Forged', inRun(a.id)), OWN);
    await refused('R-rival-none', 'another worker cannot write run-less while this run is running', rival, 'create_task', task('Forged', NO_RUN), NAMED);
    await refused('R-human-write', 'a human cannot write as the agent run', resp, 'create_task', task('Forged', inRun(a.id)), AGENT);
    const f = await request(other.id);
    must(await call(foreign, 'begin_agent_run', [f.id, 'mock']));
    await refused('R-foreign-trace', "trace naming another incident's running run refused", ag, 'record_agent_step', step(f.id, 'cross'), OWN);
    await refused('R-foreign-write', "write naming another incident's running run refused", ag, 'create_task', task('Cross', inRun(f.id)), OWN);
    await refused('R-foreign-worker', "another incident's worker cannot trace into this run", foreign, 'record_agent_step', step(a.id, 'cross'), OWN);
    await refused('R-unknown-run', 'trace naming a run that does not exist refused', ag, 'record_agent_step', step(999999999, 'ghost'), OWN);
    must(await call(cmd, 'cancel_agent_run', [f.id]));

    // Cancelled: its own worker is refused for traces and every write, and nothing is stored.
    must(await call(cmd, 'cancel_agent_run', [a.id]));
    const stepsBefore = await count('agent_step'), tasksBefore = await count('task');
    await refused('R-cancelled-trace', 'trace after cancellation refused', ag, 'record_agent_step', step(a.id, 'late'), OWN);
    await refused('R-cancelled-task', 'task after cancellation refused', ag, 'create_task', task('Late', inRun(a.id)), OWN);
    await refused('R-cancelled-severity', 'severity change after cancellation refused', ag, 'update_severity', raise('critical', inRun(a.id)), OWN);
    await refused('R-cancelled-flag', 'conflict flag after cancellation refused', ag, 'flag_conflict', flag(inRun(a.id)), OWN);
    check('R-cancelled-nothing', 'cancelled run left no new trace or task', await count('agent_step') === stepsBefore && await count('task') === tasksBefore);

    // The same worker claims a later run: a delayed trace or write from the cancelled run lands nowhere.
    const b = await request();
    must(await call(ag, 'begin_agent_run', [b.id, 'mock']));
    await refused('R-stale-trace', 'delayed trace from the cancelled run does not attach to the new run', ag, 'record_agent_step', step(a.id, 'stale'), OWN);
    await refused('R-stale-write', 'delayed write from the cancelled run refused while the new run is running', ag, 'create_task', task('Stale', inRun(a.id)), OWN);
    check('R-stale-nothing', 'new run has no stale step', !(await rows(`SELECT * FROM agent_step WHERE run_id = ${b.id}`)).some(s => s.name === 'stale'));
    await audited('R-new-trace', 'new run traces normally', ag, 'record_agent_step', step(b.id, 'getScope'), 0);
    must(await call(ag, 'finish_agent_run', [b.id, 'Bound run conclusion', false]));
    await refused('R-finished-trace', 'trace after finish refused', ag, 'record_agent_step', step(b.id, 'after'), OWN);
    await refused('R-finished-write', 'write naming a finished run refused', ag, 'create_task', task('After', inRun(b.id)), OWN);
    await audited('R-none-after', 'run-less write allowed again once nothing is queued or running', ag, 'create_task', task('Standalone follow-up', NO_RUN));

    // A real standalone mock run.mjs: completes on an idle incident; refused at its first write while a UI run is queued.
    const solo = await incident('bind-solo'), soloAgent = await enrollAgent(solo.id);
    incidents.push(solo.id);
    await fs.mkdir(logs, { recursive: true });
    dir = await fs.mkdtemp(path.join(logs, 'bind-test-'));
    if (path.dirname(dir) !== logs || !path.basename(dir).startsWith('bind-test-')) throw new Error('invalid test output directory');
    const tokenFile = path.join(dir, 'token.json');
    await fs.writeFile(tokenFile, JSON.stringify(soloAgent), { mode: 0o600 });
    const counter = path.join(logs, 'live-call-count.json');
    const counterBefore = await fs.readFile(counter, 'utf8').catch(() => null);
    const done = await standalone(tokenFile);
    const soloTasks = await rows(`SELECT * FROM task WHERE incident_id = ${solo.id}`);
    check('R-standalone', 'standalone mock run.mjs completes on an idle incident, writing as NEMOTRON',
      done.code === 0 && soloTasks.length === 1 && soloTasks[0].created_by === 'NEMOTRON', done.code === 0 ? `${soloTasks.length} tasks` : done.output.trim().split('\n').at(-1));
    check('R-standalone-trace', 'standalone run writes no trace rows', await count('agent_step', solo.id) === 0);
    must(await call(resp, 'request_agent_run', [solo.id, 'fast', 'mock']));
    const fenced = await standalone(tokenFile);
    check('R-standalone-fenced', 'standalone run cannot write while a UI run is queued',
      fenced.code !== 0 && NAMED.test(fenced.output) && await count('task', solo.id) === 1, fenced.output.trim().split('\n').at(-1));
    check('R-budget', 'standalone mock runs leave the NVIDIA call counter unchanged', await fs.readFile(counter, 'utf8').catch(() => null) === counterBefore);
  } finally {
    for (const incId of incidents) {
      for (const r of (await runsOf(incId)).filter(r => ['queued', 'running'].includes(r.status))) must(await call(cmd, 'cancel_agent_run', [r.id]));
    }
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
}
