// Config from the repo-root .env (same file probe-models.mjs uses) plus process env overrides.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(AGENT_DIR, '..');

function readEnv() {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)
        .filter(l => /^[A-Z_]+=/.test(l))
        .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch { return {}; }
}
const env = { ...readEnv(), ...process.env };

// --cloud (or STDB_TARGET=maincloud) targets the deployed database with its own token file, so the local
// and production service identities never share storage. Explicit STDB_URL/STDB_DB in the shell still win.
const cloud = process.argv.includes('--cloud') || env.STDB_TARGET === 'maincloud';
const MAINCLOUD = { url: 'https://maincloud.spacetimedb.com', db: 'blackbox-utd2026-abbas9x' };
const pick = (name, local, remote) => cloud ? (process.env[name] ?? remote) : (env[name] ?? local);

export const config = {
  target: cloud ? 'maincloud' : 'local',
  mode: env.AGENT_MODE ?? 'mock',                  // mock | live | replay
  nvidiaKey: env.NVIDIA_API_KEY ?? '',
  nvidiaBase: env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
  modelFast: env.MODEL_FAST ?? 'nvidia/nemotron-3.5-lightning-30b-a3b',
  modelDeep: env.MODEL_DEEP ?? 'nvidia/nemotron-3-ultra-550b-a55b',
  stdbUrl: pick('STDB_URL', 'http://127.0.0.1:3000', MAINCLOUD.url).replace(/\/$/, ''),
  stdbDb: pick('STDB_DB', 'blackbox', MAINCLOUD.db),
  maxSteps: 8,
  liveBudget: 40,                                  // applies only to NVIDIA's hosted API (see `metered`)
  logDir: path.join(ROOT, 'agent-logs'),           // gitignored at repo root
  // Separate files for separate workers; gitignored as .agent-token*.
  tokenFile: env.AGENT_TOKEN_FILE ?? path.join(AGENT_DIR, cloud ? '.agent-token.maincloud' : '.agent-token'),
  replayFile: env.AGENT_REPLAY_FILE,
  pollMs: cloud ? 1500 : 1000,
};

// Only build.nvidia.com's hosted API spends the 40-call credit budget. A self-hosted endpoint
// (NIM or vLLM on Brev) is unmetered: no counter, no budget cap, API key optional.
function isMetered(base) {
  try { return new URL(base).hostname === 'integrate.api.nvidia.com'; } catch { return true; }
}
config.metered = isMetered(config.nvidiaBase);
