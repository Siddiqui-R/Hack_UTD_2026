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
```

Every run prints a live trace (`[14:32:07] → searchIncidents("Payroll")`), ends with a model badge
(`LIGHTNING 30B · 2.1s`), and writes a full log to `agent-logs/run-*.json` (gitignored).

## Identity
The service uses its own SpacetimeDB identity, stored in `agent/.agent-token` (gitignored). A commander must enroll it:
`enroll_agent(target = <identity printed on first run>, incidentId)`. Unenrolled, the agent prints its identity and exits.

## Credit discipline
- `maxRetries: 0`, `maxOutputTokens: 4096` (these models reason first), at most 8 steps, `temperature 1.0 / top_p 0.95`.
- Each model step increments `agent-logs/live-call-count.json`, and the step cap shrinks to the remaining budget (40 total).
- A malformed tool call (fails Zod validation) ends the run instead of being retried.

## Injection defense
1. Evidence is wrapped in `<evidence id nonce>` markers with a per-run random nonce, so text can't fake a closing tag.
   The system prompt says it's untrusted data, and that embedded instructions are a finding to report.
2. The server refuses the agent every human operation (role, invite, revoke, enroll, close, create incident): 25 attacks in
   `attack/suites/slice03b-agent-contract.mjs`.
3. Agent-side policy: a severity **downgrade** is refused unless this run flagged an evidence conflict. That blocks the
   "mark this resolved" injection while still allowing a real evidence-backed revision. Server-side version: finding G19.

AI SDK note: installed `ai@7`. The step limit helper is **`isStepCount`** (`stepCountIs` no longer exists); tools use `inputSchema`.
