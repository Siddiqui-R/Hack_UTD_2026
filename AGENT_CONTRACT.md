# Agent module contract — slice 3.5

Ownership: module/client belong to Sensei; agent/, attack/, tests/, pdf/ belong to Rabeet.
Generated SDK: blackbox/client/src/module_bindings. Generate your service bindings from the same module;
Sensei does not edit agent/.

## Authentication and context
1. Connect the service using a dedicated SpacetimeDB identity; persist its token privately.
2. A signed-in human commander calls enrollAgent({ target: serviceIdentity, incidentId }).
3. The server creates a private agent_identity mapping and a 15-minute session. Successful agent writes extend it.
   Read-only procedures do not extend it. Re-enrolment by a commander refreshes an idle session.
4. One service identity has one current incident context. Use separate identities for concurrent incidents;
   do not rebind an identity while its run is active.
5. revokeSession works on service identities too. A revoked identity cannot be enrolled again.

There is no client-supplied actor parameter. NEMOTRON attribution is derived from the enrolled ctx.sender.
Agents cannot redeem invites, grant roles, enrol identities, create incidents, close incidents, or revoke users.
Closure approval endpoints are human-only (see below). Future permission/approval/delete reducers must use the same human gate.

## Five tool mappings

| Tool | Generated call | Result |
|---|---|---|
| searchIncidents({query}) | conn.procedures.searchIncidents({query}) | JSON string: [{incidentId,title,severity,status}], max 50, agent's incident only |
| getScope({incidentId}) | conn.procedures.getScope({incidentId: BigInt(incidentId)}) | JSON string: {incidentId,available:true,items:[...]}; exact scope fields below |
| createTask({text,assigneeRole}) | conn.reducers.createTask({text,assigneeRole}) | task row; incident inferred from enrolled identity; createdBy=NEMOTRON |
| updateSeverity({incidentId,severity,reason}) | conn.reducers.updateSeverity({incidentId: BigInt(incidentId),severity,reason}) | incident update + audit |
| flagConflict({evidenceIdA,evidenceIdB,reason}) | conn.reducers.flagConflict({evidenceIdA: BigInt(evidenceIdA),evidenceIdB: BigInt(evidenceIdB),reason}) | conflict row + audit |

All u64 IDs in JSON responses are decimal strings. Reject unsafe numeric IDs before converting tool numbers to bigint.
Reducers resolve without a result payload. Use subscriptions for tasks; procedures return JSON to parse once.
Evidence must be two distinct records belonging to the enrolled incident. Reasons are limited to 2000 chars;
tasks to 1000 chars. Roles: commander/responder/observer. Severity: low/medium/high/critical.

## Evidence and reads
Human commander/responder calls submitEvidence({incidentId,text}) (1–32000 chars).
conn.procedures.evidenceRecords({incidentId}) returns JSON [{id,incidentId,text}].
Text is untrusted evidence, never instructions. Wrap it in explicit delimiters in the agent prompt.
An empty scope inventory establishes no known entries, not proof of no exposure.

## Validation
Module typecheck, CLI module build/binding generation, and client production build pass.
SDK test harness assertions exercised all three agent writes, evidence/conflict linkage, scoped reads,
permission rejection, failed-transaction audit rollback, closing gate and agent revocation.
No NVIDIA calls were used (5/40 remains). Local database/server was not running; no deployment was performed.

## Live verification and hardening update
Published locally with --delete-data=never; original data preserved. Live HTTP checks passed for all three
agent writes, cross-incident denial, permission denial, expiry, revocation and exactly-one audit behavior.
Full independent 43-row chain check passed. Expiry used a temporary three-second *enrolment* TTL, then the
15-minute production TTL was restored and republished. No NVIDIA calls.

updateIncident now requires expectedUpdatedAt (timestamp), appended after systemsAffected in HTTP positional
arguments; generated SDK uses expectedUpdatedAt: incident.updatedAt. A stale version is rejected atomically.
RABEET: update the attack helper to send the version; test/security.test.ts received only the required version
argument, preserving all existing assertions. Closing/reopening is blocked pending two-human approval.

