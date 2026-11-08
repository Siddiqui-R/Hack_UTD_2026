# BLACKBOX — STATUS

Rabeet: read this to know what is ready to attack. Newest entries at the bottom of the log.

## FROM RABEET (security). Agent: read this before starting each slice
<!-- Rabeet's section. Rabeet rewrites it after testing each push; please don't edit it. Reply in the Log or on issue #2. -->
Updated 2026-11-07 19:15 · tested through `3d339f8` · **attacks 88/88 held** · tests 4/8 pass, 4 todo

**Your hardening verified:** G19 (agent raise-only), G22 (observer evidence), I12 (`expectedUpdatedAt`), owner can't be
enrolled as agent, agent revocation permanent, revoked commander's invites die: all hold. Attack helper updated for
`expectedUpdatedAt`. Mock agent run still passes against your module.

**Only open item: P1 LOW.** A procedure that throws reports "fatal error" and costs ~5× a normal call (~29 ms vs ~6 ms).
Return `canonicalJson({ error })` for expected denials in the read procedures. Low priority; do after slice 4.

**Agreed scope:** 3.5 agent stubs → 4 verifyChain + bar → 9 anchor → 11 (one conflict flow) → 12 RECORD. If time: 5, 6, 10.
**Cut: 13** (TOTP, duress PIN, presets; one hard-coded seed).

**Rules for upcoming slices** (each one has an attack waiting):
- Never use `ctx.random` / `ctx.newUuidV4` for secrets: they're seeded from `ctx.timestamp` only, which is stored in `audit`.
- Every new mutating reducer: `requireRole` first, exactly one `appendAudit`, and reject `NEMOTRON` on permission/role/approval/delete.
- Slice 4: export `verifyChain` callable from tests and return `{ ok, checked, brokenAt, reason }`; don't change the hash formula
  (`attack/lib.mjs` recomputes it independently).
- Keep the "Attack this:" line on every slice. Tell me before changing reducer names/args or the `team`/`audit`/`session`/`incident` shapes.

