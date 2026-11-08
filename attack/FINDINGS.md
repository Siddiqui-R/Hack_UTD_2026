# Security findings

Reproduce with `cd attack && npm run attack` (local server only). Unit tests: `cd blackbox/spacetimedb && npm test`.
Fix code for anything open: `FIXES.md`.

**Status @ `3d339f8` (slice 3.5 hardened):** 88 attacks, **88 held**, 0 succeeded · unit tests 4/4 pass, 4 todo.

## Open

| ID | Severity | Finding | Suggested fix |
|---|---|---|---|
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
- **1 (15):** unregistered write/role · private `user` · `team` empty for outsiders · no self-registration · observer write/promote/demote · bogus role · commander self-change · duress hidden from the coerced user · commanders still see it.
- **2 (13):** bootstrap owner-only · responder can't mint commander invites · external sweep · forged/replayed/raced codes · uniform errors · online brute force ~38,000 h per code · expired token can't write or read.
- **2b (18):** revoke rules · revoked token can't write/read/redeem · code not burned · no un-revoke via set_role · audit private, seq 1..N, links, **independent hash recompute**, chain_head, exactly 1 row per mutation, 0 per failure.
- **3 (14):** observer write · outsider reads · enums · future date · title length · missing incident · audited with incident_id · expired session.
- **3.5 (25):** only commanders enroll agents, never a human identity · the agent is refused **every** human operation (create incident, invite, role, revoke, redeem, close, enroll, submit evidence) · no role can be granted to the agent · agent can't touch another incident's severity, evidence, scope, conflicts or search results · humans can't call agent tools (no fake NEMOTRON) · agent can't write hidden chars · observers can't read scope · only agent tool actions are attributed to NEMOTRON · revoked agent dead and can't be re-enrolled ·
  agent can't lower severity · observers can't read evidence · owner can't be enrolled as agent · agent revocation is
  permanent even for the owner · a revoked commander's invites die with them.

## Notes, not bugs yet
- **Pitch honesty until slice 9:** an owner who rewrites a row *and* recomputes later hashes passes verification. Say "tamper-evident within the database".
- **NEMOTRON attribution = "an identity a commander enrolled"**, not proof it's the model. A commander could enroll a script. Fine for the demo; don't claim cryptographic proof.
- Failed redeems leave no audit trace (rollback). `init` isn't audited.
- Every signed-in user sees every incident (invites aren't incident-scoped yet).
- `spacetime start` listens on `0.0.0.0:3000`; demo on Maincloud or use `--listen-addr 127.0.0.1:3000`.
- **Never use `ctx.random` / `ctx.newUuidV4` for secrets.** Seeded from `ctx.timestamp` only (see FIXES.md).
