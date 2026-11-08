# Security findings

Reproduce with `cd attack && npm run attack` (local server only). Unit tests: `cd blackbox/spacetimedb && npm test`.
Fix code for anything open: `FIXES.md`.

**Status @ `3a53d45` (incl. owner `4eb367f`):** **275 live regression checks held**, 0 succeeded/errors;
unit tests **8/8**, client typecheck passes; demo **5 held / 2 skipped**.
Two separate targeted probes below reproduce open module gaps; they are not included in the 275 passing checks.
Q1 re-confirmed 2026-11-07 20:05 (probe exits 1).
Zero live NVIDIA calls. Published locally with deletion disabled; original data retained.

## Open

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| A1 | HIGH (configured independent anchoring) | `verifyIntegrity` compares external history in one transaction, then only checks internal consistency in the final transaction. A full owner rewrite between them returns `chain.ok=true` and stale `anchorOk=true`. Deterministically reproduced with the harness commit hook; `getRecord` has the same comparison/snapshot split. | Fetch/validate external history outside transactions, then compare every checkpoint in the same final transaction as chain verification/snapshot. Owner notified on issue #2. Reproduce: `BLACKBOX_PROBE_ANCHOR_RACE=1 npm test` in the module (PowerShell: set `$env:BLACKBOX_PROBE_ANCHOR_RACE='1'` first). Optional test 6 currently fails, expected false / actual true. |
| Q1 | MED | `recordAgentStep` infers the current run. After cancelling A and claiming B with the same identity, a delayed A trace is accepted as B. Confirmed by `node attack/probes/run-attribution.mjs` (exits 1, cleans up). | Coordinate an expected `runId` reducer argument before changing callers. Existing worker now enforces one local process per identity and awaits trace acceptance before actions; this is mitigation, not a server fix across machines. Atomic cancellation of in-flight writes needs server guards too. |
| P1 | LOW | A procedure that rejects its caller is reported as "The module instance encountered a **fatal error**", and costs ~29 ms against ~6 ms for a normal call. A throw inside a procedure appears to tear down the module instance, so any signed-in user can make the server do ~5× work per call. | In the read procedures, return `canonicalJson({ error })` instead of throwing for expected denials. |

## Fixed (applied to the module by Rabeet at the user's request, re-verified)

| ID | Was | Fix now in `index.ts` |
|---|---|---|
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

## Held, by slice
- **5/6:** human-only chat/scope mutations, private base tables, incident chat filters, observer read-only chat/no scope, expired/revoked sessions, agent scope restriction, exactly-one audit/zero on denial, real getScope data and stale scope updates.
- **9:** separate local checkpoint process: split credentials, authorization, idempotency, immutable same-sequence hashes, monotonic sequence, full history, out-of-range rejection and restart durability. Independent hosting and full live external anchoring remain unverified. See A1 before claiming independent security.
- **10:** requester/duplicate/agent/observer rejection; two distinct eligible human reviewers; revoked approvals stop counting; stale incident rejection; cancellation; one audit per success; request expiry tested using harness clock and a live reviewer session.
- **11:** request mode/tier validation, incident/worker isolation, claim race, trace privacy/JSON validation, completion, actual mock worker, explicitly synthetic replay transport fixture, missing/wrong-model recording failure, prior conclusion preservation, duplicate local worker lock, cancellation before next action and unchanged NVIDIA counter. See Q1 for remaining server attribution gap.
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
- **Pitch honesty:** independent anchoring is not configured here. An owner who rewrites rows and recomputes all hashes can pass internal verification. Say "tamper-evident within the database" until an independent deployment is verified; fix A1 before stronger claims.
- **NEMOTRON attribution = "an identity a commander enrolled"**, not proof it's the model. A commander could enroll a script. Fine for the demo; don't claim cryptographic proof.
- Failed redeems leave no audit trace (rollback). `init` isn't audited.
- Every signed-in user sees every incident (invites aren't incident-scoped yet).
- `spacetime start` listens on `0.0.0.0:3000`; demo on Maincloud or use `--listen-addr 127.0.0.1:3000`.
- **Never use `ctx.random` / `ctx.newUuidV4` for secrets.** Seeded from `ctx.timestamp` only (see FIXES.md).
