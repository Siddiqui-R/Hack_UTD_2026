// SpacetimeDB access for the agent's service identity, over the HTTP API (see AGENT_CONTRACT.md).
// The service identity's token is persisted privately in agent/.agent-token (gitignored).
import fs from 'node:fs';
import { config } from './config.mjs';

let me;

// Load or mint the service identity. A commander must enroll it before any tool works.
export async function serviceIdentity() {
  if (me) return me;
  try { me = JSON.parse(fs.readFileSync(config.tokenFile, 'utf8')); return me; } catch { /* mint below */ }
  const res = await fetch(`${config.stdbUrl}/v1/identity`, { method: 'POST' });
  if (!res.ok) throw new Error(`cannot reach SpacetimeDB at ${config.stdbUrl} (HTTP ${res.status})`);
  const { identity, token } = await res.json();
  me = { identity: identity.startsWith('0x') ? identity : `0x${identity}`, token };
  fs.writeFileSync(config.tokenFile, JSON.stringify(me), { mode: 0o600 });
  return me;
}

async function post(name, args) {
  const { token } = await serviceIdentity();
  const res = await fetch(`${config.stdbUrl}/v1/database/${config.stdbDb}/call/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.trim().replace(/^.*fatal error: /, '').split('\n')[0] || `HTTP ${res.status}`);
  return text;
}

// Reducers return nothing; procedures return a JSON string.
export const reducer = (name, args) => post(name, args).then(() => ({ ok: true }));
export const procedure = async (name, args) => {
  const body = JSON.parse(await post(name, args));
  return typeof body === 'string' ? JSON.parse(body) : body;
};

// u64 IDs arrive from the model as numbers; reject anything that isn't a safe positive integer.
export function u64(n, field) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${field} must be a positive integer id`);
  return n;
}
