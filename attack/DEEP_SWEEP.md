# Deep sweep — 2026-11-07

Baseline: `2905835`, branch `fix/attack-scaffold`. Fetch found no newer origin/main commit.
Results below describe the tested working tree; fixes were published only to the local module with
`--delete-data=never`. Original data was retained. Test identities/incidents and their ordinary audit rows remain.

## Fixed and reproduced

1. **V10/V12 HIGH — commander lockout through two endpoints.** Direct peer revocation was blocked, but
   `set_role(peer, observer)` succeeded. The target then became revocable by a non-owner commander.
   Added an owner-only check when demoting an existing commander. The direct demotion probe failed before
   the fix; the complete demote/revoke regression now holds. Unit test 8 verifies the owner's signed-in
   bootstrap identity retains legitimate demotion authority. No schema or reducer argument changes.
2. **S14 MED — stale privileged invites after reauthentication.** A commander minted a commander invite,
   lost their session, and redeemed an observer invite on the same identity. Their old commander invite
   was still usable by a fresh identity. Reproduced against the original local module. Reauthentication
   now discards their outstanding invites when it removes commander authority. The new regression holds.

Only module source changes: seven added lines in `spacetimedb/src/index.ts`, in `redeemInvite` and `setRole`.

## Still open

| Finding | Evidence this sweep | Next action |
|---|---|---|
| A1 HIGH, fixed | Stale anchor comparison before final snapshot was reproduced | Fixed: compare external history inside the final chain/snapshot transaction; default test 6 covers both rewrite boundaries |
| Q1 MED | Stale run-A trace accepted as run B; separate probe also accepts a business write after cancellation between trace and action | Coordinate expected-run arguments and atomic server-side business-action guards |
| A2 MED, local store only | `11` and `011` accept conflicting hashes; hosted equivalent holds | Module owner: canonicalize numeric sequences before lookup/store; handle preexisting aliases |
| P1 LOW | Expected procedure denials and malformed trace JSON still report fatal module errors in passing denial tests | Return structured expected errors; handle parse errors deliberately |
| D1, critical-rated dev tooling advisories | Module `npm audit` reports 2 critical packages and 1 moderate package; production-only audit is clean | Module owner: update compatible test dependencies and verify audit/tests |

Reproductions from repo root (each currently fails deliberately):

```powershell
node attack/probes/run-attribution.mjs
node attack/probes/cancelled-tool.mjs
node attack/probes/checkpoint-alias.mjs
Push-Location blackbox/spacetimedb
$env:BLACKBOX_PROBE_ANCHOR_RACE='1'
try { npm test } finally { Remove-Item Env:BLACKBOX_PROBE_ANCHOR_RACE; Pop-Location }
```

A2 requires the local store's writer credential and is an immutability-contract violation, not demonstrated
evasion of the full-history verifier. Q1's cancellation probe leaves its diagnostic task in a disposable incident
so the accepted post-cancellation write remains inspectable.

## Validation and coverage

- Full live HTTP regression suite: **408 held, 0 succeeded, 0 skipped, 0 errors**. Baseline was 275.
- Unit suite: **8/8**, including peer-demotion rollback and authorized owner-demotion coverage within test 8.
- Module `tsc --noEmit`, client `tsc -b`, and client production build pass.
- Demo: **5 held / 2 skipped**. Audit tamper is restored and the chain re-verifies.
  Concurrent edits to `demo/3-injection.mjs` and `demo/4-network.mjs` appeared after this run; they were left
  untouched and are not covered by that result. The full regression gate does not load demo scripts.
- `gitleaks git . --redact`: **72 commits scanned, no leaks found** before any new commit.
- Ignored paths verified: root `.env`, service token, agent logs and client `.env.local`.
- Live npm audits: agent and client each **0 vulnerabilities**; module production-only **0**; full module
  audit **3 affected packages (2 critical-rated, 1 moderate-rated)**. See dependency context below.
- No NVIDIA calls, added packages, schema changes, public deployment or original-data reset.

New checks cover all 21 private base tables for four caller classes; restricted-view withdrawal on demotion;
all human views after revocation/session removal and for service identities; previous approval eligibility after
reviewer demotion/expiry; and the two authority-transition regressions. Existing tests exercise roles, invites,
sessions, audit recomputation, chat/scope, local and hosted-store source durability, closure, actual mock/replay
worker processes, cancellation, RECORD redaction, actual PDF generation, and the authenticated PDF adapter.

Source reviewed: module reducers/views/procedures and crypto; agent config/DB/tools/run/worker; both checkpoint
stores and SQL immutability triggers; deployment adapters/scripts; renderer/HTTP server; client authentication,
polling, record/export, investigation, chat/scope, approval and team flows.

## Dependency context

Installed module tools: `vitest@3.2.4`, `@vitest/mocker@3.2.4`, `tinypool@1.1.1`.
`npm audit --json` reports vulnerabilities in these development dependencies and proposes `vitest@3.2.7`.
That suggestion is not a verified remediation here: dependency manifests/lockfiles belong to the module owner,
and every resulting advisory plus SpacetimeDB harness compatibility should be checked after an agreed update.

The [Vitest maintainer advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp)
describes file access/code execution when its UI/browser/API server is listening, especially under Windows/network
exposure. This repository's tested command is `vitest run`, and this sweep did not expose a Vitest UI/API server.
The [tinypool maintainer advisory](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr)
requires an additional prototype-pollution path and particular worker options. No such exploit chain was
demonstrated in the application. Registry and maintainer severity/version metadata differ in places; the counts
above are the live npm audit classifications, not a claim of unauthenticated production RCE.

## Limits and follow-up review

- A passing default gate excludes the deliberately failing open-finding probes above.
- Independent live hosting, Maincloud, production PDF/worker credentials, real golden replay, phone-hotspot
  behavior and multi-browser network recovery were not validated. No model-injection robustness claim is made.
- UI observations here are source-review findings, not browser reproductions: Record retains its previous
  snapshot after refresh errors and can accept overlapping refreshes; owner should add an in-flight guard,
  response generation check and visible freshness/error state. Closed-incident status/containment controls also
  remain enabled even though `updateIncident` rejects their requests. These UI files were not edited.
- The PDF adapter buffers upstream snapshot/PDF bodies before enforcing its download size check. The renderer
  limits its own input/output, but a misconfigured renderer can consume excess adapter memory; consider bounded
  streaming. This is a source-review hardening item, not a demonstrated external authorization bypass.
- Audit verification attests the audit chain against available checkpoints. This sweep does not establish
  cryptographic correspondence between every current business-table value and its historical audit events.

## Push validation · 2026-11-07

Revalidated after the A1 fix: 408 regression checks, 8 unit tests (including anchor race),
16 demo checks, module/client typechecks and mock agent all pass. Bindings regenerated with no semantic changes.
The read-only demo preflight confirms DB, enrollment and PDF health; FAST recording and NVIDIA key remain missing.
History scan: 73 commits, no leaks. Directory scan flags only the ignored agent/.agent-token; it is excluded from commits.
