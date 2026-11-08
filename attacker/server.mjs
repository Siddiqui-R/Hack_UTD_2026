// Local bridge for the demo console. Runs one demo script at a time and keeps the run independent of the browser:
// refreshing or closing the page never stops a run, and reconnecting replays it. Verdicts are decided here, once.
// Run from repo root:  node attacker/server.mjs   then open http://127.0.0.1:4400
//   GET  /events          SSE: replays the current/last run, then streams it live
//   POST /run/:n          start demo n (1-4)
//   POST /release         demo 2: end the presenter hold now and restore the edit
//   POST /restore         undo a pending demo-2 edit from its recovery record, verify the chain
// POSTs need the x-blackbox-console header, so another site in the same browser cannot trigger runs (CORS preflight).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { resultRows, phaseRow, MAX_LINE_BYTES, MAX_OUTPUT_BYTES, MAX_EVENTS } from './protocol.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const attackDir = fileURLToPath(new URL('../attack/', import.meta.url));
const { TARGET, DB, guardTarget } = await import('../attack/lib.mjs');
guardTarget(); // same local-only rule as the scripts
const PORT = 4400;
const RUN_TIMEOUT_MS = Math.max(10_000, Number(process.env.RUN_TIMEOUT_MS) || 180_000);
const MAX_STREAMS = 32;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

const target = {
  server: TARGET, db: DB,
  incidentId: process.env.TAMPER_INCIDENT ? Number(process.env.TAMPER_INCIDENT) : null,
  incidentTitle: process.env.TAMPER_INCIDENT_TITLE ?? null,
};

// Every check a demo must report for its outcome to count. A missing one makes the run INCOMPLETE.
const EXPECTED = {
  1: ['A1a', 'A1b'],
  2: ['A2a', 'A2c', 'A2b'],
  3: ['A3a', 'A3b', 'A3c', 'A3d', 'A3e', 'A3f', 'A3g', 'A3h'],
  4: ['A4a', 'A4b', 'A4c'],
  restore: ['R2'],
};
const HELD = {
  1: { label: 'ACCESS DENIED', stamp: 'DENIED' },
  2: { label: 'TAMPER DETECTED → RESTORED', stamp: 'DETECTED' },
  3: { label: 'FORBIDDEN ACTIONS DENIED', stamp: 'DENIED' },
  4: { label: 'SERVICE CONTINUED → RESYNCED', stamp: 'RESYNCED' },
  restore: { label: 'DEMO EDIT RESTORED', stamp: 'RESTORED' },
};

// The tamper script owns the recovery format; an invalid file comes back as { invalid, error } and blocks attack 2.
const { pendingRecovery } = await import('../attack/demo/2-tamper.mjs');
const publicRecovery = () => { const rec = pendingRecovery(); if (!rec || rec.invalid) return rec; const { token, ...safe } = rec; return safe; };

function factsFor(n, results, phases) {
  const by = id => results.find(r => r.id === id);
  const edit = phases.find(p => p.phase === 'EDITING');
  if (n === '1') return ['SESSION EXPIRY SIMULATED', 'REPLAYED TOKEN · WRITE REJECTED', 'REPLAYED TOKEN · NO DATA SERVED'];
  if (n === '2') return [`RECORD #${edit?.seq ?? '?'} ALTERED BY THE DATABASE OWNER`, 'BLACKBOX DETECTED HASH MISMATCH', 'ORIGINAL VALUE RESTORED · CHAIN VERIFIED'];
  if (n === '3') {
    const refused = ['A3b', 'A3c', 'A3d', 'A3e', 'A3f', 'A3g'].filter(id => by(id)?.outcome === 'PASS').length;
    return ['INJECTION STAYED INSIDE THE EVIDENCE FENCE', `${refused} FORBIDDEN AGENT ACTIONS REFUSED BY THE SERVER`, 'NO MODEL CALL · SERVER RULES TESTED AS IF THE MODEL OBEYED'];
  }
  if (n === '4') return ['ONE REAL CLIENT CONNECTION CUT', 'OTHER DEVICE KEPT WORKING', `RECONNECTED CLIENT RESYNCED ${by('A4c')?.detail?.match(/\d+\/\d+/)?.[0] ?? ''} MESSAGES`.trim()];
  const rec = phases.find(p => p.phase === 'RESTORING');
  return [`RECORD #${rec?.seq ?? '?'} ORIGINAL VALUE RESTORED`, 'CHAIN VERIFIED'];
}

