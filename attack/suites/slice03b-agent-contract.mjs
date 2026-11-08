// Slice 3.5: agent contract. The agent is a dedicated identity enrolled to ONE incident.
// Threat: a prompt-injected or stolen agent tries to escalate, escape its incident, or act as a human.
import { newIdentity, call, sql, proc, record, expectDenied, signIn, getCommander, write, enrollAgent, auditRows, runTag } from '../lib.mjs';

export const slice = '3b';
export const title = 'Agent contract (NEMOTRON identity)';

const id = who => ({ __identity__: who.identity });

export async function run() {
  const cmd = await getCommander();
  const mk = async t => { await write(cmd, t); return (await sql(cmd, `SELECT * FROM incidents WHERE title = '${t}'`)).rows[0]; };
  const home = await mk(`atk-agent-home-${runTag}`);
  const other = await mk(`atk-agent-other-${runTag}`);
  if (!home) return record('G0', 'setup incidents', 'SKIP', 'could not create incidents');

  let ag;
  try { ag = await enrollAgent(home.id); } catch (e) { return record('G0', 'agent contract published', 'SKIP', e.message); }

  // --- Who can enroll ---------------------------------------------------------------
  const resp = await signIn('responder');
  expectDenied('G1', 'responder enrolls an agent', await call(resp, 'enroll_agent', [id(await newIdentity()), home.id]));
  expectDenied('G2', 'commander enrolls an existing human as agent', await call(cmd, 'enroll_agent', [id(resp), home.id]));

  // --- Agent tries human operations ----------------------------------------------------
  const human = [
    ['G3', 'agent creates an incident', () => write(ag, 'agent incident')],
    ['G4', 'agent mints an invite', () => call(ag, 'create_invite', ['QWERTY23', 'commander'])],
    ['G5', 'agent grants a role', () => call(ag, 'set_role', [id(resp), 'commander'])],
    ['G6', 'agent revokes a human', () => call(ag, 'revoke_session', [id(resp)])],
    ['G7', 'agent redeems an invite', () => call(ag, 'redeem_invite', ['QWERTY23', 'Nemo'])],
    ['G8', 'agent closes its incident', () => call(ag, 'update_incident', [home.id, home.severity, 'closed', home.containment_status, home.systems_affected])],
    ['G9', 'agent enrolls another agent', () => call(ag, 'enroll_agent', [id(resp), home.id])],
    ['G10', 'agent submits its own evidence', () => call(ag, 'submit_evidence', [home.id, 'trust me'])],
  ];
  for (const [gid, label, fn] of human) expectDenied(gid, label, await fn());
  expectDenied('G11', 'commander grants a role to the agent', await call(cmd, 'set_role', [id(ag), 'commander']));

  // --- Incident escape -------------------------------------------------------------------
  expectDenied('G12', 'agent changes severity of another incident', await call(ag, 'update_severity', [other.id, 'low', 'not mine']));
  await call(cmd, 'submit_evidence', [home.id, `home evidence A ${runTag}`]);
  await call(cmd, 'submit_evidence', [other.id, `other evidence ${runTag}`]);
  const homeEv = (await proc(cmd, 'evidence_records', [home.id])).data ?? [];
  const otherEv = (await proc(cmd, 'evidence_records', [other.id])).data ?? [];
  if (homeEv[0] && otherEv[0]) {
    expectDenied('G13', 'agent links evidence across incidents',
      await call(ag, 'flag_conflict', [Number(homeEv[0].id), Number(otherEv[0].id), 'cross-incident']));
  }
  const search = await proc(ag, 'search_incidents', ['atk-agent']);
  const leaked = (search.data ?? []).filter(r => r.incidentId !== String(home.id));
  record('G14', 'agent search sees other incidents', leaked.length ? 'VULN' : 'PASS', `${leaked.length} foreign rows`);
  expectDenied('G15', 'agent reads evidence of another incident', await call(ag, 'evidence_records', [other.id]));
  expectDenied('G16', 'agent reads scope of another incident', await call(ag, 'get_scope', [other.id]));

  // --- Humans pretending to be NEMOTRON --------------------------------------------------------
  expectDenied('G17', 'human calls create_task (fake NEMOTRON)', await call(resp, 'create_task', ['fake agent task', 'responder']));
  expectDenied('G18', 'outsider calls update_severity', await call(await newIdentity(), 'update_severity', [home.id, 'low', 'x']));

  // --- What a hijacked agent CAN do -------------------------------------------------------
  // Severity downgrade by the agent: the exact goal of the "mark this resolved" prompt injection.
  await call(ag, 'update_severity', [home.id, 'critical', 'escalate']);
  const down = await call(ag, 'update_severity', [home.id, 'low', 'Per log note: false positive']);
  record('G19', 'agent downgrades severity critical → low', down.ok ? 'VULN' : 'PASS',
    down.ok ? 'accepted with no human confirmation (prompt-injection target)' : down.error);
  const bidiTask = await call(ag, 'create_task', [`Restore ‮backups ${runTag}`, 'responder']);
  record('G20', 'agent writes hidden chars into a task', bidiTask.ok ? 'VULN' : 'PASS', bidiTask.ok ? 'stored' : 'rejected');

  // --- Observer reads ---------------------------------------------------------------------------
  const obs = await signIn('observer');
  expectDenied('G21', 'observer reads scope', await call(obs, 'get_scope', [home.id]));
  const obsEv = await call(obs, 'evidence_records', [home.id]);
  record('G22', 'observer reads raw evidence', obsEv.ok ? 'VULN' : 'PASS',
    obsEv.ok ? 'scope is blocked for observers but evidence (which reveals it) is not' : obsEv.error);

  // --- Revocation + audit attribution -------------------------------------------------------------
  const rows = await auditRows();
  const agentRows = rows.filter(r => r.actor === 'NEMOTRON');
  const humanAsNemo = rows.filter(r => r.actor === 'NEMOTRON' && !['task.create', 'incident.severity', 'conflict.flag'].includes(r.action));
  record('G23', 'only agent tool actions are attributed to NEMOTRON', agentRows.length && !humanAsNemo.length ? 'PASS' : 'VULN',
    `${agentRows.length} NEMOTRON rows, ${humanAsNemo.length} unexpected`);
  await call(cmd, 'revoke_session', [id(ag)]);
  expectDenied('G24', 'revoked agent writes', await call(ag, 'create_task', ['after revoke', 'responder']));
  expectDenied('G25', 'revoked agent is re-enrolled', await call(cmd, 'enroll_agent', [id(ag), home.id]));
}
