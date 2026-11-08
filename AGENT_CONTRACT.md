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
No approval/delete endpoint exists. Future permission/approval/delete reducers must use the same human gate.

## Five tool mappings

| Tool | Generated call | Result |
|---|---|---|
| searchIncidents({query}) | conn.procedures.searchIncidents({query}) | JSON string: [{incidentId,title,severity,status}], max 50, agent's incident only |
| getScope({incidentId}) | conn.procedures.getScope({incidentId: BigInt(incidentId)}) | JSON string: {incidentId,available:false,items:[],reason}; storage pending slice 6 |
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
Scope unavailable is explicit; do not tell the model that an empty placeholder establishes no exposure.

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
