import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCommander, signIn, newIdentity, enrollAgent, call, sql, ownerSql, auditRows, TARGET, DB } from '../lib.mjs';
import { incident, rows, read, check, must, denied, audited, ident } from '../slice-helpers.mjs';
export const slice = '11';
export const title = 'Run queue, worker trace, replay failure and cancellation';
const root = fileURLToPath(new URL('../../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function worker(tokenFile, extraEnv = {}) {
  let output = '';
  const child = spawn(process.execPath, ['src/worker.mjs','--once'], {
    cwd: path.join(root,'agent'), env: { ...process.env, STDB_URL: TARGET, STDB_DB: DB, AGENT_MODE: 'mock', AGENT_TOKEN_FILE: tokenFile, ...extraEnv }, stdio: ['ignore','pipe','pipe'],
  });
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const done = new Promise((resolve,reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('worker exceeded 20 seconds')); },20000);
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
  return { child, done };
}

export async function run() {
  const cmd = await getCommander(), resp = await signIn('responder'), obs = await signIn('observer'), outsider = await newIdentity();
  const home = await incident('queue'), other = await incident('queue-other');
  const ag = await enrollAgent(home.id), foreign = await enrollAgent(other.id), rival = await enrollAgent(home.id);
  const request = async (tier='fast',mode='mock') => {
    await audited(`Q-request-${tier}-${mode}`, `${tier}/${mode} request audited once`,resp,'request_agent_run',[home.id,tier,mode]);
    return (await rows(`SELECT * FROM agent_run WHERE incident_id = ${home.id}`)).at(-1);
  };
  for (const [label,who] of [['observer',obs],['outsider',outsider],['agent',ag]]) {
    await denied(`Q-request-${label}`, `${label} cannot request investigation`,who,'request_agent_run',[home.id,'fast','mock']);
  }
  await denied('Q-live', 'queue cannot spend live model credits',resp,'request_agent_run',[home.id,'fast','live']);
  await denied('Q-human-poll', 'human cannot poll worker queue',resp,'next_agent_run');
  const req = await request();
  await denied('Q-human-status','human cannot query worker status',cmd,'agent_run_status',[req.id]);
  await denied('Q-cross-status','foreign worker cannot query run status',foreign,'agent_run_status',[req.id]);
  check('Q-own-status','enrolled worker reads the exact queued run status',(await read(ag,'agent_run_status',[req.id])).status==='queued');
  await denied('Q-duplicate', 'second active request rejected',resp,'request_agent_run',[home.id,'fast','mock']);
  const next = await read(ag,'next_agent_run');
  check('Q-context', 'poll returns only enrolled incident', String(next.runId)===String(req.id) && String(next.incidentId)===String(home.id));
  check('Q-foreign-empty', 'foreign worker sees none of this queue', await read(foreign,'next_agent_run') === null);
  await denied('Q-cross-claim', 'foreign agent cannot claim run',foreign,'begin_agent_run',[req.id,'mock']);
  await denied('Q-human-claim', 'human cannot claim worker run',cmd,'begin_agent_run',[req.id,'mock']);
  await audited('Q-begin', 'worker claim audited once',ag,'begin_agent_run',[req.id,'mock']);
  await denied('Q-race', 'second worker cannot claim running request',rival,'begin_agent_run',[req.id,'mock']);
  await denied('Q-rival-step', 'other worker cannot forge trace',rival,'record_agent_step',[req.id,'call','fake','{}','{}']);
  await audited('Q-step', 'trace stored with zero audit rows',ag,'record_agent_step',[req.id,'call','getScope','{}','{}'],0);
  const [step] = await rows(`SELECT * FROM agent_step WHERE run_id = ${req.id}`);
  check('Q-attribution', 'step run and incident derived on server', String(step.incident_id)===String(home.id) && String(step.run_id)===String(req.id));
  await denied('Q-bad-json', 'malformed trace JSON rolled back',ag,'record_agent_step',[req.id,'call','bad','{','{}']);
  for (const table of ['investigation_runs','investigation_steps','investigation_evidence','investigation_conflicts']) {
    check(`Q-observer-${table}`, `observer cannot read ${table}`, (await rows(`SELECT * FROM ${table}`,obs)).length===0);
    check(`Q-outsider-${table}`, `outsider cannot read ${table}`, (await rows(`SELECT * FROM ${table}`,outsider)).length===0);
  }
  await denied('Q-rival-finish', 'other worker cannot complete run',rival,'finish_agent_run',[req.id,'forged',false]);
  await audited('Q-finish', 'worker completion audited once',ag,'finish_agent_run',[req.id,'Baseline conclusion',false]);
  await denied('Q-finished-trace', 'finished run accepts no more trace',ag,'record_agent_step',[req.id,'call','late','{}','{}']);

  // Real child worker, isolated service identity. Compare the persisted hosted-call counter byte-for-byte.
  const logs=path.join(root,'agent-logs');
  await fs.mkdir(logs,{recursive:true});
  const dir = await fs.mkdtemp(path.join(logs,'queue-test-'));
  if(path.dirname(dir)!==logs || !path.basename(dir).startsWith('queue-test-'))throw new Error('invalid test output directory');
  const tokenFile = path.join(dir,'token.json');
  await fs.writeFile(tokenFile,JSON.stringify(ag),{mode:0o600});
  const counter = path.join(root,'agent-logs','live-call-count.json');
  const counterBefore = await fs.readFile(counter,'utf8').catch(()=>null);
  let active;
  try {
    must(await call(cmd,'submit_evidence',[home.id,'Record A: public key login']));
    must(await call(cmd,'submit_evidence',[home.id,'Record B: phishing login']));
    const mock = await request('deep');
    const auditBefore=Number((await auditRows()).at(-1).seq);
    active=worker(tokenFile); const result=await active.done; active=undefined;
    const [completed]=await rows(`SELECT * FROM agent_run WHERE id = ${mock.id}`);
    check('Q-worker-complete', 'real worker completes mock request', result.code===0 && completed.status==='completed', result.code===0?completed.status:result.output);
    check('Q-worker-tier', 'deep mock tier and previous conclusion preserved',completed.model_id.startsWith('mock:') && completed.model_id.includes('ultra') && completed.previous_summary==='Baseline conclusion');
    const trace=await rows(`SELECT * FROM agent_step WHERE run_id = ${mock.id}`);
    check('Q-worker-trace', 'worker publishes tool call/result, revision and summary', ['call','result','revision','summary'].every(k=>trace.some(s=>s.kind===k)));
    const writes=(await auditRows()).filter(r=>String(r.incident_id)===String(home.id) && ['task.create','incident.severity','conflict.flag'].includes(r.action) && Number(r.seq)>auditBefore);
    check('Q-worker-bound', 'every worker tool write names its own run in the audit row',
      writes.length===3 && writes.every(r=>JSON.parse(r.payload_json).runId===String(mock.id)), `${writes.length} writes`);
    // Synthetic fixture exercises transport only; it is explicitly labelled, never saved as a golden/live run.
    const fixture=path.join(dir,'synthetic-replay.json');
    const fixtureSummary='Synthetic replay integration fixture; not model output.';
    await fs.writeFile(fixture,JSON.stringify({mode:'live',model:completed.model_id.slice('mock:'.length),incident:{incidentId:String(home.id)},
      events:[{kind:'call',name:'getScope',input:{incidentId:home.id}},{kind:'call',name:'createTask',input:{text:fixtureSummary,assigneeRole:'responder'}}],summary:fixtureSummary}));
    const recorded=await request('deep','replay');
    active=worker(tokenFile,{AGENT_REPLAY_FILE:fixture});const recordedResult=await active.done;active=undefined;
    const [replayed]=await rows(`SELECT * FROM agent_run WHERE id = ${recorded.id}`);
    check('Q-replay-transport','valid replay fixture completes through actual tool/trace endpoints',recordedResult.code===0 && replayed.status==='completed' && replayed.summary===fixtureSummary);
    const mismatch=await request('fast','replay');
    active=worker(tokenFile,{AGENT_REPLAY_FILE:fixture});await active.done;active=undefined;
    check('Q-replay-tier','recording for another tier fails without live fallback',(await rows(`SELECT * FROM agent_run WHERE id = ${mismatch.id}`))[0].status==='failed');
    const replay = await request('deep','replay');
    active=worker(tokenFile,{AGENT_REPLAY_FILE:path.join(dir,'missing.json')});
    const replayResult=await active.done; active=undefined;
    const [failed]=await rows(`SELECT * FROM agent_run WHERE id = ${replay.id}`);
    check('Q-replay-no-fallback', 'missing recording produces failed run with no live fallback',replayResult.code===0 && failed.status==='failed');

    const cancelled = await request();
    const taskBefore=(await rows(`SELECT * FROM task WHERE incident_id = ${home.id}`)).length;
    active=worker(tokenFile);
    let ready=false;
    for(let i=0;i<80;i++) {
      const trace=await rows(`SELECT * FROM agent_step WHERE run_id = ${cancelled.id}`);
      if(trace.some(s=>s.kind==='result' && s.name==='getScope')) {ready=true;break;}
      await pause(50);
    }
    if(!ready) throw new Error('worker never reached cancellation point');
    const duplicateWorker=await worker(tokenFile).done;
    check('Q-worker-lock','second process cannot reuse an active service identity',duplicateWorker.code===1 && duplicateWorker.output.includes('Another worker holds'));
    await audited('Q-cancel', 'commander cancellation audited once',cmd,'cancel_agent_run',[cancelled.id]);
    const stopped=await active.done; active=undefined;
    check('Q-worker-cancel', 'cancelled worker stops before its next tool write', stopped.code===0 &&
      (await rows(`SELECT * FROM agent_run WHERE id = ${cancelled.id}`))[0].status==='cancelled' &&
      (await rows(`SELECT * FROM task WHERE incident_id = ${home.id}`)).length===taskBefore);
    const expired=await enrollAgent(home.id);
    must(ownerSql(`DELETE FROM session WHERE identity = ${expired.identity}`));
    await denied('Q-expired-poll', 'expired worker cannot poll',expired,'next_agent_run');
    await denied('Q-expired-status','expired worker cannot read run status',expired,'agent_run_status',[cancelled.id]);
    must(await call(cmd,'revoke_session',[ident(rival)]));
    await denied('Q-revoked-poll', 'revoked worker cannot poll',rival,'next_agent_run');
    check('Q-budget', 'mock/replay/cancel leave NVIDIA call counter unchanged',await fs.readFile(counter,'utf8').catch(()=>null)===counterBefore);
  } finally {
    if(active) {active.child.kill();await active.done.catch(()=>{});}
    const pending=await rows(`SELECT * FROM agent_run WHERE incident_id = ${home.id}`);
    for(const row of pending.filter(r=>['queued','running'].includes(r.status))) must(await call(cmd,'cancel_agent_run',[row.id]));
    await fs.rm(dir,{recursive:true,force:true});
  }
}
