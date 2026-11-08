import { getCommander, signIn, newIdentity, enrollAgent, call, tsArg, ownerSql } from '../lib.mjs';
import { incident, rows, check, must, denied, audited, ident } from '../slice-helpers.mjs';
export const slice = '10';
export const title = 'Two-reviewer closure, expiry and revocation';

export async function run() {
  const cmd = await getCommander(), a = await signIn('responder'), b = await signIn('responder'), c = await signIn('responder');
  const obs = await signIn('observer'), outsider = await newIdentity(), home = await incident('closure'), ag = await enrollAgent(home.id);
  const request = async inc => {
    await audited(`C-request-${inc.id}`, 'commander requests closure with exactly one audit', cmd,'request_closure',[inc.id,'Review closure',tsArg(inc.updated_at)]);
    return (await rows(`SELECT * FROM closure_request WHERE incident_id = ${inc.id}`)).at(-1);
  };
  for (const [label,who] of [['responder',a],['observer',obs],['outsider',outsider],['agent',ag]]) {
    await denied(`C-req-${label}`, `${label} cannot request closure`,who,'request_closure',[home.id,'no',tsArg(home.updated_at)]);
  }
  const req = await request(home);
  for (const [label,who] of [['requester',cmd],['observer',obs],['outsider',outsider],['agent',ag]]) {
    await denied(`C-approve-${label}`, `${label} cannot approve closure`,who,'approve_closure',[req.id]);
  }
  await denied('C-agent-cancel', 'agent cannot cancel closure',ag,'cancel_closure',[req.id]);
  await audited('C-first', 'first human approval audited once', a,'approve_closure',[req.id]);
  check('C-pending', 'one approval leaves incident open and request pending',
    (await rows(`SELECT * FROM closure_request WHERE id = ${req.id}`))[0].status === 'pending' &&
    (await rows(`SELECT * FROM incident WHERE id = ${home.id}`))[0].status !== 'closed');
  await denied('C-duplicate', 'same human cannot approve twice',a,'approve_closure',[req.id]);
  must(await call(cmd,'revoke_session',[ident(a)]));
  await denied('C-revoked', 'revoked human cannot approve',a,'approve_closure',[req.id]);
  await audited('C-after-revoke', 'replacement first approval audited once',b,'approve_closure',[req.id]);
  check('C-revoked-not-counted', 'revoked reviewer does not count toward two approvals', (await rows(`SELECT * FROM closure_request WHERE id = ${req.id}`))[0].status === 'pending');
  await audited('C-final', 'second live distinct reviewer closes with one audit',c,'approve_closure',[req.id]);
  check('C-closed', 'second valid reviewer atomically closes incident', (await rows(`SELECT * FROM incident WHERE id = ${home.id}`))[0].status === 'closed');
  await denied('C-repeat', 'approved request cannot execute again',b,'approve_closure',[req.id]);
  const stale = await incident('closure-stale'), staleReq = await request(stale);
  must(await call(cmd,'update_incident',[stale.id,'critical',stale.status,stale.containment_status,stale.systems_affected,tsArg(stale.updated_at)]));
  await denied('C-stale', 'changed incident invalidates pending request',b,'approve_closure',[staleReq.id]);
  await audited('C-cancel', 'commander cancellation audited once',cmd,'cancel_closure',[staleReq.id]);
  const old = await incident('closure-expired'), oldReq = await request(old);
  // Request expiry is covered with the harness clock in unit test 7; SQL cannot update timestamps.
  const expired = await signIn('responder');
  must(ownerSql(`DELETE FROM session WHERE identity = ${expired.identity}`));
  await denied('C-expired-session', 'expired reviewer cannot approve',expired,'approve_closure',[oldReq.id]);
  await audited('C-cleanup', 'test pending request cancelled',cmd,'cancel_closure',[oldReq.id]);
}