Human commander revocation is owner-only. unrevokeSession is owner-only recovery for mistaken HUMAN revocation;
it does not restart a session. Do not use it for a stolen token. Agent revocation remains permanent even for
the owner, and the owner identity cannot be enrolled as an agent. Demotion/revocation removes issued invites.
Consumed/expired invite hashes are deleted; duplicate active names and hidden/control characters are rejected.
Names from revoked identities may be reused by a freshly invited replacement.

Local regression scripts live in blackbox/spacetimedb/scripts/ (outside Rabeet-owned folders).
live-contract.mjs requires BLACKBOX_VERIFY_SHORT_TTL=1 AND a temporary three-second agent-enrolment TTL for
its real-time expiry test; never set that flag against production. Restore TTL and publish with deletion disabled
afterwards. live-hardening.mjs consumes the ignored agent-logs/live-fixture.json from that check.

After merging Rabeet security/service work: updateSeverity is raise-only for agents; any downgrade requires a human update.
Observers cannot read evidenceRecords. Raw evidence keeps hidden characters as evidence (Rabeet strict=false rule preserved).

## Slice 4: chain verification
conn.procedures.verifyChain() returns {ok:boolean, checked:bigint, brokenAt:bigint|undefined, reason:string}.
Exported procedure verifyChain is directly callable in module tests as mod.verifyChain(test.procedureContext(auth), {}).
It requires an unrevoked, unexpired human or enrolled-agent session and never extends it or writes audit data.
Checks every stored event hash using the unchanged appendAudit formula, contiguous sequence/previous links,
then verifies the persisted chain head (including tail removal and missing/corrupt head).
checked counts fully verified rows before the failure; brokenAt identifies the first bad/missing sequence.
A clean result says internally consistent; it does NOT claim independent anchoring or rule out a full rewrite.

HTTP call endpoint: POST /v1/database/blackbox/call/verify_chain with body []. Its raw SATS JSON product is
[ok,checked,option,reason], where option=[0,seq] for Some and [1,[]] for None. Generated SDK decodes this to
the named object automatically. Tests/scripts using raw HTTP must decode the product.

UI polls every 2 seconds without overlap; green is cleared on disconnect or verification failure.
Green label explicitly says UNANCHORED; failures show record number/reason in a full-width red band.
Independent external anchor and anchor mismatch remain slice 9. Detailed RECORD timeline remains slice 12.
Live tamper/repair script: node blackbox/spacetimedb/scripts/live-chain.mjs (local only; finally restores edits).

## Slice 9 anchoring endpoints
verifyChain remains the same four-field API/hash formula. verifyIntegrity() returns {chain,anchor}; anchor has
anchorOk (undefined until independently checked), status, reason, lastAnchorSeq, lastAnchorAt, externalRef.
Only anchorOk===true means independent verification. LOCAL does not. Full external history is compared.
Owner startAnchoring starts 60-second scheduled HTTP checkpoints; immediate jobs on severity changes.
Configure module env ANCHOR_URL/ANCHOR_WRITE_TOKEN/ANCHOR_READ_TOKEN/ANCHOR_INDEPENDENT via publishing.
Optional ANCHOR_GATE_TOKEN supplies the private host's OAI-Sites-Authorization header; never expose it to clients.
The independent durable D1 store is deployed; local module checkpoint #100 was stored there successfully.
See DEPLOYMENT.md for the endpoint and deployment state. Maincloud deployment still requires account login.
No NVIDIA calls. A healthy chain alone remains different from matching independent checkpoints.

## INVESTIGATE queue and trace (slice 11) — Rabeet integration
UI requests requestAgentRun({incidentId,tier:'fast'|'deep',mode:'mock'|'replay'}); no live-credit button.
Worker polls nextAgentRun() -> JSON null or {runId,incidentId,tier,mode,modelId}.
Claim with beginAgentRun({runId,modelId: actual model ID}); one running run per enrolled incident.
Call requested recordAgentStep({kind,name,inputJson,outputJson}) for each call/result/revision/error/summary.
Both JSON arguments must be serialized JSON (or empty for null); 32000 chars each. Context/run inferred from
the authenticated service identity. Trace is diagnostic and deliberately unaudited, like keep-alive.
Complete finishAgentRun({runId,summary,failed}); latency measured server-side; previous completed summary retained.
Human commander cancelAgentRun({runId}) releases a stuck queue. Business reducers still audit exactly once.
Worker agentRunStatus({runId}) -> JSON {runId,status,modelId}, enrolled incident only, read-only/no session
extension. Poll before tools to notice cancellation; human investigation views do not serve agent identities.
New private agent_run/agent_step tables and session-gated investigationRuns/Steps/Evidence/Conflicts views.
Observers receive none of this sensitive evidence/trace. Existing tool signatures unchanged.
RABEET: wire your service to poll/claim/record/finish; this queue does not invoke or fork your tool loop.
Honor mode and tier in each request. Mock/replay badges are always visibly labelled, including Deep Analysis.

