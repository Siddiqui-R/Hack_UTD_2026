// Tiny local bridge for the demo console. Serves index.html and streams one demo script's output.
// Run from repo root:  node attacker/server.mjs   then open http://localhost:4400
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const attackDir = fileURLToPath(new URL('../attack/', import.meta.url));
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
let busy = false;

http.createServer(async (req, res) => {
  const m = req.url.match(/^\/run\/([1-4])$/);
  if (!m) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(await readFile(here + 'index.html'));
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  if (busy) { send('line', 'busy — another run in progress'); return res.end(); }
  busy = true;
  const child = spawn(process.execPath, [here + 'runner.mjs', m[1]], { cwd: attackDir, env: process.env });
  let buf = '';
  const onData = d => {
    buf += strip(d.toString());
    const parts = buf.split(/\r?\n/); buf = parts.pop();
    for (const line of parts) {
      if (line.startsWith('@@RESULT ')) send('result', JSON.parse(line.slice(9)));
      else if (line.trim()) send('line', line);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', code => { busy = false; send('done', { code }); res.end(); });
  req.on('close', () => { if (child.exitCode === null) child.kill(); });
}).listen(4400, '127.0.0.1', () => console.log('Demo console: http://localhost:4400')); // loopback only: no LAN callers