// Success needs: clean exit, a result block, every expected check present and PASS, and (demo 2) no pending edit.
function verdict(run) {
  const { n, results, code, phases } = run;
  const ids = new Set(results.map(r => r.id));
  const missing = (EXPECTED[n] ?? []).filter(id => !ids.has(id));
  const notPass = results.filter(r => r.outcome !== 'PASS');
  const failed = results.filter(r => r.outcome === 'VULN');
  const errors = results.filter(r => r.outcome === 'ERROR');
  const why = r => `${r.id} ${r.title}${r.detail ? ` — ${r.detail}` : ''}`;
  if (failed.length) return { kind: 'breached', label: 'DEFENCE FAILED', stamp: 'FAILED', facts: failed.map(why) };
  if (errors.length || code !== 0 || !run.gotResult || run.badLine)
    return { kind: 'error', label: 'ERROR', stamp: 'ERROR', facts: errors.length ? errors.map(why)
      : [run.timedOut ? `run exceeded ${RUN_TIMEOUT_MS / 1000}s and was stopped` : code === null || code > 255 ? 'script was killed before it finished'
        : run.badLine ? 'script printed a malformed result/phase marker' : `script exited with code ${code}${run.gotResult ? '' : ', no results reported'}`] };
  const rec = (n === '2' || n === 'restore') && pendingRecovery();
  if (rec?.invalid) return { kind: 'incomplete', label: 'RECOVERY REQUIRED', stamp: 'INCOMPLETE', facts: [rec.error, 'check the audit record by hand, fix it, then delete attack/.tamper-recovery.json'] };
  // The script's own reason comes first (e.g. a recovery file that does not match the record must not say "press restore").
  if (missing.length || notPass.length)
    return { kind: 'incomplete', label: rec ? 'EDIT NOT RESTORED' : 'INCOMPLETE', stamp: 'INCOMPLETE',
      facts: [...notPass.map(why), ...missing.map(id => `${id} not reported`), ...(rec ? [`record #${rec.seq} is still edited; recovery file kept`] : [])] };
  if (rec) return { kind: 'incomplete', label: 'EDIT NOT RESTORED', stamp: 'INCOMPLETE', facts: ['the demo edit is still in place · use RESTORE DEMO EDIT'] };
  return { kind: 'held', ...HELD[n], facts: factsFor(n, results, phases) };
}

let run = null;   // the current or last run; survives browser reconnects
let child = null;
const clients = new Set();
const send = (res, ev, data) => { try { if (!res.destroyed) return res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(res); } };
const broadcast = (ev, data) => { run.events.push([ev, data]); for (const c of clients) send(c, ev, data); };
const snapshot = () => ({ target, recovery: publicRecovery(), busy: !!child, run: run && { id: run.id, n: run.n, done: run.done } });

