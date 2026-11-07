# BLACKBOX — STATUS

Rabeet: read this to know what is ready to attack. Newest entries at the bottom of the log.

## How to run locally

```bash
spacetime start                                            # terminal 1, leave running (ws://localhost:3000)
cd blackbox
spacetime publish blackbox --server local --module-path ./spacetimedb --no-config --yes
spacetime generate --lang typescript --out-dir client/src/module_bindings --module-path ./spacetimedb --no-config --yes
cd client && npm install && npm run dev                    # http://localhost:5173
```
`--no-config` is needed because `spacetime.json` defaults to Maincloud. Inspect data with
`spacetime sql --server local --no-config blackbox "SELECT * FROM ping"`.

## Slices

| # | Slice (DB → reducer → UI) | Attack target | Status |
|---|---|---|---|
| 0 | Ping table syncing two tabs | — (Gate 0) | [x] |
| 1 | Users + roles + `ctx.sender` checks on one write | acting as the wrong role | [x] |
| 2 | Invite codes → real session identity → role | replay, reuse, expiry, forged code | [ ] |
| 3 | Incident create/read + structured form + COMMAND shell | observer writing, missing audit rows | [ ] |
| 4 | Audit chain + `verifyChain` + status bar | row edits, canonicalJson, seq gaps | [ ] |
| 5 | Real-time chat | cross-incident message leakage | [ ] |
| 6 | Scope items | observer reading scope | [ ] |
| 7 | Agent service, read-only tools (`searchIncidents`, `getScope`) | injection payloads | [ ] |
| 8 | Agent write tools (`createTask`, `updateSeverity`, `flagConflict`) | NEMOTRON escalating itself / self-approving | [ ] |
| 9 | External anchor + `anchorOk` + anchor-mismatch UI | rewrite the whole chain | [ ] |
| 10 | Two-person approval on destructive actions | self-approve, same user twice | [ ] |
| 11 | INVESTIGATE view: live tool calls + self-correction diff | conflict flow correctness | [ ] |
| 12 | RECORD view + PDF export with anchored head hash | report integrity | [ ] |
| 13 | Duress PIN · TOTP · scenario presets · seed data | polish | [ ] |

## Log

[17:21] SLICE 0 — ping table → add_ping reducer → React page. DONE. GATE 0 GREEN.
  Works: two tabs (two different identities) sync both directions live; CLI insert shows in browser; blank text rejected server-side
  Stack: SpacetimeDB 2.14 TS module (blackbox/spacetimedb), Vite + React 18.3.1 + TS 5.9 client (blackbox/client), local server only
  Attack this: nothing security-relevant yet — ping is public and unauthenticated by design. Sanity-check the run steps above work on your machine.
[17:31] SLICE 1 — users + roles + ctx.sender checks. DONE.
  Works: private `user` table (identity, displayName, role, joinedAt, isDuressed) exposed only via `team` view;
    `register` (first registrant = commander, rest = observer); `set_role` commander-only, no self-change;
    `add_ping` commander/responder only. Per-tab identity via sessionStorage token.
  Verified: observer add_ping / set_role (self-promote, demote commander) denied; commander self-change denied;
    anonymous SQL on `user` -> "no such table... private"; anonymous set_role -> "not registered".
  Stubbed: bootstrap "first to register becomes commander" is TEMPORARY — slice 2 replaces it with invite codes.
  Not yet: audit rows (slice 4), NEMOTRON actor rejection (slice 8).
  Attack this: call set_role/add_ping as observer or unregistered via `spacetime call --anonymous`; try to read `user`
    or `is_duressed` from a client; pass a bogus role string; race two tabs to register first.
[17:33] NVIDIA KEY + MODEL PROBE. DONE. 5/40 live calls used (counter: agent-logs/live-call-count.json, local only).
  Auth: key authenticates (HTTP 200, 417 ms) against nemotron-3.5-lightning-30b-a3b.
  Tool-call probe (1 call each, 1 flat tool `getScope(incidentId)`, temp 1.0 / top_p 0.95, script: agent/probe-models.mjs):
    | model                                   | HTTP | latency | tool call             | finish     | reasoning tok |
    | nvidia/nemotron-3.5-lightning-30b-a3b   | 200  | 598 ms  | getScope({incidentId:7}) OK | tool_calls | 12 |
    | nvidia/nemotron-3-ultra-550b-a55b       | 200  | 801 ms  | getScope({incidentId:7}) OK | tool_calls | 30 |
    | nvidia/nemotron-3.5-super-vl-120b-a12b  | 200  | 666 ms  | getScope({incidentId:7}) OK | tool_calls | 27 |
    | nvidia/nemotron-3.5-bolt-e4b            | 200  | 474 ms  | getScope({incidentId:7}) OK | tool_calls | 0  |
  Routing unchanged: MODEL_FAST=lightning, MODEL_DEEP=ultra. No fallback triggered (Ultra well under 15 s).
  Note: lightning/ultra/super emit `reasoning_content` by default — a tight max_tokens is spent entirely on reasoning
    (auth call with max_tokens 16 returned empty content, finish=length). Agent must use generous max_tokens.
  Caveat: single short prompt, one tool. Real 5-tool multi-step runs will be slower; re-measure in slice 7.
  Attack this: nothing yet — agent service is slice 7.

## Known, not fixing
