# Security findings

Reproduce with `cd attack && npm run attack` (local server only). Unit tests: `cd blackbox/spacetimedb && npm test`.
Fix code for anything open: `FIXES.md`.

**Status @ branch `fix/q1-run-binding` (on `main` 928f266), 2026-11-08:** **526 live regression checks held**, 0
succeeded/errors (adds slice 14, 39 run-binding checks, and a slice 11 check that the real worker's writes name its
run); both Q1 probes exit 0; unit tests **8/8**; demo **16/16**; injection harness 20/20 (fence + server). A mock run
started from the real client UI on `blackbox-attack` completed through the worker. Local only until the owner
publishes the module (see DEPLOYMENT.md). The task workflow (PR #3) is published and merged.
Before: 486 held @ `feat/task-workflow` (slice 13, 64 task-workflow checks; A2 alias check runs by default).
Prior: 421 held on 10 consecutive runs @ `813c13f`; injection harness **20/20** (fence + server layers;
model layer not run, no key). Database: local `blackbox-attack` (see attack/README.md, "Owner login and database").
Separate targeted probes reproduce open findings; they are not included in the passing checks.
A1, Q1 and A2 were reproduced in the earlier sweep. See `DEEP_SWEEP.md` for scope and commands.
Zero live NVIDIA calls. Published locally with deletion disabled; original data retained.

## Open

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| D1 | CRITICAL-rated development dependency advisories; application exploitability not demonstrated | Fresh `npm audit` (2026-11-08) in the module: vitest 3.2.4, tinypool 1.1.1 critical, @vitest/mocker moderate. The advisories cover vitest 0.0.95-4.1.10 and tinypool < 2.1.2, so npm's suggested 3.2.7 does **not** fix them (tried and reverted: same 3 findings). Exposure: test-only tooling, never shipped or deployed; exploitation needs vitest's UI/browser/API server or attacker-controlled test code and mocks. Our tests run `vitest run` locally on trusted code. Agent/client/module production audits report zero. | Only remediation is a major upgrade to vitest 5.x; do it after judging with a full test rerun. Package files unchanged. |
| Q1-standalone | LOW, open BY DESIGN (owner decision) | Standalone CLI runs (`run.mjs`, `--live`, the golden recording) have no run row, so their agent writes carry no run id and a cancel button cannot stop them. Live stays out of the queue so the UI never spends credits. | Accepted: they are operator-started, need the service token, write no trace, and the server refuses their writes while the incident has a queued or running UI run (slice 14 R-none-*, R-standalone-fenced), so they cannot overlap or impersonate a queue run. |
| P1 | LOW, deferred | A procedure that rejects its caller is reported as "The module instance encountered a **fatal error**", and costs ~29 ms against ~6 ms for a normal call. | Return a structured `{error}` for expected denials and update every caller (worker, client, PDF adapter, attack lib) so an error object can't be read as data. Too broad to change safely before judging. |
| D2 | LOW (not reachable from snapshot input) | Hosted renderer: `puppeteer-core@25.11.0` pulls `chromium-bidi` → `zod@3.25.76`, covered by GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized constrained collections; all zod < 4.6.6). That zod only parses WebDriver BiDi messages from the browser itself; Chrome is driven over CDP, and attacker-controlled snapshots are validated by `render.mjs`, never zod. | The only fix is puppeteer-core 25.16.0, built for Chrome 156, while the newest serverless Chromium is 153. Revisit when `@sparticuz/chromium` 156+ is at least two weeks old. |
| V1 | LOW, partly fixed (bounded limit remains) | `agent_status` now also refuses revoked callers (same gate as the new `task_progress` view). Remaining: views have no clock (`ViewCtx` has no timestamp), so an expired-but-unswept session still reads agent identities and incident IDs for up to the 60 s sweep. Both views scan with `.iter()`, re-evaluated on change; fine at hackathon size. | No supported time-dependent view filter exists in 2.14; keep the bound, or move these reads to procedures with `requireReader` if it ever matters. |

## Fixed (applied to the module by Rabeet at the user's request, re-verified)

