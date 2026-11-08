// Q1 extension: a tool write that arrives after the commander cancelled its run must not commit.
// The worker binds every tool write to its run id; the server checks the run is still running in the same transaction.
import { guardTarget, getCommander, enrollAgent, call, auditRows, inRun } from '../lib.mjs';
import { incident, rows, must } from '../slice-helpers.mjs';
guardTarget();
const cmd = await getCommander(), home = await incident('cancelled-tool-probe'), ag = await enrollAgent(home.id);
must(await call(cmd,'request_agent_run',[home.id,'fast','mock']));
const run = (await rows(`SELECT * FROM agent_run WHERE incident_id = ${home.id}`)).at(-1);
try {
  must(await call(ag,'begin_agent_run',[run.id,'mock']));
  must(await call(ag,'record_agent_step',[run.id,'call','createTask','{}','null']));
  must(await call(cmd,'cancel_agent_run',[run.id]));
  const before = (await rows(`SELECT * FROM task WHERE incident_id = ${home.id}`)).length, audit = (await auditRows()).length;
  const action = await call(ag,'create_task',['Cancelled run guard probe','responder',inRun(run.id)]);
  const after = (await rows(`SELECT * FROM task WHERE incident_id = ${home.id}`)).length;
  if (action.ok || after !== before || (await auditRows()).length !== audit) {
    console.log('CONFIRMED Q1 extension: business write accepted after cancellation between call trace and reducer.');
    process.exitCode = 1;
  } else if (!/own running investigation required/.test(action.error)) {
    // A signature mismatch would also be refused; that is not evidence the run binding works.
    console.log(`INCONCLUSIVE: refused for another reason: ${action.error.split('\n')[0].slice(0, 120)}`);
    process.exitCode = 2;
  } else console.log('HELD: tool write naming the cancelled run was refused; no task and no audit row');
} finally {
  const current = (await rows(`SELECT * FROM agent_run WHERE id = ${run.id}`))[0];
  if (['queued','running'].includes(current.status)) must(await call(cmd,'cancel_agent_run',[run.id]));
}
