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
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const attackDir = fileURLToPath(new URL('../attack/', import.meta.url));
const recoveryFile = fileURLToPath(new URL('../attack/.tamper-recovery.json', import.meta.url));
const { TARGET, DB, guardTarget } = await import('../attack/lib.mjs');
guardTarget(); // same local-only rule as the scripts
const PORT = 4400;
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

const pendingRecovery = () => { try { return JSON.parse(fs.readFileSync(recoveryFile, 'utf8')); } catch { return null; } };

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
  if (errors.length || code !== 0 || !run.gotResult)
    return { kind: 'error', label: 'ERROR', stamp: 'ERROR', facts: errors.length ? errors.map(why)
      : [code === null || code > 255 ? 'script was killed before it finished' : `script exited with code ${code}${run.gotResult ? '' : ', no results reported'}`] };
  if ((n === '2' || n === 'restore') && pendingRecovery())
    return { kind: 'incomplete', label: 'EDIT NOT RESTORED', stamp: 'INCOMPLETE', facts: ['the demo edit is still in place · use RESTORE DEMO EDIT'] };
  if (missing.length || notPass.length)
    return { kind: 'incomplete', label: 'INCOMPLETE', stamp: 'INCOMPLETE', facts: [...notPass.map(why), ...missing.map(id => `${id} not reported`)] };
  return { kind: 'held', ...HELD[n], facts: factsFor(n, results, phases) };
}

let run = null;   // the current or last run; survives browser reconnects
let child = null;
const clients = new Set();
const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
const broadcast = (ev, data) => { run.events.push([ev, data]); for (const c of clients) send(c, ev, data); };
const snapshot = () => ({ target, recovery: pendingRecovery(), busy: !!child, run: run && { id: run.id, n: run.n, done: run.done } });

function start(n) {
  run = { id: Date.now(), n, events: [], results: [], phases: [], code: null, gotResult: false, done: false };
  for (const c of clients) send(c, 'reset', snapshot());
  broadcast('start', { n, id: run.id });
  child = spawn(process.execPath, [here + 'runner.mjs', n], { cwd: attackDir, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const onData = d => {
    buf += strip(d.toString());
    const parts = buf.split(/\r?\n/); buf = parts.pop();
    for (const line of parts) {
      if (line.startsWith('@@RESULT ')) { run.results = JSON.parse(line.slice(9)); run.gotResult = true; }
      else if (line.startsWith('@@PHASE ')) { const p = { ...JSON.parse(line.slice(8)), t: Date.now() }; run.phases.push(p); broadcast('phase', p); }
      else if (line.trim()) broadcast('line', line);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.stdin.on('error', () => {});
  child.on('close', code => {
    child = null;
    run.code = code; run.done = true;
    broadcast('done', { code, results: run.results, verdict: verdict(run), recovery: pendingRecovery() });
  });
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  if (!HOSTS.has(req.headers.host ?? '')) { res.writeHead(421); return res.end('wrong host'); } // DNS-rebinding guard
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(await readFile(here + 'index.html'));
  }
  if (req.method === 'GET' && url === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    send(res, 'reset', snapshot());
    if (run) for (const [ev, data] of run.events) send(res, ev, data);
    send(res, 'live', {}); // replay over: what follows is happening now
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); }); // the run keeps going
    return;
  }
  if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
  if (req.headers['x-blackbox-console'] !== '1') return json(res, 403, { error: 'missing console header' });

  let m;
  if ((m = url.match(/^\/run\/([1-4])$/))) {
    if (child) return json(res, 409, { error: 'another run is in progress' });
    if (m[1] === '2' && pendingRecovery()) return json(res, 409, { error: 'a demo edit is still pending: restore it first' });
    start(m[1]);
    return json(res, 202, { id: run.id });
  }
  if (url === '/release') {
    if (!child || run.n !== '2') return json(res, 409, { error: 'no tamper hold in progress' });
    child.stdin.write('release\n');
    return json(res, 202, {});
  }
  if (url === '/restore') {
    if (child) return json(res, 409, { error: 'wait for the current run to finish' });
    if (!pendingRecovery()) return json(res, 409, { error: 'no pending demo edit' });
    start('restore');
    return json(res, 202, { id: run.id });
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`Demo console: http://127.0.0.1:${PORT}  (target ${DB} on ${TARGET})`)); // loopback only
