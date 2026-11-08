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

export const config = {
  mode: env.AGENT_MODE ?? 'mock',                  // mock | live | replay
  nvidiaKey: env.NVIDIA_API_KEY ?? '',
  nvidiaBase: env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
  modelFast: env.MODEL_FAST ?? 'nvidia/nemotron-3.5-lightning-30b-a3b',
  modelDeep: env.MODEL_DEEP ?? 'nvidia/nemotron-3-ultra-550b-a55b',
  stdbUrl: (env.STDB_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, ''),
  stdbDb: env.STDB_DB ?? 'blackbox',
  maxSteps: 8,
  liveBudget: 40,                                  // applies only to NVIDIA's hosted API (see `metered`)
  logDir: path.join(ROOT, 'agent-logs'),           // gitignored at repo root
  tokenFile: path.join(AGENT_DIR, '.agent-token'), // gitignored in agent/
};

// Only build.nvidia.com's hosted API spends the 40-call credit budget. A self-hosted endpoint
// (NIM or vLLM on Brev) is unmetered: no counter, no budget cap, API key optional.
function isMetered(base) {
  try { return new URL(base).hostname === 'integrate.api.nvidia.com'; } catch { return true; }
}
config.metered = isMetered(config.nvidiaBase);