| ID | Was | Fix now in `index.ts` |
|---|---|---|
| Q1 (queue path) | MED: `recordAgentStep` inferred the running run, so a delayed trace from cancelled run A landed on run B; a tool write after cancellation still committed | Branch `fix/q1-run-binding`: `record_agent_step` requires `runId`; `create_task`/`update_severity`/`flag_conflict` take optional `runId`, filled in by the worker's tool wrapper (never the model). Some(runId) is accepted only for the caller's running run on its enrolled incident, in the same transaction as the write; None only while the incident has no queued/running run. Both probes exit 0; slice 14 covers stale, cancelled, finished, foreign, rival-worker and unclaimed run ids, run-less writes while queued/running, the real worker and a real standalone run. |
| A2 | Local checkpoint store accepted a conflicting hash under a numeric alias (`11` then `011`) | `anchor-store/server.mjs` compares and persists sequences numerically; aliases already stored stay as history and any same-number conflict is refused (409). `node attack/probes/checkpoint-alias.mjs` exits 0; the alias check now runs in the default slice 9 (branch `feat/task-workflow`). |
| I5 | Responder could close an incident | Sensei's 3.5: nobody can set `closed` via `update_incident` (needs slice 10 approval) |
| R14 | Duress flag visible to every user | `team` copies it only for commander callers; R15 confirms commanders still see it |
| V9 | One commander could permanently revoke all others | Only the owner revokes commanders; owner-only `unrevoke_session` |
| S9 | Weak codes (`AAAAAAAA`) accepted | Codes with fewer than 5 distinct chars rejected |
| S-off | Used/expired invite hashes crackable from a DB copy | Invite row deleted on redeem; sweep deletes expired invites |
| R11/R12/I10 | Duplicate names; bidi/zero-width chars in names and titles | Strict `cleanText` for names, titles, tasks, reasons (keeps `\t\n\r`); unique names, checked *after* the code is valid. Raw evidence stays lenient: hidden chars in a phishing email are evidence |
| S-rev | Demoted commander's invites stayed live | Deleted on demotion |
| I9 | `detected_at` in year 1 accepted | More than a year ago rejected |
| G19 | Agent could lower severity with no human (injection target) | Sensei: `update_severity` is raise-only for agents; plus an agent-side policy in `agent/src/tools.mjs` |
| G22 | Observers could read raw evidence | Sensei: `evidence_records` rejects observers |
| I12 | Stale `update_incident` silently reverted other fields | Sensei: mandatory `expectedUpdatedAt` (last HTTP arg); stale writes rejected |
| A1 | HIGH: anchor comparison could become stale before the final chain/snapshot transaction | External history is now compared inside the final transaction in verifyIntegrity/getRecord; default unit test 6 verifies both rewrite boundaries. |
| V10/V12 | HIGH: a commander could demote a peer, then revoke them despite the owner-only peer revocation restriction | Small `index.ts` fix: only the DB owner may demote an existing commander. Live demote/revoke chain denied with zero audit rows; unit test 8 confirms owner recovery still works after bootstrap sign-in. |
| S14 | MED: a commander could reauthenticate as an observer while their old commander invitations remained redeemable | Small `index.ts` fix: `redeemInvite` discards the caller's outstanding invites when reauthentication removes commander authority. Reproduced before fix; live regression now rejects the old invite. |

