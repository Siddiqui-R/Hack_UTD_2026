// Exercise every base table, rather than assuming later slices inherited privacy.
import { getCommander, signIn, newIdentity, enrollAgent, call, sql, ownerSql } from '../lib.mjs';
import { incident, rows, must, check, ident } from '../slice-helpers.mjs';
export const slice = '6/boundaries';
export const title = 'All private tables and immediate read withdrawal';

export async function run() {
  const cmd = await getCommander(), obs = await signIn('observer'), stranger = await newIdentity();
  const home = await incident('read-boundaries'), agent = await enrollAgent(home.id);
  const tables = ['user','session','revoked_identity','invite_code','owner','audit','chain_head','session_sweep',
    'incident','agent_identity','task','evidence','conflict','anchor_job','anchor','agent_run','agent_step',
    'message','scope_item','closure_request','closure_approval'];
  for (const table of tables) {
    await rows(`SELECT * FROM ${table}`); // A nonexistent table must never count as a held defense.
    for (const [role, who] of [['outsider',stranger],['observer',obs],['agent',agent],['commander',cmd]]) {
      check(`B-${role}-${table}`, `${role} cannot read private ${table}`, !(await sql(who, `SELECT * FROM ${table}`)).ok);
    }
  }
  const reader = await signIn('responder');
  must(await call(cmd,'submit_evidence',[home.id,'Boundary test evidence']));
  must(await call(cmd,'add_scope_item',[home.id,'boundary asset','PII','compromised','confirmed',1,'boundary note']));
  check('B-before-demotion', 'responder initially receives evidence and scope',
    (await rows('SELECT * FROM investigation_evidence',reader)).length > 0 && (await rows('SELECT * FROM scope_items',reader)).length > 0);
  must(await call(cmd,'set_role',[ident(reader),'observer']));
  for (const view of ['investigation_runs','investigation_steps','investigation_evidence','investigation_conflicts','scope_items']) {
    check(`B-demoted-${view}`, `demotion immediately removes ${view}`, (await rows(`SELECT * FROM ${view}`,reader)).length === 0);
  }
  const views = ['team','incidents','tasks','messages','scope_items','investigation_runs','investigation_steps',
    'investigation_evidence','investigation_conflicts','closure_requests','closure_approvals'];
  const revoked = await signIn('responder'), expired = await signIn('responder');
  must(await call(cmd,'revoke_session',[ident(revoked)]));
  must(ownerSql(`DELETE FROM session WHERE identity = ${expired.identity}`));
  for (const [role, who] of [['revoked',revoked],['expired',expired],['agent',agent]]) {
    for (const view of views) check(`B-${role}-${view}`, `${role} receives no human ${view}`, (await rows(`SELECT * FROM ${view}`,who)).length === 0);
  }
}
