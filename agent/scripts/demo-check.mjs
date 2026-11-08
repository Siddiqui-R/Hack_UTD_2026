// Read-only operator preflight. Never mint an identity, enroll, run a model or apply tools.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.mjs';
import { replayRecording } from '../src/run.mjs';

const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
let incident;
try {
  const ping = await request(`${config.stdbUrl}/v1/ping`);
  add('database', ping.ok, ping.ok ? 'Database reachable' : `Database returned HTTP ${ping.status}`);
} catch { add('database', false, 'Database unreachable or request timed out'); }

try {
  const identity = JSON.parse(fs.readFileSync(config.tokenFile, 'utf8'));
  if (typeof identity.token !== 'string' || !identity.token) throw new Error();
  const response = await request(`${config.stdbUrl}/v1/database/${encodeURIComponent(config.stdbDb)}/call/search_incidents`, {
    method: 'POST', headers: { authorization: `Bearer ${identity.token}`, 'content-type': 'application/json' }, body: '[""]',
  });
  if (response.ok) {
    const wire = await response.json(), rows = typeof wire === 'string' ? JSON.parse(wire) : wire;
    incident = Array.isArray(rows) && rows.length === 1 ? rows[0] : undefined;
    if (incident) {
      const queue = await request(`${config.stdbUrl}/v1/database/${encodeURIComponent(config.stdbDb)}/call/next_agent_run`, {
        method: 'POST', headers: { authorization: `Bearer ${identity.token}`, 'content-type': 'application/json' }, body: '[]',
      });
      if (!queue.ok) incident = undefined;
    }
    add('worker enrollment', !!incident, incident ? `Service sees incident #${incident.incidentId}` : 'Expected one enrolled incident');
  } else add('worker enrollment', false, `Read denied (HTTP ${response.status}); commander must enroll or renew the service identity`);
} catch { add('worker enrollment', false, 'Service token missing, invalid, or database read unavailable'); }

if (incident) {
  try {
    const recording = replayRecording(config.modelFast, incident.incidentId);
    const valid = typeof recording.summary === 'string' && !!recording.summary.trim() &&
      Array.isArray(recording.events) && recording.events.some(e => e.kind === 'call');
    add('FAST golden replay', valid, valid ? 'Matching live recording found; content not printed' : 'Matching file has no conclusion or tool calls');
  } catch { add('FAST golden replay', false, 'No readable live recording matches this incident and FAST model'); }
} else add('FAST golden replay', false, 'Enroll the service identity before checking incident-specific replay');

let count = 5;
try {
  const file = path.join(config.logDir, 'live-call-count.json');
  if (fs.existsSync(file)) count = JSON.parse(fs.readFileSync(file, 'utf8')).count;
  if (!Number.isSafeInteger(count) || count < 5) throw new Error();
  add('live recording prerequisites', (!config.metered || !!config.nvidiaKey) && (!config.metered || count < config.liveBudget),
    config.metered ? `${config.nvidiaKey ? 'Key configured' : 'NVIDIA_API_KEY missing'}; known budget ${count}/${config.liveBudget} used` : 'Self-hosted endpoint configured; no model request made');
} catch { add('live recording prerequisites', false, 'Live-call counter needs reconciliation'); }

try {
  const health = await request(process.env.PDF_HEALTH_URL ?? 'http://127.0.0.1:4400/health');
  add('PDF HTTP health', health.ok, health.ok ? 'Renderer HTTP reachable; this does not test Chromium or a production proxy' : `Renderer returned HTTP ${health.status}`);
} catch { add('PDF HTTP health', false, 'Renderer unreachable; start pdf/server.mjs or set PDF_HEALTH_URL'); }

const required = checks.filter(c => c.name !== 'live recording prerequisites');
const ready = required.every(c => c.ok);
if (process.argv.includes('--json')) console.log(JSON.stringify({ localReplayReady: ready, checks }, null, 2));
else {
  for (const c of checks) console.log(`${c.ok ? 'READY' : 'NEEDS INPUT'} | ${c.name}: ${c.detail}`);
  console.log('Production access, physical hotspot rehearsal and server run guards require separate verification.');
}
process.exitCode = ready ? 0 : 1;