## Held, by slice
- **Authority transitions / read boundaries:** peer demotion/revoke chain blocked; reauthentication invalidates former-commander invites; all 21 private tables deny outsider/observer/agent/non-owner commander SQL; demotion immediately withdraws restricted views; revoked/expired/service identities receive no human views. Prior demoted/expired reviewer approvals do not execute closure.
- **5/6:** human-only chat/scope mutations, private base tables, incident chat filters, observer read-only chat/no scope, expired/revoked sessions, agent scope restriction, exactly-one audit/zero on denial, real getScope data and stale scope updates.
- **9:** separate local checkpoint process: split credentials, authorization, idempotency, immutable same-sequence hashes, monotonic sequence, full history, out-of-range rejection and restart durability. Independent hosting and full live external anchoring remain unverified. See A1 before claiming independent security.
- **10:** requester/duplicate/agent/observer rejection; two distinct eligible human reviewers; revoked approvals stop counting; stale incident rejection; cancellation; one audit per success; request expiry tested using harness clock and a live reviewer session.
- **11:** request mode/tier validation, incident/worker isolation, claim race, trace privacy/JSON validation, completion, actual mock worker, explicitly synthetic replay transport fixture, missing/wrong-model recording failure, prior conclusion preservation, duplicate local worker lock, cancellation before next action and unchanged NVIDIA counter; every worker tool write names its own run.
- **14 (39):** run-bound traces and writes (Q1): unclaimed, cancelled, finished, nonexistent, another incident's and another worker's run ids refused for traces and all three writes with no row and no audit; a stale trace from a cancelled run never lands on the next run; run-less writes refused while a run is queued or running and allowed again after; humans can't write as a run; "cannot lower severity" still holds inside a run; audit rows record the run id; a real standalone mock `run.mjs` completes on an idle incident and is refused while a UI run is queued.
- **12/PDF:** human snapshot data/redaction/cross-incident evidence, independent hash-inspector comparison; renderer origin/token/size/shape checks, escaped Unicode evidence, observer redaction, actual PDF bytes, honest separate checkpoint/current-head reporting. PDFs visually verified; UI automation was unavailable.
- **1 (15):** unregistered write/role · private `user` · `team` empty for outsiders · no self-registration · observer write/promote/demote · bogus role · commander self-change · duress hidden from the coerced user · commanders still see it.
- **2 (13):** bootstrap owner-only · responder can't mint commander invites · external sweep · forged/replayed/raced codes · uniform errors · online brute force ~38,000 h per code · expired token can't write or read.
- **2b (18):** revoke rules · revoked token can't write/read/redeem · code not burned · no un-revoke via set_role · audit private, seq 1..N, links, **independent hash recompute**, chain_head, exactly 1 row per mutation, 0 per failure.
- **3 (14):** observer write · outsider reads · enums · future date · title length · missing incident · audited with incident_id · expired session.
- **3.5 (25):** only commanders enroll agents, never a human identity · the agent is refused **every** human operation (create incident, invite, role, revoke, redeem, close, enroll, submit evidence) · no role can be granted to the agent · agent can't touch another incident's severity, evidence, scope, conflicts or search results · humans can't call agent tools (no fake NEMOTRON) · agent can't write hidden chars · observers can't read scope · only agent tool actions are attributed to NEMOTRON · revoked agent dead and can't be re-enrolled ·
  agent can't lower severity · observers can't read evidence · owner can't be enrolled as agent · agent revocation is
  permanent even for the owner · a revoked commander's invites die with them.
- **4 (10):** `verify_chain` refuses outsiders, revoked and expired sessions · matches the independent verifier on a clean chain · writes no audit rows · names the exact seq for an edited payload, rewritten actor, broken prev_hash and corrupt chain_head · clean again after repair.

## Notes, not bugs yet
- **Q1 cancellation extension fixed:** `node attack/probes/cancelled-tool.mjs` now exits 0: after a call trace and a commander cancel, the run-bound `create_task` is refused with no task and no audit row. Cancellation still can't undo a write that committed before it.
- **Pitch honesty:** independent anchoring is not configured here. An owner who rewrites rows and recomputes all hashes can pass internal verification. Say "tamper-evident within the database" until an independent deployment is verified; verify independent deployment before stronger claims.
- **NEMOTRON attribution = "an identity a commander enrolled"**, not proof it's the model. A commander could enroll a script. Fine for the demo; don't claim cryptographic proof.
- Failed redeems leave no audit trace (rollback). `init` isn't audited.
- Every signed-in user sees every incident (invites aren't incident-scoped yet).
- `spacetime start` listens on `0.0.0.0:3000`; demo on Maincloud or use `--listen-addr 127.0.0.1:3000`.
- **Never use `ctx.random` / `ctx.newUuidV4` for secrets.** Seeded from `ctx.timestamp` only (see FIXES.md).
