# Security findings

Reproduce with `cd attack && npm run attack` (local server only). Unit tests: `cd blackbox/spacetimedb && npm test`.
Fix code for anything open: `FIXES.md`.

**Status @ `813c13f`, 2026-11-07 22:45:** **421 live regression checks held** on 10 consecutive runs, 0 succeeded/errors;
unit tests **8/8**; demo **16 held / 0 skipped** on 10 rehearsals; injection harness **20/20** (fence + server layers;
model layer not run, no key). Database: local `blackbox-attack` (see attack/README.md, "Owner login and database").
Separate targeted probes reproduce open findings; they are not included in the passing checks.
A1, Q1 and A2 were reproduced in the earlier sweep. See `DEEP_SWEEP.md` for scope and commands.
Zero live NVIDIA calls. Published locally with deletion disabled; original data retained.

## Open

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
| A2 | MED (local store, writer credential required) | Local JSONL checkpoint store compares sequence strings for immutability. After storing `11`, appending `011` with a different hash returns 201 and retains two conflicting checkpoints at numeric sequence 11. This violates immutability; it does not bypass a verifier that checks every historical checkpoint. Hosted implementation already canonicalizes and holds. | Canonicalize with `BigInt(seq).toString()` before lookup, storage and reference creation; compare existing persisted sequences numerically for backward compatibility. Reproduce: `node attack/probes/checkpoint-alias.mjs` (exit 1). Store source belongs to module owner; unchanged. |
| D1 | CRITICAL-rated development dependency advisories; application exploitability not demonstrated | Live `npm audit --json` in the module reports vitest 3.2.4 and tinypool 1.1.1 as critical-rated packages, plus a moderate @vitest/mocker package finding. Agent/client audits and module `--omit=dev` audit report zero findings. Vitest advisory depends on UI/browser/API server exposure; tinypool advisory requires an additional prototype-pollution path. Current tests use `vitest run`. | Module owner: coordinate a compatible Vitest/test-toolchain update and rerun full audit/tests; npm proposes 3.2.7, but verify the resulting lockfile against every advisory. No dependencies or lockfiles changed. Details and primary sources in DEEP_SWEEP.md. |
| Q1 | MED | `recordAgentStep` infers the current run. After cancelling A and claiming B with the same identity, a delayed A trace is accepted as B. Confirmed by `node attack/probes/run-attribution.mjs` (exits 1, cleans up). | Coordinate an expected `runId` reducer argument before changing callers. Existing worker now enforces one local process per identity and awaits trace acceptance before actions; this is mitigation, not a server fix across machines. Atomic cancellation of in-flight writes needs server guards too. |
| P1 | LOW | A procedure that rejects its caller is reported as "The module instance encountered a **fatal error**", and costs ~29 ms against ~6 ms for a normal call. A throw inside a procedure appears to tear down the module instance, so any signed-in user can make the server do ~5× work per call. | In the read procedures, return `canonicalJson({ error })` instead of throwing for expected denials. |
| V1 | LOW (code review, not reproducible over SQL) | `agent_status` (813c13f) checks that the caller has a user row and a session row, not that the session is unexpired or unrevoked. An expired human keeps reading agent identities and incident IDs until the 60 s sweep deletes the row. Swept and revoked humans already see nothing (slice 11/enrol). It also scans `agentIdentity` with `.iter()`, which re-evaluates on every change. | Gate on `!isExpired(...)` and `!isRevoked(...)` like `requireRole`. Data exposed is low-sensitivity; fix only if convenient. |

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
| A1 | HIGH: anchor comparison could become stale before the final chain/snapshot transaction | External history is now compared inside the final transaction in verifyIntegrity/getRecord; default unit test 6 verifies both rewrite boundaries. |
| V10/V12 | HIGH: a commander could demote a peer, then revoke them despite the owner-only peer revocation restriction | Small `index.ts` fix: only the DB owner may demote an existing commander. Live demote/revoke chain denied with zero audit rows; unit test 8 confirms owner recovery still works after bootstrap sign-in. |
| S14 | MED: a commander could reauthenticate as an observer while their old commander invitations remained redeemable | Small `index.ts` fix: `redeemInvite` discards the caller's outstanding invites when reauthentication removes commander authority. Reproduced before fix; live regression now rejects the old invite. |

## Held, by slice
- **Authority transitions / read boundaries:** peer demotion/revoke chain blocked; reauthentication invalidates former-commander invites; all 21 private tables deny outsider/observer/agent/non-owner commander SQL; demotion immediately withdraws restricted views; revoked/expired/service identities receive no human views. Prior demoted/expired reviewer approvals do not execute closure.
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
- **Q1 cancellation extension confirmed:** `node attack/probes/cancelled-tool.mjs` exits 1: a call trace succeeds, the commander cancels, then `create_task` still writes. It is a bounded disposable test incident, not an original incident. Expected-run/status guards must be checked atomically by business reducers; an earlier worker status read cannot guarantee this.
- **Pitch honesty:** independent anchoring is not configured here. An owner who rewrites rows and recomputes all hashes can pass internal verification. Say "tamper-evident within the database" until an independent deployment is verified; verify independent deployment before stronger claims.
- **NEMOTRON attribution = "an identity a commander enrolled"**, not proof it's the model. A commander could enroll a script. Fine for the demo; don't claim cryptographic proof.
- Failed redeems leave no audit trace (rollback). `init` isn't audited.
- Every signed-in user sees every incident (invites aren't incident-scoped yet).
- `spacetime start` listens on `0.0.0.0:3000`; demo on Maincloud or use `--listen-addr 127.0.0.1:3000`.
- **Never use `ctx.random` / `ctx.newUuidV4` for secrets.** Seeded from `ctx.timestamp` only (see FIXES.md).
