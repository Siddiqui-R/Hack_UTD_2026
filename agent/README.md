# agent/ — NEMOTRON agent service

Runs Nemotron as a tool-using agent against BLACKBOX, per `AGENT_CONTRACT.md`. It reads one incident's evidence and acts
through 5 flat tools; three of them write to the database (`createTask`, `updateSeverity`, `flagConflict`).

```bash
cd agent && npm install
npm run dev:setup      # LOCAL ONLY: seeds a demo incident + 2 conflicting evidence records, enrolls this agent
npm run agent          # mock: scripted tool sequence, real DB writes, 400 ms steps, zero NVIDIA calls
npm run agent:live     # one real run on MODEL_FAST (spends credits, budget-capped)
npm run agent:deep     # one real run on MODEL_DEEP
npm run agent:replay   # replays the latest recorded live run's tool calls (no credits): use this at judging
npm run worker         # poll the INVESTIGATE queue until stopped (mock/replay only)
npm run worker:once    # consume at most one queued request, then exit
npm run demo:check     # read-only enrollment, golden-replay, budget and PDF HTTP preflight
```

Every run prints a live trace (`[14:32:07] → searchIncidents("Payroll")`), ends with a model badge
(`LIGHTNING 30B · 2.1s`), and writes a full log to `agent-logs/run-*.json` (gitignored).

## Identity
The service uses its own SpacetimeDB identity, stored in `agent/.agent-token` (gitignored). A commander must enroll it:
`enroll_agent(target = <identity printed on first run>, incidentId)`. Unenrolled, the agent prints its identity and exits.

## Credit discipline
- `maxRetries: 0`, `maxOutputTokens: 4096` (these models reason first), at most 8 steps, `temperature 1.0 / top_p 0.95`.
- Each model step reserves a call in `agent-logs/live-call-count.json` BEFORE requesting the provider, including failed
  requests. The step cap shrinks to the remaining budget (40 total). A missing counter starts at the known 5 probe calls;
  carry forward higher counts from other machines before using live mode.
- A malformed tool call (fails Zod validation) ends the run instead of being retried.
- The budget only applies when `NVIDIA_BASE_URL` is `integrate.api.nvidia.com`. Point it at a self-hosted OpenAI-compatible
  endpoint (NIM or vLLM on Brev, e.g. `http://<host>:8000/v1`, with `MODEL_FAST` set to the served model name) and live runs
  are uncapped, don't touch the counter, and don't need `NVIDIA_API_KEY`.

## Injection defense
1. Evidence is wrapped in `<evidence id nonce>` markers with a per-run random nonce, so text can't fake a closing tag.
   The system prompt says it's untrusted data, and that embedded instructions are a finding to report.
2. The server refuses the agent every human operation (role, invite, revoke, enroll, close, create incident): 25 attacks in
   `attack/suites/slice03b-agent-contract.mjs`.
3. Agent-side policy: every severity downgrade requires human review, matching the server's raise-only policy.

## Queue integration and cancellation
Use the dedicated enrolled service identity. The existing UI queues mock/replay requests; the worker honors the request's
tier even when AGENT_MODE differs, claims with the actual mock/model identity, publishes awaited call/result/revision/
summary/error traces, and finishes completed/failed runs. It polls agentRunStatus for the exact claimed run before
every trace/tool action; cancellation or trace rejection stops before the next tool action. A missing
or model/incident-mismatched live recording fails replay; it never calls NVIDIA. Set AGENT_REPLAY_FILE for a specific
recording. Recordings must match the incident/model; evidence IDs are never silently rebound to unrelated records.

One process per service identity is enforced by an exclusive worker-*.lock under ignored agent-logs/. Separate workers
need separate identities/tokens (AGENT_TOKEN_FILE). After a hard kill, verify the PID in a stale lock is no longer running
before removing that lock. Sessions still expire after 15 minutes idle; a commander must re-enroll an idle service.

Q1 remains a module contract gap: recordAgentStep infers the currently running run. A cancelled old worker sharing an
identity with a newly claimed run can misattribute a delayed trace. The local process lock mitigates ordinary duplicate
workers; server enforcement needs an agreed expected runId argument. No signatures were changed in this integration.
Cancellation cannot roll back a tool action that has already committed or atomically guard the existing write reducers.

AI SDK note: installed `ai@7`. The step limit helper is **`isStepCount`** (`stepCountIs` no longer exists); tools use `inputSchema`.

## Judging preflight

`npm run demo:check` exits nonzero until the configured service identity can read its enrolled incident,
a matching FAST live recording exists, the database is reachable, and the PDF HTTP health endpoint responds.
It also reports whether live-recording credentials/budget are available. It never mints tokens, changes data,
prints credentials/evidence, or calls a model. `-- --json` emits machine-readable results. Set PDF_HEALTH_URL
to check a hosted health endpoint; HTTP health alone does not verify Chromium or the authenticated PDF adapter.

The 2026-11-07 local demo rehearsal passed all 16 checks on 10 consecutive runs. The network test exercises
real SDK WebSocket disconnect/reconnect and catch-up, not a physical phone-hotspot or browser-offline test.
The injection demo verifies evidence fencing and server refusals, not a real model's response to the payload.
A real golden recording still requires the NVIDIA key (or the chosen self-hosted endpoint), a live run on the
same demo incident, then successful replay. No synthetic transcript should be presented as a model recording.