function start(n) {
  // Per-run secret: only the runner/demo (which get it via env) can print result/phase markers the bridge accepts.
  const mark = randomBytes(12).toString('hex');
  run = { id: randomBytes(16).toString('hex'), n, events: [], results: [], phases: [], code: null, gotResult: false, done: false };
  for (const c of clients) { send(c, 'reset', snapshot()); send(c, 'live', {}); } // a new run is live, not a replay
  broadcast('start', { n, id: run.id });
  child = spawn(process.execPath, [here + 'runner.mjs', n], { cwd: attackDir, env: { ...process.env, DEMO_MARKER: mark }, stdio: ['pipe', 'pipe', 'pipe'] });
  const proc = child;
  // Watchdog: a hung demo must not lock the console forever. Demo 2 leaves its recovery file, so RESTORE still works.
  const watchdog = setTimeout(() => { run.timedOut = true; broadcast('line', `ERROR run exceeded ${RUN_TIMEOUT_MS / 1000}s, stopping it`); proc.kill(); }, RUN_TIMEOUT_MS);
  let bytes = 0;
  const stopOutput = () => {
    if (run.outputLimit) return;
    run.outputLimit = run.badLine = true;
    broadcast('line', 'ERROR runner output limit exceeded; stopped, pending recovery remains available');
    proc.kill();
  };
  // Each pipe has its own UTF-8 decoder and partial line; stderr cannot splice a stdout result frame.
  const reader = markers => {
    let buf = '';
    const decoder = new StringDecoder('utf8');
    return d => {
      if (run.outputLimit) return;
      bytes += Buffer.byteLength(d);
      if (bytes > MAX_OUTPUT_BYTES) return stopOutput();
      buf += strip(decoder.write(d));
      const parts = buf.split(/\r?\n/); buf = parts.pop();
      if (Buffer.byteLength(buf) > MAX_LINE_BYTES) return stopOutput();
      for (const line of parts) {
        if (Buffer.byteLength(line) > MAX_LINE_BYTES || run.events.length >= MAX_EVENTS) return stopOutput();
        try {
          if (markers && line.startsWith(`@@RESULT:${mark} `)) {
            if (run.gotResult) throw Error('duplicate results');
            run.results = resultRows(JSON.parse(line.slice(mark.length + 10))); run.gotResult = true; continue;
          }
          if (markers && line.startsWith(`@@PHASE:${mark} `)) {
            if (run.gotResult) throw Error('phase after result');
            const p = { ...phaseRow(JSON.parse(line.slice(mark.length + 9))), runId: run.id, t: Date.now() };
            run.phases.push(p); broadcast('phase', p); continue;
          }
        } catch { run.badLine = true; broadcast('line', 'ERROR invalid runner result/phase frame'); continue; }
        if (line.trim()) broadcast('line', line.replaceAll(mark, '[marker]'));
      }
    };
  };
  child.stdout.on('data', reader(true));
  child.stderr.on('data', reader(false));
  child.stdin.on('error', () => {});
  child.on('error', e => broadcast('line', `ERROR could not start runner: ${e.message}`)); // 'close' still follows
  child.on('close', code => {
    clearTimeout(watchdog);
    child = null;
    run.code = code; run.done = true;
    broadcast('done', { id: run.id, code, results: run.results, verdict: verdict(run), recovery: publicRecovery() });
  });
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => { try {
  if (!HOSTS.has(req.headers.host ?? '')) { res.writeHead(421); return res.end('wrong host'); } // DNS-rebinding guard
  const url = req.url.split('?')[0];
  // CORS alone prevents reading, not opening streams. Only the console's own origin (or a typed/bookmarked visit,
  // Sec-Fetch-Site "none") may call it. Another localhost port is "same-site", not same-origin, so it is refused too;
  // its no-cors requests carry no Origin header, which is why Sec-Fetch-Site is checked as well.
  const site = req.headers['sec-fetch-site'];
  const topLevelPage = req.method === 'GET' && url === '/' && req.headers['sec-fetch-dest'] === 'document';
  if (!topLevelPage && ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || (site && site !== 'same-origin' && site !== 'none')))
    return json(res, 403, { error: 'console origin required' });
  if (req.method === 'GET' && url === '/') {
    if (req.headers['sec-fetch-dest'] && req.headers['sec-fetch-dest'] !== 'document') return json(res, 403, { error: 'top-level page only' });
    // Never framed: another page cannot overlay the console and steer clicks onto RUN or RESTORE.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
    return res.end(await readFile(here + 'index.html'));
  }
  if (req.method === 'GET' && url === '/events') {
    if (req.headers['sec-fetch-dest'] && req.headers['sec-fetch-dest'] !== 'empty') return json(res, 403, { error: 'event stream request required' });
    if (clients.size >= MAX_STREAMS) { res.writeHead(503); return res.end('too many consoles open'); }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    send(res, 'reset', snapshot());
    if (run) for (const [ev, data] of run.events) send(res, ev, data);
    send(res, 'live', {}); // replay over: what follows is happening now
    clients.add(res);
    res.on?.('error', () => clients.delete(res));
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); }); // the run keeps going
    return;
  }
  if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
  if (req.headers['x-blackbox-console'] !== '1') return json(res, 403, { error: 'missing console header' });

  let m;
  if ((m = url.match(/^\/run\/([1-4])$/))) {
    if (child) return json(res, 409, { error: 'another run is in progress' });
    const rec = m[1] === '2' && pendingRecovery();
    if (rec) return json(res, 409, { error: rec.invalid ? `RECOVERY REQUIRED: ${rec.error}` : 'a demo edit is still pending: restore it first' });
    start(m[1]);
    return json(res, 202, { id: run.id });
  }
  if (url === '/release') {
    if (!run || req.headers['x-blackbox-run'] !== run.id) return json(res, 409, { error: 'release belongs to a different run' });
    // Only while the detected edit is actually held: an early release would be buffered and skip the hold entirely.
    if (!child || run.n !== '2' || run.phases.at(-1)?.phase !== 'DETECTED') return json(res, 409, { error: 'no tamper hold in progress' });
    child.stdin.write('release\n');
    return json(res, 202, {});
  }
  if (url === '/restore') {
    if (child) return json(res, 409, { error: 'wait for the current run to finish' });
    const rec = pendingRecovery();
    if (!rec) return json(res, 409, { error: 'no pending demo edit' });
    if (rec.invalid) return json(res, 409, { error: `RECOVERY REQUIRED: ${rec.error}; restore it by hand, then delete attack/.tamper-recovery.json` });
    start('restore');
    return json(res, 202, { id: run.id });
  }
  res.writeHead(404); res.end();
} catch (e) { if (!res.headersSent) res.writeHead(500); res.end(String(e?.message ?? e)); } // never take the bridge down mid-run
}).listen(PORT, '127.0.0.1', () => console.log(`Demo console: http://127.0.0.1:${PORT}  (target ${DB} on ${TARGET})`)); // loopback only
