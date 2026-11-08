import { getCommander, signIn, newIdentity, enrollAgent, call, tsArg, ownerSql } from '../lib.mjs';
import { incident, rows, check, must, denied, audited, ident } from '../slice-helpers.mjs';
export const slice = '10';
export const title = 'Two-person closure (requester + one reviewer), expiry and revocation';

// Rule since a769de9: a live, unrevoked commander's request counts as the first approval; one other live
// commander/responder closes. Lapsed, revoked or demoted people never count toward the two.
export async function run() {
  const cmd = await getCommander(), a = await signIn('responder'), b = await signIn('responder'), c = await signIn('responder');
  const obs = await signIn('observer'), outsider = await newIdentity(), home = await incident('closure'), ag = await enrollAgent(home.id);
  const requestRow = async id => (await rows(`SELECT * FROM closure_request WHERE id = ${id}`))[0];
  const incidentRow = async id => (await rows(`SELECT * FROM incident WHERE id = ${id}`))[0];
  const request = async (inc, by = cmd) => {
    await audited(`C-request-${inc.id}`, 'commander requests closure with exactly one audit', by,'request_closure',[inc.id,'Review closure',tsArg(inc.updated_at)]);
    return (await rows(`SELECT * FROM closure_request WHERE incident_id = ${inc.id}`)).at(-1);
  };
  const lapse = who => must(ownerSql(`DELETE FROM session WHERE identity = ${who.identity}`));
  const cancel = req => call(cmd,'cancel_closure',[req.id]); // best effort; approved requests refuse it

  for (const [label,who] of [['responder',a],['observer',obs],['outsider',outsider],['agent',ag]]) {
    await denied(`C-req-${label}`, `${label} cannot request closure`,who,'request_closure',[home.id,'no',tsArg(home.updated_at)]);
  }
  const req = await request(home);
  check('C-pending', 'request alone (one person) leaves incident open and request pending',
    (await requestRow(req.id)).status === 'pending' && (await incidentRow(home.id)).status !== 'closed');
  for (const [label,who] of [['requester',cmd],['observer',obs],['outsider',outsider],['agent',ag]]) {
    await denied(`C-approve-${label}`, `${label} cannot approve closure`,who,'approve_closure',[req.id]);
  }
  await denied('C-agent-cancel', 'agent cannot cancel closure',ag,'cancel_closure',[req.id]);
  must(await call(cmd,'revoke_session',[ident(a)]));
  await denied('C-revoked', 'revoked human cannot approve',a,'approve_closure',[req.id]);
  await audited('C-final', 'one other live human closes with exactly one audit',b,'approve_closure',[req.id]);
  check('C-closed', 'requester + one reviewer atomically closes incident',
    (await incidentRow(home.id)).status === 'closed' && (await requestRow(req.id)).status === 'approved');
  await denied('C-repeat', 'approved request cannot execute again',c,'approve_closure',[req.id]);

  const stale = await incident('closure-stale'), staleReq = await request(stale);
  must(await call(cmd,'update_incident',[stale.id,'critical',stale.status,stale.containment_status,stale.systems_affected,tsArg(stale.updated_at)]));
  await denied('C-stale', 'changed incident invalidates pending request',b,'approve_closure',[staleReq.id]);
  await audited('C-cancel', 'commander cancellation audited once',cmd,'cancel_closure',[staleReq.id]);
  const old = await incident('closure-expired'), oldReq = await request(old);
  // Request expiry is covered with the harness clock in unit test 7; SQL cannot update timestamps.
  const expired = await signIn('responder');
  lapse(expired);
  await denied('C-expired-session', 'expired reviewer cannot approve',expired,'approve_closure',[oldReq.id]);
  await audited('C-cleanup', 'test pending request cancelled',cmd,'cancel_closure',[oldReq.id]);

  // The requester counts only while still a live commander. Use a second commander so the run's own stays live.
  const lead = await signIn('commander'), d = await signIn('responder'), e = await signIn('responder');
  const lapsedCase = await incident('closure-requester-lapsed'), lapsedReq = await request(lapsedCase, lead);
  try {
    lapse(lead);
    await audited('C-lapsed-first', 'approval after requester lapsed is audited once',d,'approve_closure',[lapsedReq.id]);
    check('C-lapsed-requester-not-counted', 'lapsed requester does not count: one reviewer leaves it pending',
      (await requestRow(lapsedReq.id)).status === 'pending' && (await incidentRow(lapsedCase.id)).status !== 'closed');
    await denied('C-duplicate', 'same human cannot approve twice',d,'approve_closure',[lapsedReq.id]);
    await audited('C-lapsed-second', 'second distinct live reviewer then closes with one audit',e,'approve_closure',[lapsedReq.id]);
    check('C-lapsed-closed', 'two live reviewers close when the requester no longer counts', (await incidentRow(lapsedCase.id)).status === 'closed');
  } finally { await cancel(lapsedReq); }

  // An earlier approval loses its authority when the reviewer is demoted (requester lapsed so approvals accumulate).
  const lead2 = await signIn('commander'), reduced = await signIn('responder'), replacement = await signIn('responder');
  const demotionCase = await incident('closure-demotion'), demotionReq = await request(demotionCase, lead2);
  try {
    lapse(lead2);
    must(await call(reduced,'approve_closure',[demotionReq.id]));
    must(await call(cmd,'set_role',[ident(reduced),'observer']));
    must(await call(replacement,'approve_closure',[demotionReq.id]));
    check('C-demoted-not-counted','demoted reviewer approval cannot execute closure', (await requestRow(demotionReq.id)).status === 'pending');
    await denied('C-demoted-approve','demoted reviewer cannot approve again',reduced,'approve_closure',[demotionReq.id]);
  } finally { await cancel(demotionReq); }

  const lead3 = await signIn('commander'), stale2 = await signIn('responder'), fresh = await signIn('responder');
  const expiryCase = await incident('closure-reviewer-expiry'), expiryReq = await request(expiryCase, lead3);
  try {
    lapse(lead3);
    must(await call(stale2,'approve_closure',[expiryReq.id]));
    lapse(stale2);
    must(await call(fresh,'approve_closure',[expiryReq.id]));
    check('C-expired-approval-not-counted','expired prior reviewer approval cannot execute closure', (await requestRow(expiryReq.id)).status === 'pending');
  } finally { await cancel(expiryReq); }
}
