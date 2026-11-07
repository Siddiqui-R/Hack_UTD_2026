// One-shot model probe. Every request counts against the 40-call live budget.
// Usage: node agent/probe-models.mjs auth            -> 1 minimal call against MODEL_FAST
//        node agent/probe-models.mjs tools <model>   -> 1 tool-calling call against <model>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const KEY = env.NVIDIA_API_KEY;
const BASE = env.NVIDIA_BASE_URL;
if (!KEY || KEY === 'REPLACE_ME') throw new Error('NVIDIA_API_KEY not set in .env');

const LOG_DIR = path.join(ROOT, 'agent-logs');
const COUNTER = path.join(LOG_DIR, 'live-call-count.json');
const BUDGET = 40;
fs.mkdirSync(LOG_DIR, { recursive: true });

function spendCall(label) {
  const c = fs.existsSync(COUNTER) ? JSON.parse(fs.readFileSync(COUNTER, 'utf8')) : { count: 0, calls: [] };
  if (c.count >= BUDGET) throw new Error(`live-call budget exhausted (${c.count}/${BUDGET})`);
  c.count += 1;
  c.calls.push({ n: c.count, at: new Date().toISOString(), label });
  fs.writeFileSync(COUNTER, JSON.stringify(c, null, 2));
  return c.count;
}

async function chat(model, body, label) {
  const n = spendCall(`${label} ${model}`);
  const t0 = performance.now();
  let res, json, text;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model, temperature: 1.0, top_p: 0.95, ...body }),
      signal: AbortSignal.timeout(90_000),
    });
    text = await res.text();
    try { json = JSON.parse(text); } catch { json = undefined; }
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    return { n, model, ms, status: 'NETWORK_ERROR', error: String(err) };
  }
  const ms = Math.round(performance.now() - t0);
  const out = { n, model, ms, status: res.status, json, raw: json ? undefined : text.slice(0, 500) };
  fs.writeFileSync(path.join(LOG_DIR, `probe-${Date.now()}-${model.replace(/\W+/g, '_')}.json`), JSON.stringify(out, null, 2));
  return out;
}

const [mode, modelArg] = process.argv.slice(2);

if (mode === 'auth') {
  const r = await chat(env.MODEL_FAST, { messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 16 }, 'auth');
  console.log(JSON.stringify({
    call: r.n, model: r.model, http: r.status, ms: r.ms,
    authenticated: r.status !== 401 && r.status !== 403,
    reply: r.json?.choices?.[0]?.message?.content ?? null,
    error: r.json?.detail ?? r.json?.error ?? r.raw ?? r.error ?? null,
  }, null, 2));
} else if (mode === 'tools') {
  const tools = [{
    type: 'function',
    function: {
      name: 'getScope',
      description: 'Get the compromised-data scope for an incident.',
      parameters: {
        type: 'object',
        properties: { incidentId: { type: 'number', description: 'Incident ID' } },
        required: ['incidentId'],
      },
    },
  }];
  const r = await chat(modelArg, {
    messages: [
      { role: 'system', content: 'You are an incident response agent. Use the provided tools.' },
      { role: 'user', content: 'What data was compromised in incident 7? Call the tool.' },
    ],
    tools,
    tool_choice: 'auto',
    max_tokens: 4096,
  }, 'tools');
  const msg = r.json?.choices?.[0]?.message;
  const call = msg?.tool_calls?.[0];
  let args = null, argsParse = 'n/a';
  if (call) {
    try { args = JSON.parse(call.function.arguments); argsParse = 'ok'; } catch { argsParse = 'invalid JSON'; }
  }
  const parsedOk = call?.function?.name === 'getScope' && args && Number(args.incidentId) === 7;
  console.log(JSON.stringify({
    call: r.n, model: r.model, http: r.status, ms: r.ms,
    responded: r.status === 200,
    toolCalled: !!call, toolName: call?.function?.name ?? null, args, argsParse,
    toolCallCorrect: !!parsedOk,
    finishReason: r.json?.choices?.[0]?.finish_reason ?? null,
    textContent: msg?.content ? String(msg.content).slice(0, 200) : null,
    usage: r.json?.usage ?? null,
    error: r.status === 200 ? null : (r.json?.detail ?? r.json?.error ?? r.raw ?? r.error ?? null),
  }, null, 2));
} else {
  console.error('usage: auth | tools <model>');
  process.exit(2);
}
