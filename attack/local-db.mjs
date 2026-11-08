// Publish (or republish, keeping data) the security suite's own local database, owned by a dedicated login.
//   npm run local:publish        (from attack/; local server on 127.0.0.1:3000 must be running)
// First run mints a local identity and stores it in attack/.env.owner-cli.toml (gitignored, never printed), so the
// default `spacetime` login can stay on Maincloud. lib.mjs then uses that file and the `blackbox-attack` database.
// Anchoring stays unconfigured here: SpacetimeDB refuses procedure HTTP to this machine's own loopback address,
// so a local checkpoint store cannot work. ANCHOR MISMATCH is shown on the deployed module.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('./.env.owner-cli.toml', import.meta.url));
const modulePath = fileURLToPath(new URL('../blackbox/spacetimedb', import.meta.url));
const server = 'http://127.0.0.1:3000';
const db = process.env.ATTACK_DB ?? 'blackbox-attack';

if (!fs.existsSync(configPath)) {
  const res = await fetch(`${server}/v1/identity`, { method: 'POST' }).catch(() => null);
  if (!res?.ok) { console.error(`Local SpacetimeDB not reachable at ${server}; run \`spacetime start\` first`); process.exit(1); }
  const { identity, token } = await res.json();
  fs.writeFileSync(configPath, [
    'default_server = "local"', `spacetimedb_token = "${token}"`, '',
    '[[server_configs]]', 'nickname = "local"', 'host = "127.0.0.1:3000"', 'protocol = "http"', '',
  ].join('\n'), { mode: 0o600 });
  console.log(`Created local owner login ${identity} in ${configPath}`);
}

const r = spawnSync('spacetime', ['--config-path', configPath, 'publish', db, '--server', 'local',
  '--module-path', modulePath, '--no-config', '--yes', '--delete-data=never'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
