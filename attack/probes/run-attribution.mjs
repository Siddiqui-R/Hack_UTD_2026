// Q1 reproduction: a delayed trace from cancelled run A must not land on run B claimed by the same identity.
// record_agent_step now names its run, so the old worker's trace carries A's id and is refused. Exit 1 if accepted.
import {guardTarget,getCommander,enrollAgent,call} from '../lib.mjs';
import {incident,rows,must} from '../slice-helpers.mjs';
guardTarget();
const cmd=await getCommander(),inc=await incident('attribution-probe'),ag=await enrollAgent(inc.id);
const request=async()=>{must(await call(cmd,'request_agent_run',[inc.id,'fast','mock']));return (await rows(`SELECT * FROM agent_run WHERE incident_id = ${inc.id}`)).at(-1);};
const first=await request();must(await call(ag,'begin_agent_run',[first.id,'mock']));
must(await call(cmd,'cancel_agent_run',[first.id]));
const second=await request();must(await call(ag,'begin_agent_run',[second.id,'mock']));
try{
  const result=await call(ag,'record_agent_step',[first.id,'call','stale old-run tool',JSON.stringify({oldRunId:first.id}),'null']);
  const trace=await rows(`SELECT * FROM agent_step WHERE incident_id = ${inc.id}`);
  if(result.ok || trace.some(s=>s.name==='stale old-run tool')){
    console.log('CONFIRMED Q1: cancelled old worker trace was stored after a new run was claimed.');
    process.exitCode=1;
  }else if(!/own running investigation required/.test(result.error)){
    // A signature mismatch would also be refused; that is not evidence the run binding works.
    console.log(`INCONCLUSIVE: refused for another reason: ${result.error.split('\n')[0].slice(0,120)}`);
    process.exitCode=2;
  }else console.log('HELD: stale trace naming the cancelled run was refused; nothing stored');
}finally{must(await call(cmd,'cancel_agent_run',[second.id]));}
