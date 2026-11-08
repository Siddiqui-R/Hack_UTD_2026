// NEMOTRON agent run.
//   node src/run.mjs                 mock: scripted tool sequence, real DB writes, no NVIDIA calls (default)
//   node src/run.mjs --live          one real Nemotron run (spends credits; budget-capped)
//   node src/run.mjs --live --deep   same, with MODEL_DEEP
//   node src/run.mjs --replay [file] re-run a recorded live run's tool calls step by step (no credits)
// The service identity must be enrolled to an incident by a commander first (see README).
import fs from 'node:fs';
import path from 'node:path';
import { generateText, isStepCount } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { config } from './config.mjs';
import { serviceIdentity, procedure } from './db.mjs';
import { makeTools } from './tools.mjs';
import { SYSTEM_PROMPT, userPrompt } from './prompt.mjs';

const args = process.argv.slice(2);
const mode = args.includes('--live') ? 'live' : args.includes('--replay') ? 'replay' : config.mode;
const modelId = args.includes('--deep') ? config.modelDeep : config.modelFast;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clock = () => new Date().toISOString().slice(11, 19);
const badge = id => `${/ultra/.test(id) ? 'ULTRA 550B' : /lightning/.test(id) ? 'LIGHTNING 30B' : id.split('/').pop().toUpperCase()}`;

fs.mkdirSync(config.logDir, { recursive: true });

async function main() {

// ---- context -----------------------------------------------------------------------------
const me = await serviceIdentity();
let incident, evidence;
try {
  [incident] = await procedure('search_incidents', ['']);
  if (!incident) throw new Error('no incident visible');
  evidence = await procedure('evidence_records', [Number(incident.incidentId)]);
} catch (err) {
  console.error(`Agent identity ${me.identity} is not enrolled (${err.message}).`);
  console.error('A commander must enroll it: enroll_agent(target = that identity, incidentId). Dev: node scripts/dev-setup.mjs');
  return void (process.exitCode = 2);
}

const run = {
  incident: { ...incident },
  flaggedConflict: false,
  events: [],
  trace(e) {
    this.events.push({ at: Date.now(), ...e });
    const args = e.input ? Object.values(e.input).map(v => JSON.stringify(v)).join(', ') : '';
    if (e.kind === 'call') console.log(`[${clock()}] → ${e.name}(${args.length > 90 ? args.slice(0, 90) + '…' : args})`);
    if (e.kind === 'result') console.log(`           ${e.failed ? '✗' : '✓'} ${JSON.stringify(e.output).slice(0, 110)}`);
  },
};
const tools = makeTools(run);
const t0 = performance.now();
console.log(`NEMOTRON · ${mode.toUpperCase()} · incident #${incident.incidentId} "${incident.title}" · ${evidence.length} evidence`);

// ---- modes ----------------------------------------------------------------------------------
let summary = '';

if (mode === 'mock') {
  // Realistic scripted sequence with the same delays the UI expects. Real tool calls, no model.
  const plan = [
    ['searchIncidents', { query: incident.title.split(/\s+/)[0] }],
    ['getScope', { incidentId: Number(incident.incidentId) }],
    ['createTask', { text: 'Isolate affected hosts from the network and preserve volatile memory', assigneeRole: 'responder' }],
  ];
  if (evidence.length >= 2) {
    plan.push(['flagConflict', { evidenceIdA: Number(evidence[0].id), evidenceIdB: Number(evidence[1].id),
      reason: 'Records disagree on the initial access vector; revising the timeline.' }]);
  }
  plan.push(['updateSeverity', { incidentId: Number(incident.incidentId), severity: 'critical', reason: 'Encryption activity on production hosts.' }]);
  for (const [name, input] of plan) { await sleep(400); await tools[name].execute(input, {}); }
  summary = 'Mock run: isolated hosts, flagged conflicting evidence, raised severity.';
}

if (mode === 'live') {
  if (config.metered && !config.nvidiaKey) { console.error('NVIDIA_API_KEY missing from .env'); return void (process.exitCode = 2); }
  const counterFile = path.join(config.logDir, 'live-call-count.json');
  const counter = fs.existsSync(counterFile) ? JSON.parse(fs.readFileSync(counterFile, 'utf8')) : { count: 0, calls: [] };
  const left = config.metered ? config.liveBudget - counter.count : config.maxSteps;
  if (left <= 0) { console.error(`live-call budget exhausted (${counter.count}/${config.liveBudget})`); return void (process.exitCode = 2); }
  if (!config.metered) console.log(`(self-hosted endpoint ${new URL(config.nvidiaBase).host}: credit budget not applied)`);
  const spend = () => {
    if (!config.metered) return;
    counter.count += 1;
    counter.calls.push({ n: counter.count, at: new Date().toISOString(), label: `agent ${modelId}` });
    fs.writeFileSync(counterFile, JSON.stringify(counter, null, 2));
  };

  const nvidia = createOpenAICompatible({ name: 'nvidia', baseURL: config.nvidiaBase, apiKey: config.nvidiaKey || 'none' });
  const result = await generateText({
    model: nvidia.chatModel(modelId),
    system: SYSTEM_PROMPT,
    prompt: userPrompt(incident, evidence),
    tools,
    temperature: 1.0,
    topP: 0.95,
    maxOutputTokens: 4096,  // these models reason first; small caps return empty output
    maxRetries: 0,          // never retry: retries cost credits
    stopWhen: [
      isStepCount(Math.min(config.maxSteps, left)),
      ({ steps }) => steps.at(-1)?.content.some(p => p.type === 'tool-error') ?? false, // malformed call: stop, don't retry
    ],
    onStepFinish: () => spend(),
  });
  summary = result.text;
}

if (mode === 'replay') {
  const file = args[args.indexOf('--replay') + 1]?.endsWith('.json') ? args[args.indexOf('--replay') + 1]
    : fs.readdirSync(config.logDir).filter(f => f.startsWith('run-') && f.includes('-live-')).sort().map(f => path.join(config.logDir, f)).pop();
  if (!file) { console.error('no recorded live run in agent-logs/'); return void (process.exitCode = 2); }
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`(replaying ${path.basename(file)}: a recorded run of ${badge(rec.model)})`);
  for (const e of rec.events.filter(e => e.kind === 'call')) { await sleep(400); await tools[e.name].execute(e.input, {}); }
  summary = rec.summary;
}

// ---- finish -------------------------------------------------------------------------------------
const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`\n${badge(modelId)} · ${secs}s\n${summary}`);
const out = path.join(config.logDir, `run-${Date.now()}-${mode}-${badge(modelId).replace(/\W+/g, '')}.json`);
fs.writeFileSync(out, JSON.stringify({ mode, model: modelId, incident, evidenceIds: evidence.map(e => e.id), events: run.events, summary, secs }, null, 2));
console.log(`log: ${path.relative(process.cwd(), out)}`);
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
