// Extends Q1: cancellation has no atomic guard on business reducers either.
import { guardTarget, getCommander, enrollAgent, call } from '../lib.mjs';
import { incident, rows, must } from '../slice-helpers.mjs';
guardTarget();
const cmd = await getCommander(), home = await incident('cancelled-tool-probe'), ag = await enrollAgent(home.id);
must(await call(cmd,'request_agent_run',[home.id,'fast','mock']));
const run = (await rows(`SELECT * FROM agent_run WHERE incident_id = ${home.id}`)).at(-1);
try {
  must(await call(ag,'begin_agent_run',[run.id,'mock']));
  must(await call(ag,'record_agent_step',['call','createTask','{}','null']));
  must(await call(cmd,'cancel_agent_run',[run.id]));
  const before = (await rows(`SELECT * FROM task WHERE incident_id = ${home.id}`)).length;
  const action = await call(ag,'create_task',['Cancelled run guard probe','responder']);
  const after = (await rows(`SELECT * FROM task WHERE incident_id = ${home.id}`)).length;
  if (action.ok && after === before + 1) {
    console.log('CONFIRMED Q1 extension: business write accepted after cancellation between call trace and reducer. Worker prechecks cannot make cancellation atomic.');
    process.exitCode = 1;
  } else console.log('HELD: cancelled tool write refused');
} finally {
  const current = (await rows(`SELECT * FROM agent_run WHERE id = ${run.id}`))[0];
  if (['queued','running'].includes(current.status)) must(await call(cmd,'cancel_agent_run',[run.id]));
}
