// Owner-only recovery: mint a fresh single-use commander code (30-minute expiry) and print it.
// Usage: node blackbox/spacetimedb/deployment/commander-code.mjs local|maincloud
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const target = process.argv[2];
if (!['local', 'maincloud'].includes(target)) throw Error('Usage: node deployment/commander-code.mjs local|maincloud');

// Must match CODE_ALPHABET / CODE_LENGTH in the module. Rejection sampling keeps it uniform.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let code = '';
while (code.length < 8) for (const b of randomBytes(16)) if (b < 248 && code.length < 8) code += ALPHABET[b % ALPHABET.length];
code = `${code.slice(0, 4)}-${code.slice(4)}`;

const cli = resolve(process.env.LOCALAPPDATA, 'SpacetimeDB/bin/current/spacetimedb-cli.exe');
const config = target === 'local'
  ? resolve(process.env.LOCALAPPDATA, 'SpacetimeDB/config/cli.toml')
  : resolve(root, 'blackbox/spacetimedb/.env.maincloud-cli.toml');
const database = target === 'local' ? 'blackbox' : 'blackbox-utd2026-abbas9x';
const server = target === 'local' ? 'http://127.0.0.1:3000' : 'maincloud';

const r = spawnSync(cli, ['--config-path', config, 'call', database, 'issue_bootstrap_invite', JSON.stringify(code), '--server', server, '--no-config'],
  { cwd: root, encoding: 'utf8', windowsHide: true });
if (r.status !== 0) {
  process.stderr.write(r.stderr || r.stdout || 'call failed\n');
  process.exit(r.status ?? 1);
}
console.log(`COMMANDER CODE  ${code}   (${target}, single use, expires in 30 minutes)`);
