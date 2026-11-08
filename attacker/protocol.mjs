// Validate decoded runner messages as well as their per-run marker. A valid JSON document is not a valid result.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;
export const MAX_LINE_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const MAX_EVENTS = 2048;
export function resultRows(value) {
  if (!Array.isArray(value) || value.length > 64) throw Error('invalid result list');
  const seen = new Set();
  return value.map(row => {
    if (!object(row) || !text(row.id, 100) || !row.id || seen.has(row.id) || !text(row.title, 2000) ||
        !['PASS', 'VULN', 'SKIP', 'ERROR'].includes(row.outcome) ||
        (row.detail !== undefined && !text(row.detail, 8000))) throw Error('invalid result row');
    seen.add(row.id);
    return { id: row.id, title: row.title, outcome: row.outcome, detail: row.detail ?? '' };
  });
}
export function phaseRow(value) {
  if (!object(value) || !['EDITING', 'DETECTION CHECK', 'DETECTED', 'DETECTION FAILED', 'INCOMPLETE', 'RESTORING', 'VERIFIED', 'RESTORE FAILED'].includes(value.phase) ||
      !Number.isSafeInteger(value.seq) || value.seq < 1 ||
      (value.holdMaxMs !== undefined && (!Number.isSafeInteger(value.holdMaxMs) || value.holdMaxMs < 1000 || value.holdMaxMs > 120000))) throw Error('invalid phase');
  // Do not send the recovery ownership token to browser clients.
  const row = { phase: value.phase, seq: value.seq };
  for (const key of ['db','column','original','tampered','at','reason']) {
    if (value[key] !== undefined) { if (!text(value[key], 4000)) throw Error('invalid phase text'); row[key] = value[key]; }
  }
  for (const key of ['incidentId','checked','brokenAt','holdMaxMs']) {
    if (value[key] !== undefined && value[key] !== null) { if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw Error('invalid phase number'); row[key] = value[key]; }
  }
  for (const key of ['independent','module']) if (typeof value[key] === 'boolean') row[key] = value[key];
  return row;
}
