// Slice 3: incidents, structured intake, update.
import { newIdentity, call, sql, ownerSql, record, expectDenied, signIn, getCommander, write, ts, tsArg, auditRows, runTag } from '../lib.mjs';

export const slice = 3;
export const title = 'Incidents';

// update_incident takes the version the caller saw (expectedUpdatedAt) as its last argument.
const upd = (who, id, s) => call(who, 'update_incident', [id, s.severity, s.status, s.containment, s.systems, s.version]);

export async function run() {
  const cmd = await getCommander();
  const probe = await write(cmd, `atk-inc-${runTag}`);
  if (probe.status === 404) return record('I0', 'incidents not published', 'SKIP');
  const find = async (who, t) => (await sql(who, `SELECT * FROM incidents WHERE title = '${t}'`)).rows[0];
  const inc = await find(cmd, `atk-inc-${runTag}`);
  if (!inc) return record('I0', 'commander can create + read an incident', 'VULN', probe.error || 'not visible');
  const base = { severity: inc.severity, status: inc.status, containment: inc.containment_status, systems: inc.systems_affected, version: tsArg(inc.updated_at) };

  // --- Who can read / write -----------------------------------------------------------
  const obs = await signIn('observer');
  const resp = await signIn('responder');
  expectDenied('I1', 'observer creates an incident', await write(obs, 'observer incident'));
  expectDenied('I2', 'observer updates an incident', await upd(obs, inc.id, { ...base, severity: 'low' }));
  const outsider = await newIdentity();
  const direct = await sql(outsider, 'SELECT * FROM incident');
  record('I3', 'outsider reads private `incident` table', direct.ok ? 'VULN' : 'PASS', direct.ok ? 'readable' : 'private');
  const view = await sql(outsider, 'SELECT * FROM incidents');
  record('I4', 'outsider reads `incidents` view', view.rows.length ? 'VULN' : 'PASS', view.rows.length ? `${view.rows.length} leaked` : 'empty');

  // Brief test #2: a responder must not be able to close an incident.
  const close = await upd(resp, inc.id, { ...base, status: 'closed' });
  record('I5', 'responder closes an incident', close.ok ? 'VULN' : 'PASS',
    close.ok ? 'responder set status=closed (brief: commander-only)' : close.error);
  if (close.ok) await upd(cmd, inc.id, base); // put it back

  // --- Input validation ----------------------------------------------------------------
  expectDenied('I6', 'out-of-range severity enum', await write(resp, 'bad enum', { severity: 'apocalyptic' }));
  expectDenied('I7', 'detected_at in the future', await write(resp, 'future', { detectedAt: ts(Date.now() + 3_600_000) }));
  expectDenied('I8', '121-char title', await write(resp, 'x'.repeat(121)));
  const ancient = await write(resp, `atk-ancient-${runTag}`, { detectedAt: ts(-62135596800000) });
  record('I9', 'detected_at in year 1', ancient.ok ? 'VULN' : 'PASS', ancient.ok ? 'accepted; timeline/report sorting breaks' : 'rejected');
  const bidi = await write(resp, `atk-‮edispu-${runTag}`);
  record('I10', 'bidi-override char in title', bidi.ok ? 'VULN' : 'PASS', bidi.ok ? 'U+202E stored in incident title' : 'rejected');
  expectDenied('I11', 'update a non-existent incident', await upd(cmd, 999999, base));

  // --- Lost update: every update rewrites all four fields from the caller's (maybe stale) copy ---
  const stale = { ...base };                                       // responder loads the incident
  await upd(cmd, inc.id, { ...base, status: 'contained' });        // commander marks it contained
  await upd(resp, inc.id, { ...stale, severity: 'critical' });     // responder bumps severity from the stale copy
  const after = await find(cmd, `atk-inc-${runTag}`);
  record('I12', 'concurrent edits silently revert each other', after.status === 'contained' ? 'PASS' : 'VULN',
    after.status === 'contained' ? 'status kept' : `commander's "contained" reverted to "${after.status}" by a stale update`);

  // --- Audit ---------------------------------------------------------------------------
  const rows = await auditRows();
  const forInc = rows.filter(r => Number(r.incident_id) === Number(inc.id));
  const kinds = forInc.map(r => r.action);
  record('I13', 'incident create/update audited with incident_id',
    kinds.includes('incident.create') && kinds.includes('incident.update') ? 'PASS' : 'VULN', `${forInc.length} rows: ${[...new Set(kinds)].join(', ')}`);

  // --- Expired session ---------------------------------------------------------------------
  ownerSql(`DELETE FROM session WHERE identity = ${resp.identity}`);
  const gone = await sql(resp, 'SELECT * FROM incidents');
  record('I14', 'expired session reads incidents', gone.rows.length ? 'VULN' : 'PASS', gone.rows.length ? `${gone.rows.length} served` : 'no data');
}