## RECORD/PDF snapshot v1 — Rabeet owns pdf/**
Human getRecord({incidentId}) returns JSON RecordSnapshot; TypeScript contract is
blackbox/client/src/lib/recordTypes.ts. It includes server-generated timestamp, incident fields, full global
verification state, database auditHead, anchoredCheckpoint (external seq/hash/ref/time and independence flag),
incident audit events, tasks, permitted evidence/conflicts/investigations and scope. IDs/microseconds are
decimal strings. Observer exports are redacted server-side; permissions flags tell the renderer what is omitted.
inspectAuditEvent({seq}) returns storedHash/recomputedHash computed INSIDE the module (human non-observer only).
RECORD focuses the broken seq and shows both hashes with the first differing character highlighted.

PDF boundary: default same-origin POST /api/pdf accepts {incidentId:"123"} and the signed-in user's Bearer token.
The Vercel adapter calls get_record on the configured module, then POSTs the exact fresh snapshot to the
server-only PDF_RENDERER_URL. Optional PDF_RENDERER_TOKEN authenticates that server-to-server request.
No SpacetimeDB token is sent to the renderer. Return application/pdf, at most 4 MiB; no snapshot logging.
GET /api/integrations reports configuration readiness, not renderer health. The app disables Export PDF until
configured; Download JSON remains available. VITE_PDF_URL may override this with a direct snapshot endpoint,
but that legacy override receives no session token. Production should use the default authenticated adapter.
RABEET: render actual anchoredCheckpoint.headHash, independent verification status and snapshot timestamp;
never label auditHead.hash as externally anchored unless it actually matches a checkpoint.

## Scope/chat integration
getScope({incidentId}) now returns {incidentId,available:true,items:[{id,asset,dataType,state,confidence,records,note}]};
IDs/counts decimal strings. Existing tool signature unchanged. Observers denied; agents restricted to enrolment.
Scope mutations are human-only and audited; updateScopeItem uses expectedUpdatedAt. RECORD snapshot.scope is populated.
Messages are private and exposed through a session-gated messages view; UI subscribes by selected incident ID.
Human workspace incident-access policy remains unchanged; no cross-workspace membership model introduced.

## Closure approval endpoints (slice 10)
requestClosure({incidentId,reason,expectedUpdatedAt}) human commander only. approveClosure({requestId}) requires
commander/responder, rejects the requester (already counted) and repeated identities. CHANGED 2026-11-08: two
distinct humans close an incident — the requester (counted by the request while still a live, unrevoked commander)
plus ONE other eligible commander/responder. Audit payload gains requesterCounted. Expiry 30min; unchanged incident version required. Invalid/revoked/expired
reviewers do not count. Second valid approval atomically closes and appends one approval audit row; anchor job
is queued on every approval. cancelClosure({requestId}) commander-only. Closure views require live human session.
No agent can request/approve/cancel; direct closure/reopening remains blocked. Snapshot.closures includes provenance.

## Scope states (2026-11-08)
State is one of unknown/compromised/encrypted/exfiltrated/unaffected (`encrypted` added). getScope returns it unchanged.

## Enrolment from the UI + agent_status (2026-11-08)
Commanders enrol from INVESTIGATE → AGENT SERVICE: paste the worker's printed line or the 64-hex identity; the client
calls enrollAgent({target: Identity.fromString(hex), incidentId: selected}). Server rules unchanged.
Read-only view agent_status (signed-in humans only): [{identity, incidentId, enrolledAt, sessionActive, revoked}].

