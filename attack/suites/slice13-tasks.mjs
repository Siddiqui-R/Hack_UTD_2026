// Human task workflow: create, claim, assign, progress, completion, reopening, visibility and boundaries.
import { getCommander, signIn, newIdentity, enrollAgent, call, sql, ownerSql, auditRows, tsArg } from '../lib.mjs';
import { incident, rows, read, check, must, denied, audited, ident } from '../slice-helpers.mjs';
export const slice = '13';
export const title = 'Human task workflow: ownership, lifecycle, versions, visibility';

const some = who => ({ some: ident(who) });
const none = { none: [] };
const hexOf = who => who.identity.replace(/^0x/, '').toLowerCase();
const has = (value, who) => JSON.stringify(value ?? null).toLowerCase().includes(hexOf(who));
const isNone = v => v == null || (Array.isArray(v) && v[0] === 1);

export async function run() {
  const cmd = await getCommander(), a = await signIn('responder'), b = await signIn('responder'), obs = await signIn('observer');
  const outsider = await newIdentity(), home = await incident('tasks'), ag = await enrollAgent(home.id);
  const state = async id => (await rows(`SELECT * FROM task_state WHERE task_id = ${id}`))[0];
  const newest = async incId => (await rows(`SELECT * FROM task WHERE incident_id = ${incId}`)).sort((x, y) => Number(x.id) - Number(y.id)).at(-1);

  // Creation: humans only, real provenance, no progress row until something changes.
  for (const [label, who] of [['observer', obs], ['outsider', outsider], ['agent', ag]]) {
    await denied(`T-create-${label}`, `${label} cannot create a human task`, who, 'create_human_task', [home.id, 'Isolate payroll-07', 'responder']);
  }
  await denied('T-create-role', 'intended role must be commander or responder', a, 'create_human_task', [home.id, 'Watch the logs', 'observer']);
  await denied('T-create-empty', 'empty task text refused', a, 'create_human_task', [home.id, '   ', 'responder']);
  await denied('T-create-missing', 'unknown incident refused', a, 'create_human_task', [999999, 'Isolate payroll-07', 'responder']);
  await audited('T-create', 'responder creates a task with exactly one audit row', a, 'create_human_task', [home.id, 'Isolate payroll-07 from the network', 'responder']);
  const t1 = await newest(home.id);
  check('T-provenance', 'human task records the real creator, never NEMOTRON', t1.created_by !== 'NEMOTRON' && t1.created_by.toLowerCase() === hexOf(a));
  check('T-default', 'new task has no progress row (open, unassigned, version 0)', !(await state(t1.id)));

  // Claiming: version-checked; a race has exactly one winner and one audit row.
  await denied('T-claim-observer', 'observer cannot claim', obs, 'claim_task', [t1.id, 0]);
  await denied('T-claim-agent', 'agent cannot claim', ag, 'claim_task', [t1.id, 0]);
  await denied('T-claim-stale', 'claim with a wrong version refused', a, 'claim_task', [t1.id, 5]);
  await denied('T-claim-missing', 'unknown task refused', a, 'claim_task', [999999, 0]);
  const before = (await auditRows()).length;
  const [ra, rb] = await Promise.all([call(a, 'claim_task', [t1.id, 0]), call(b, 'claim_task', [t1.id, 0])]);
  const s1 = await state(t1.id);
  check('T-claim-race', 'two simultaneous claims of version 0: one wins, one audit row, version 1',
    [ra, rb].filter(r => r.ok).length === 1 && (await auditRows()).length === before + 1 && Number(s1?.version) === 1);
  const winner = ra.ok ? a : b, loser = ra.ok ? b : a;
  check('T-claim-owner', 'the winner is the stored assignee', has(s1?.assignee, winner));
  await denied('T-claim-repeat', 'repeating the same claim is refused as stale', winner, 'claim_task', [t1.id, 0]);
  await denied('T-claim-taken', 'cannot claim a task assigned to someone else', loser, 'claim_task', [t1.id, 1]);

  // Lifecycle: assignee or commander only; notes to block/complete/reopen; done is final until reopened.
  await denied('T-status-other', 'a non-assignee responder cannot change status', loser, 'update_task_status', [t1.id, 'in_progress', '', 1]);
  await denied('T-status-agent', 'agent cannot mark work done', ag, 'update_task_status', [t1.id, 'done', 'agent says done', 1]);
  await denied('T-status-bad', 'unknown status refused', winner, 'update_task_status', [t1.id, 'resolved', 'fixed it', 1]);
  await denied('T-status-same', 'no-op transition refused', winner, 'update_task_status', [t1.id, 'open', '', 1]);
  await audited('T-start', 'assignee starts the task', winner, 'update_task_status', [t1.id, 'in_progress', '', 1]);
  await denied('T-block-nonote', 'blocking needs a reason', winner, 'update_task_status', [t1.id, 'blocked', '', 2]);
  await audited('T-block', 'assignee blocks with a reason', winner, 'update_task_status', [t1.id, 'blocked', 'Waiting on switch access', 2]);
  await audited('T-unblock', 'assignee unblocks', winner, 'update_task_status', [t1.id, 'in_progress', '', 3]);
  await denied('T-done-nonote', 'completing needs a note', winner, 'update_task_status', [t1.id, 'done', '', 4]);
  await audited('T-done', 'assignee completes with a note', winner, 'update_task_status', [t1.id, 'done', 'Port 14 shut on core-sw-2; host offline', 4]);
  const s2 = await state(t1.id);
  check('T-done-attribution', 'completion records who and when', s2?.status === 'done' && has(s2?.completed_by, winner) && !isNone(s2?.completed_at));
  await denied('T-done-repeat', 'repeated completion refused', winner, 'update_task_status', [t1.id, 'done', 'again done', 5]);
  await denied('T-done-claim', 'a done task cannot be claimed', loser, 'claim_task', [t1.id, 5]);
  await denied('T-done-move', 'a done task must be reopened before other changes', winner, 'update_task_status', [t1.id, 'in_progress', '', 5]);
  await denied('T-reopen-nonote', 'reopening needs a reason', winner, 'update_task_status', [t1.id, 'open', '', 5]);
  await audited('T-reopen', 'reopen with a reason', winner, 'update_task_status', [t1.id, 'open', 'Host came back online', 5]);
  const reopen = (await auditRows()).at(-1);
  check('T-reopen-history', 'the reopen audit row keeps the previous completion',
    reopen.action === 'task.reopen' && reopen.payload_json.includes('previousCompletion') && reopen.payload_json.includes('Port 14 shut'));
  const s3 = await state(t1.id);
  check('T-reopen-row', 'reopened task is open with completion cleared', s3?.status === 'open' && isNone(s3?.completed_by) && Number(s3?.version) === 6);

  // Assignment: commanders only; eligible, unrevoked humans; online not required.
  const gone = await signIn('responder');
  must(await call(cmd, 'revoke_session', [ident(gone)]));
  const away = await signIn('responder');
  must(ownerSql(`DELETE FROM session WHERE identity = ${away.identity}`));
  await denied('T-assign-responder', 'a responder cannot assign', a, 'assign_task', [t1.id, some(b), 6]);
  await denied('T-assign-observer', 'an observer cannot be assigned', cmd, 'assign_task', [t1.id, some(obs), 6]);
  await denied('T-assign-agent', 'the agent identity cannot be assigned', cmd, 'assign_task', [t1.id, some(ag), 6]);
  await denied('T-assign-unknown', 'an unregistered identity cannot be assigned', cmd, 'assign_task', [t1.id, some(outsider), 6]);
  await denied('T-assign-revoked', 'a revoked teammate cannot be assigned', cmd, 'assign_task', [t1.id, some(gone), 6]);
  await denied('T-assign-same', 'assigning the current assignee is refused', cmd, 'assign_task', [t1.id, some(winner), 6]);
  await audited('T-reassign', 'commander reassigns', cmd, 'assign_task', [t1.id, some(loser), 6]);
  await audited('T-assign-offline', 'an offline teammate can still be assigned', cmd, 'assign_task', [t1.id, some(away), 7]);
  await audited('T-unassign', 'commander clears the assignee', cmd, 'assign_task', [t1.id, none, 8]);
  await denied('T-claim-first', 'a responder must claim an unassigned task before updating it', a, 'update_task_status', [t1.id, 'in_progress', '', 9]);
  await audited('T-cmd-status', 'a commander can manage an unassigned task', cmd, 'update_task_status', [t1.id, 'blocked', 'Pending legal hold review', 9]);

  // Visibility: notes stay with commanders/responders, in the live view and in the exported record.
  const progress = async who => { const r = await sql(who, 'SELECT * FROM task_progress'); return r.ok ? r.rows.filter(x => String(x.task_id) === String(t1.id)) : []; };
  const [viewCmd] = await progress(cmd), [viewObs] = await progress(obs);
  check('T-view-human', 'commander sees status and note', viewCmd?.status === 'blocked' && viewCmd?.note === 'Pending legal hold review');
  check('T-view-observer', 'observer sees status but not the note', viewObs?.status === 'blocked' && viewObs?.note === '');
  check('T-view-agent', 'the agent sees no task progress', (await progress(ag)).length === 0);
  check('T-view-outsider', 'an outsider sees no task progress', (await progress(outsider)).length === 0);
  check('T-view-revoked', 'a revoked teammate sees no task progress', (await progress(gone)).length === 0);
  const recCmd = await read(cmd, 'get_record', [home.id]), recObs = await read(obs, 'get_record', [home.id]);
  const inCmd = recCmd.tasks.find(x => String(x.id) === String(t1.id)), inObs = recObs.tasks.find(x => String(x.id) === String(t1.id));
  check('T-record', 'record exports status, version and note', inCmd?.status === 'blocked' && inCmd?.note === 'Pending legal hold review' && Number(inCmd?.version) === 10);
  check('T-record-observer', 'observer record keeps status but redacts the note', inObs?.status === 'blocked' && inObs?.note === '[restricted]');

  // Existing agent tasks are untouched and start as open/unassigned/version 0.
  must(await call(ag, 'create_task', ['Preserve volatile memory on payroll-07', 'responder']));
  const agentTask = await newest(home.id);
  check('T-agent-provenance', 'agent createTask still labels NEMOTRON', agentTask.created_by === 'NEMOTRON');
  const legacy = (await read(cmd, 'get_record', [home.id])).tasks.find(x => String(x.id) === String(agentTask.id));
  check('T-record-legacy', 'a task with no progress exports as open, unassigned, version 0', legacy?.status === 'open' && legacy?.assignee === null && Number(legacy?.version) === 0);
  await audited('T-legacy-claim', 'an agent-created task can be claimed at version 0', a, 'claim_task', [agentTask.id, 0]);

  // Boundaries: dead sessions refused; closed incidents read-only; task changes never touch the incident.
  const lapsed = await signIn('responder');
  must(ownerSql(`DELETE FROM session WHERE identity = ${lapsed.identity}`));
  await denied('T-expired', 'an expired session cannot create tasks', lapsed, 'create_human_task', [home.id, 'Rotate keys', 'responder']);
  await denied('T-revoked', 'a revoked teammate cannot create tasks', gone, 'create_human_task', [home.id, 'Rotate keys', 'responder']);
  const after = (await rows(`SELECT * FROM incident WHERE id = ${home.id}`))[0];
  check('T-no-side-effects', 'task changes leave incident status, severity and containment alone',
    after.status === home.status && after.severity === home.severity && after.containment_status === home.containment_status);
  const shut = await incident('tasks-closed');
  must(await call(cmd, 'create_human_task', [shut.id, 'Review backups', 'responder']));
  const closedTask = await newest(shut.id);
  const fresh = (await rows(`SELECT * FROM incident WHERE id = ${shut.id}`))[0];
  must(await call(cmd, 'request_closure', [shut.id, 'Contained', tsArg(fresh.updated_at)]));
  const req = (await rows(`SELECT * FROM closure_request WHERE incident_id = ${shut.id}`)).at(-1);
  must(await call(b, 'approve_closure', [req.id]));
  check('T-closed-setup', 'test incident closed with an open task (closure rule unchanged)', (await rows(`SELECT * FROM incident WHERE id = ${shut.id}`))[0].status === 'closed');
  await denied('T-closed-create', 'closed incident: no new tasks', cmd, 'create_human_task', [shut.id, 'More work', 'responder']);
  await denied('T-closed-claim', 'closed incident: no claims', a, 'claim_task', [closedTask.id, 0]);
  await denied('T-closed-assign', 'closed incident: no assignment', cmd, 'assign_task', [closedTask.id, some(a), 0]);
  await denied('T-closed-status', 'closed incident: no status changes', cmd, 'update_task_status', [closedTask.id, 'done', 'Backups checked', 0]);
}
