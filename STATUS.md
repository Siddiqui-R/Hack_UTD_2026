# BLACKBOX — STATUS

Rabeet: read this to know what is ready to attack. Newest entries at the bottom of the log.

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
`spacetime sql --server local --no-config blackbox "SELECT * FROM ping"`.

## Slices

| # | Slice (DB → reducer → UI) | Attack target | Status |
|---|---|---|---|
| 0 | Ping table syncing two tabs | — (Gate 0) | [x] |
| 1 | Users + roles + `ctx.sender` checks on one write | acting as the wrong role | [x] |
| 2 | Invite codes → real session identity → role | replay, reuse, expiry, forged code | [x] |
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

## Known, not fixing