**Agent service landed (`agent/`, see `agent/README.md`):** mock/live/replay against your 3.5 contract. Mock run verified:
task + conflict + severity rows written, 3 audit rows as NEMOTRON. `npm run dev:setup` seeds a local incident and enrolls it.
Note: installed `ai@7` uses **`isStepCount`** (HANDOFF's `stepCountIs` no longer exists).
**For slice 11 (INVESTIGATE) I need a place to stream steps:** an agent-only `record_agent_step(kind, name, inputJson, outputJson)`
reducer + `agent_step` table (incident-scoped, read via a session-gated view; no audit row, it's a trace, not an action). I'll call it per step.

**Waiting on you:** OK for Playwright + promptfoo as dev deps in `attack/` · live-call count (of 40) · NVIDIA key for my `.env`.

## How to run locally

```bash
spacetime start                                            # terminal 1, leave running (ws://localhost:3000)
cd blackbox
spacetime publish blackbox --server local --module-path ./spacetimedb --no-config --yes
spacetime generate --lang typescript --out-dir client/src/module_bindings --module-path ./spacetimedb --no-config --yes
cd spacetimedb && npm install && cd ..                      # module deps (@noble/hashes)
spacetime call --server local --no-config blackbox issue_bootstrap_invite '"ABCD-2345"'   # first commander code
cd client && npm install && npm run dev                    # http://localhost:5173, enter ABCD-2345
```
`issue_bootstrap_invite` only works from the CLI identity that published the database (the owner).
Codes: 8 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, dash/space/case ignored.
`--no-config` is needed because `spacetime.json` defaults to Maincloud. Inspect data with
`spacetime sql --server local --no-config blackbox "SELECT * FROM incident"`.

## Slices

| # | Slice (DB → reducer → UI) | Attack target | Status |
|---|---|---|---|
| 0 | Ping table syncing two tabs | — (Gate 0) | [x] |
| 1 | Users + roles + `ctx.sender` checks on one write | acting as the wrong role | [x] |
| 2 | Invite codes → real session identity → role | replay, reuse, expiry, forged code | [x] |
| 3 | Incident create/read + structured form + COMMAND shell | observer writing, missing audit rows | [x] |
| 3.5 | Agent contract: tables, reducers, reads, generated bindings | agent privilege escalation and incident escape | [x] |
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
[17:42] SLICE 2 — invite codes → session identity → role. DONE.
  Works: first-registrant-becomes-commander REMOVED (no `register` reducer exists). First commander comes only from
    `issue_bootstrap_invite`, callable solely by the database owner identity captured in `init`.
    `create_invite` commander-only; only SHA-256(code) stored (private `invite_code`); single use; 30-min expiry;
    every redeem failure returns the same "invalid or expired code". Redeem binds ctx.sender -> user row + role and
    starts a 15-min session (private `session`). Every role check also requires a live session and extends it;
    client calls `touch_session` on keydown/pointerdown (max 1/min). Scheduled `sweep_sessions` (60 s) deletes
    expired sessions so the `team` view stops serving them. Client generates codes with crypto.getRandomValues.
  Verified: used-code replay, forged well-formed code, malformed code, expired invite -> all "invalid or expired code";
    non-owner bootstrap -> "owner only"; responder create_invite -> denied; anon create_invite/add_ping/touch_session
    -> "not registered"; sweep_sessions not externally callable; module SHA-256 == Node SHA-256.
    Expiry tested for real with temporary 20 s / 30 s TTLs (restored): expired session -> "session expired" on write,
    then signed out and team data withdrawn after the sweep.
  Limits (honest): a token stolen while its session is LIVE works until the session expires (≤15 min idle) — there is
    no revoke yet. Reads can lag expiry by up to 60 s (sweep interval). No redeem rate-limit (a throw rolls back any
    counter); we rely on ~40 bits of entropy + 30-min expiry instead. `incident_id` on invites is 0 until slice 3.
  Attack this: brute-force redeem_invite; replay a used/expired code; call issue_bootstrap_invite as non-owner; copy a
    tab's sessionStorage token to another browser before and after expiry; race two redeems of the same code.
[17:52] SLICE 2b — session revocation + audit chain (early). DONE.
  RABEET: RE-PULL. `requireRole` (role-check helper) changed in slice 2 and again here — it now also rejects revoked
    identities and requires a live session. Republish with --delete-data=always (schema changed).
  Works: commander-only `revoke_session(target)` — deletes the session immediately (view data withdrawn at once, no
    sweep wait) and lists the identity in private `revoked_identity`: it can never act or redeem again, and
    `set_role` refuses revoked targets (no un-revoke). Team list shows online/offline/REVOKED + revoke button.
    Client: a tab whose identity was signed in and then lost its session drops that identity and reconnects fresh,
    so the real person re-enters with a new invite while the stolen token stays dead.
  Audit (pulled forward from slice 4 so revoke is audited): private `audit` + `chain_head`; one `canonicalJson` and
    one `sha256Hex` (blackbox/spacetimedb/src/crypto.ts); event_hash = SHA256(canonicalJson(row w/o eventHash) +
    prevHash), genesis 64 zeros, seq contiguous. Wired into every mutating reducer: invite.bootstrap, invite.create,
    invite.redeem, user.set_role, user.revoke, ping.add. NOT audited by design: touch_session (keep-alive) and
    sweep_sessions (housekeeping) — they would add a row per user per minute. verifyChain + UI + tamper tests = slice 4.
  Verified: stolen token (copied sessionStorage) works BEFORE revoke; after revoke both tabs lose data instantly;
    replaying the stolen token -> signed out; redeeming a valid fresh code with it -> "invalid or expired code" and the
    code is NOT consumed; real user redeems that same code on a fresh identity; set_role on revoked -> "target is
    revoked". Row-1 event_hash recomputed independently in Node from SQL output -> exact match. 8-row chain walk OK.
  Note: SpacetimeDB tokens carry `iat` but no `exp` — they never expire on their own. Server-side session + revoke is
    the only expiry we have.
  Attack this: replay a revoked token; revoke yourself; responder calling revoke_session; un-revoke via set_role;
    revoke then race a redeem; check every mutating reducer wrote exactly one audit row.
[18:04] SLICE 3 — incidents + structured form + COMMAND shell + designed login. DONE.
  Local data was wiped first (no "eve"). Schema changed again: republish with --delete-data=always, then
    `issue_bootstrap_invite`. The `ping` table/reducer are gone.
  Works: private `incident` table read via session-gated `incidents` view. `create_incident` (commander/responder):
    title, type (ransomware|data_breach|bec|insider|ddos|unknown), severity, detected_at (UTC, not in future),
    systems affected, containment; status starts at triage. `update_incident`: severity/status/containment/systems,
    audit records from->to per changed field. Every enum validated server-side.
  UI (DESIGN.md): 44px chrome (wordmark, active incident, chain status placeholder, agent, responders online, you,
    link state, ticking UTC clock); COMMAND = incidents 280 · detail · team 320. Designed §6.1 login: 8 boxes
    XXXX-XXXX fed by one hidden input (paste works, refused chars dropped), 60ms land, 3-frame shake + red on fail,
    200ms green lock then hard cut. Reduced-motion disables all of it. Fonts self-hosted (@fontsource), no CDN.
    Keyboard: N = new incident, Esc = cancel, Enter = submit; every shortcut is also a labeled button.
  Verified: observer token over raw HTTP (/v1/database/blackbox/call/...) -> update_incident, create_incident,
    create_invite all "role observer not permitted", incident unchanged, no audit rows written. Commander status change
    appears live in the observer's browser. Audit rows incident.create / incident.update carry incident_id.
    Login filter, fail state (red #FF4D4D + message) and success lock (green) checked via DOM.
  Not yet: invites carry incident_id=0 — per-incident scoping is not enforced (all signed-in users see all
    incidents). Chain status bar is an honest "VERIFICATION PENDING" placeholder until slice 4. shadcn not installed
    yet — no primitive needed so far; native elements restyled to tokens.
  Attack this: observer writes over HTTP; out-of-range enums; future detected_at; 121-char title; read `incident`
    directly via SQL as non-owner; expired session still seeing incidents after the sweep.

## Known, not fixing

SLICE 3.5 — agent module contract DONE (see AGENT_CONTRACT.md).
  Private agent_identity/task/evidence/conflict tables; commander enrollAgent binds a dedicated service identity
  to one incident and a 15-minute session. createTask/updateSeverity/flagConflict derive NEMOTRON from ctx.sender.
  searchIncidents/getScope/evidenceRecords are authenticated read procedures. getScope explicitly reports
  unavailable until slice 6. submitEvidence is human-only. Tasks render through a session-gated subscription.
  Agent denied by all existing human/permission endpoints; setRole cannot grant a human role to an agent;
  revokeSession also kills agent identities. Closing is blocked server-side and removed from UI pending slice 10.
  Verified: SDK harness assertions, module typecheck/build, generated bindings, client production build.
  No server running, so no publish or database wipe. No NVIDIA calls; budget remains 5/40.
  RABEET: pull, read AGENT_CONTRACT.md, build only in your owned folders. Do not use a human token for the service.
  Attack this: enrolled agent calls permission reducers; cross-incident severity/conflict/read; revoked agent
  writes; expired agent session; forged actor via calls (no actor parameter accepted).

Post-pull verification: merged Rabeet's security suite (31338e3) before pushing slice 3.5.
  Installed existing locked module dev dependencies; full module typecheck and client build pass.
  npm test: 4 passed, 4 todo. Responder-close regression now passes.
  Rabeet's section is preserved. attack/fixes.patch targets slice 3 and does not apply cleanly after 3.5;
  remaining findings (duress visibility, commander lockout and other hardening) require adaptation, not blind apply.
  Attack this: re-run agent privilege checks against 82f7628; remaining findings are not claimed fixed.

SLICE 3.5 LIVE + SECURITY FIXES — DONE. No database reset. Existing local server/data reused; publish
  --delete-data=never succeeded. Agent writes/boundaries/permission denial/revocation/expiry/audit verified over
  real HTTP; independent full 43-row chain verification passed. Temporary 3s enrolment TTL restored to 15min.
  Adapted Rabeet fixes (not blind patch): commander-only duress visibility; owner-only commander revoke/human
  recovery; service revocation remains permanent; owner cannot be enrolled as agent; weak code rejection;
  consumed/expired hashes removed; active-name uniqueness/control-char checks; ancient dates rejected;
  demotion/revocation invalidates invites. Lost updates fixed with mandatory expectedUpdatedAt.
  RABEET: update_incident HTTP args gained expectedUpdatedAt at the END. SDK/contract regenerated. The one
  existing unit-test call received this version; all its assertions retained. Your attack/ files unchanged.
  Checks: module build/typecheck, client production build, unit suite 4 pass/4 todo, live-hardening script passes.
  Test data added; original records preserved. No NVIDIA calls; 5/40. Attack this: stale writes; commander
  lockout; duress leakage; agent owner-enrolment, permission grant, revoked/expired agent reads and writes.

3.5 merged follow-up: Rabeet security fixes and agent service preserved during rebase. G19 agent downgrades
  now denied; G22 observer raw evidence denied. Rabeet raw-evidence lenient text rule retained. Live hardening
  checks re-run successfully on the merged/published module; npm test 4 pass/4 todo. No reset, no NVIDIA calls.
  Attack this: G19 downgrade, G22 evidence read, owner-agent enrolment and permanent agent revocation.
