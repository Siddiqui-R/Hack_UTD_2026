// Shared setup/assertions for the post-slice-4 checks. Fail closed on missing endpoints.
import { call, sql, proc, getCommander, write, runTag, owner, auditRows, record } from './lib.mjs';

export const ident = who => ({ __identity__: who.identity });
export const quote = text => `'${String(text).replace(/'/g, "''")}'`;
export const check = (id, title, ok, detail = '') => record(id, title, ok ? 'PASS' : 'VULN', detail);
export function must(result) {
  if (!result.ok) throw new Error(result.error || 'required setup failed');
  return result;
}
export async function rows(query, who = owner()) { return must(await sql(who, query)).rows; }
export async function read(who, name, args = []) { return must(await proc(who, name, args)).data; }
export async function incident(prefix) {
  const cmd = await getCommander();
  const title = `atk-${prefix}-${runTag}`;
  must(await write(cmd, title));
  const [inc] = await rows(`SELECT * FROM incidents WHERE title = ${quote(title)}`, cmd);
  if (!inc) throw new Error('new incident not visible');
  return inc;
}
// Assert transaction rollback as well as authorization. A missing reducer is an error, not a held defense.
export async function denied(id, title, who, name, args = []) {
  const before = (await auditRows()).length;
  const result = await call(who, name, args);
  if (result.status === 404) throw new Error(`${name} missing`);
  check(id, title, !result.ok && (await auditRows()).length === before, result.ok ? 'ACCEPTED' : result.error.slice(0, 95));
  return result;
}
export async function audited(id, title, who, name, args = [], delta = 1) {
  const before = (await auditRows()).length;
  const result = await call(who, name, args);
  check(id, title, result.ok && (await auditRows()).length === before + delta, result.error);
  must(result);
}
