// Targeted reproduction, separate from the regression gate until the owner coordinates a runId contract.
import {guardTarget,getCommander,enrollAgent,call} from '../lib.mjs';
import {incident,rows,must} from '../slice-helpers.mjs';
guardTarget();
const cmd=await getCommander(),inc=await incident('attribution-probe'),ag=await enrollAgent(inc.id);
const request=async()=>{must(await call(cmd,'request_agent_run',[inc.id,'fast','mock']));return (await rows(`SELECT * FROM agent_run WHERE incident_id = ${inc.id}`)).at(-1);};
const first=await request();must(await call(ag,'begin_agent_run',[first.id,'mock']));
must(await call(cmd,'cancel_agent_run',[first.id]));
const second=await request();must(await call(ag,'begin_agent_run',[second.id,'mock']));
try{
  const result=await call(ag,'record_agent_step',['call','stale old-run tool',JSON.stringify({oldRunId:first.id}),'null']);
  const trace=await rows(`SELECT * FROM agent_step WHERE run_id = ${second.id}`);
  if(result.ok && trace.some(s=>s.name==='stale old-run tool')){
    console.log('CONFIRMED Q1: cancelled old worker trace was attributed to the new run; trace args contain no expected runId.');
    process.exitCode=1;
  }else console.log('HELD: stale trace rejected');
}finally{must(await call(cmd,'cancel_agent_run',[second.id]));}
