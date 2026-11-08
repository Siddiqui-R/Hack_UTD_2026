// Judge demo sign-in: POST mints one single-use RESPONDER invite code as the demo commander, so /?demo signs a judge
// in without typing anything. GET only keeps the demo commander's 15-minute session alive.
// Off unless the server-only DEMO_COMMANDER_TOKEN is set. The module still checks every code and role.
import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST' && request.method !== 'GET') return response.status(405).json({ error: 'POST or GET required' });
  const token = process.env.DEMO_COMMANDER_TOKEN, uri = process.env.VITE_STDB_URI, db = process.env.VITE_STDB_DB;
  if (!token || !uri || !db) return response.status(503).json({ error: 'demo sign-in is off' });
  const call = (reducer, args) => fetch(`${uri.replace(/^ws/, 'http').replace(/\/$/, '')}/v1/database/${db}/call/${reducer}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(args),
  });
  if (request.method === 'GET') {
    const r = await call('touch_session', []);
    return response.status(r.ok ? 200 : 502).json({ alive: r.ok });
  }
  let code;
  do code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  while (new Set(code).size < 5); // the module rejects weak codes
  const r = await call('create_invite', [code, 'responder']);
  if (!r.ok) return response.status(502).json({ error: 'demo sign-in unavailable' });
  return response.status(200).json({ code });
}
