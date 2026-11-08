# Deployment and integration

## Current state

- Independent checkpoint service is deployed at https://blackbox-checkpoint-utd2026.aerialoats1.chatgpt.site.
  Durable Cloudflare D1 storage, private host access plus distinct application read/write credentials.
  Deployment `appgdep_6aefd0dfc4988191a1c276e544499b70` succeeded; authenticated health returned 200.
  The existing local module stored checkpoint #100 there at 2026-11-08 01:36:06 UTC.
- Local module `blackbox` uses that service; published with `--delete-data=never`, scheduler started.
- **Maincloud module DEPLOYED** (2026-11-08 02:57 UTC): database `blackbox-utd2026-abbas9x`,
  identity `c20052e93d7b67eac57ce1eccc1ab853762193ed5e0d89e3ad5d8ba8fb4cd6b7`,
  dashboard https://spacetimedb.com/blackbox-utd2026-abbas9x. Published by the owner's spacetimedb.com account
  identity `c2001ebc16189dd6043a7e15b4522fdd2b562ab6e4cf7f68096ea11546360bfb` (the account that redeemed the
  hackathon code) via `deployment/publish.mjs maincloud` with `--delete-data=never`. Fresh database: no local data
  was migrated. All five anchor env values present (`start_anchoring` succeeded; it refuses without them).
  `start_anchoring` called by the owner: audit #1 `anchor.start`, external checkpoint seq 1 stored at
  02:57:50Z, 60 s interval job scheduled.
  Verified without writing data: a client built with `--mode cloud` connects (LINK UP), and a bogus invite is
  rejected by the cloud module (cloud log: `redeem_invite: invalid or expired code`).
  **No commander exists on Maincloud yet** — the owner issues the first bootstrap code (below) when ready.
- Client stays on Vercel per owner instruction. Vercel access is pending; no production client URL yet.
  No local-to-cloud data migration has been performed or claimed.

## First commander on Maincloud (owner only)

Fastest (also the lockout recovery, ~10 s): `node blackbox/spacetimedb/deployment/commander-code.mjs maincloud`
prints a fresh single-use commander code. Same script with `local` for the local database.

```bash
cd blackbox/spacetimedb
"$LOCALAPPDATA/SpacetimeDB/bin/current/spacetimedb-cli.exe" --config-path .env.maincloud-cli.toml call blackbox-utd2026-abbas9x issue_bootstrap_invite '"XXXX-XXXX"' --server maincloud --no-config
```
Use 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; it expires in 30 minutes and works once.
Local cloud-pointed client: `npm run dev -- --mode cloud` in blackbox/client (reads ignored `.env.cloud`:
VITE_STDB_URI=wss://maincloud.spacetimedb.com, VITE_STDB_DB=blackbox-utd2026-abbas9x).

## Module publishing

`node blackbox/spacetimedb/deployment/publish.mjs local|maincloud [--env-only]` reads the ignored
`blackbox/spacetimedb/.env.anchor.production.json`, passes values through the child environment and always
publishes with deletion disabled. Never print or commit that file. Its keys are ANCHOR_URL,
ANCHOR_WRITE_TOKEN, ANCHOR_READ_TOKEN, ANCHOR_GATE_TOKEN and ANCHOR_INDEPENDENT=1.
The separate ignored `.env.maincloud-cli.toml` keeps Maincloud account login separate from the existing
local owner's CLI config. After cloud deployment, the database owner must call `start_anchoring` once.
The scheduler writes every 60 seconds and on severity/approval events. Chain verification is internal
consistency; only a matching independently fetched checkpoint permits an independent verification label.
This protects against database-only rewrites, not compromise of both deployments or a trusted timestamp authority.

The hosted source is `blackbox/spacetimedb/anchor-store/hosted/`; its SQLite migration creates an append-only
checkpoint table. The nested `.sites-checkout/` deployment checkout is ignored. Host service access and
application secrets are never VITE variables, repository content or worker configuration handed to Rabeet.

## Vercel configuration

Project root: `blackbox/client`. Framework Vite; install `npm ci`; build `npm run build`; output `dist`.
`vercel.json` preserves `/api/*` functions and rewrites application routes to index.html.

| Variable | Intended production value | Visibility |
|---|---|---|
| VITE_STDB_URI | wss://maincloud.spacetimedb.com | Public; module is deployed |
| VITE_STDB_DB | blackbox-utd2026-abbas9x | Public; module is deployed |
| VITE_PDF_URL | /api/pdf (or unset for default) | Public |
| PDF_RENDERER_URL | Rabeet's deployed HTTPS rendering endpoint | Server only; pending |
| PDF_RENDERER_TOKEN | Optional renderer shared credential, supplied privately | Server only; pending |

Rebuild after changing VITE variables. The Maincloud database is live, so the client may now point at it.
`GET /api/integrations` returns `{pdfReady,moduleConfigured}` configuration flags; it does not probe the renderer.

## Queue and trace contract for Rabeet

Generate service bindings from the current module. Production needs a fresh Maincloud-issued service identity;
do not reuse the local JWT. Keep separate local/production token storage. A human commander enrols that
identity for one incident via `enrollAgent({target,incidentId})`. Read-only polling does not refresh its 15-minute
session; re-enrol an expired idle identity through the human flow. Revocation is enforced server-side.

For raw HTTP, POST JSON arrays with `Authorization: Bearer <service token>` to
`https://maincloud.spacetimedb.com/v1/database/blackbox-utd2026-abbas9x/call/<name>` (deployed).
For local integration use `http://127.0.0.1:3000/v1/database/blackbox/call/<name>` now.
These URL database names are not incident IDs. Never send credentials in URLs or log Authorization headers.

| Endpoint | Positional JSON arguments | Result |
|---|---|---|
| next_agent_run | [] | JSON-encoded string containing null or {runId,incidentId,tier,mode,modelId} |
| agent_run_status | [runId] | JSON-encoded string containing {runId,status,modelId}; enrolled incident only |
| begin_agent_run | [runId,actualModelId] | Reducer, no result payload |
| record_agent_step | [kind,name,inputJson,outputJson] | Reducer; active run inferred from caller |
| finish_agent_run | [runId,summary,failed] | Reducer; server measures elapsed time |

SDK argument for begin is `{runId,modelId}`; `actualModelId` above describes its value, not a parameter name.
IDs returned inside JSON strings are decimal strings. Send u64 HTTP arguments as exact JSON integers
(not lossy JavaScript Numbers); SDK uses BigInt. Parse procedure response JSON, then parse the returned string.
Step kinds: call/result/revision/error/summary. inputJson/outputJson are serialized JSON strings, at most
32000 characters each; empty string becomes null. Summary is 1–16000 characters. Actual model ID is 1–160.
UI queue requests are mock/replay only: honor each request's mode and tier; never fall back to live config.
Use the same existing five-tool loop. Mock results must remain visibly mock and cannot imply a model call.
Claim failure means do not execute. Stop work when cancelled; do not keep applying tools after cancellation.
Poll agentRunStatus({runId}) before tool execution and stop on cancelled/failed/completed; it does not extend
the session. Human investigation subscriptions are unavailable to agent identities. The UI displays the actual model
and server latency, and retains the previous completed summary for self-correction. Flag FAST full-run latency
over roughly 8 seconds when future authorized live measurements are made. No new model calls are authorized here.

Needed from Rabeet: worker queue/claim/trace/finish wiring, separate production identity/token persistence and
confirmation of cancellation handling. He owns worker deployment and all security/adversarial validation.

## PDF contract for Rabeet

Rabeet supplies an HTTPS endpoint and, if needed, a shared credential privately. The renderer accepts a
POST with Content-Type application/json containing RecordSnapshot schemaVersion 1, defined exactly in
`blackbox/client/src/lib/recordTypes.ts`; it returns status 200 with Content-Type application/pdf, at most 4 MiB.
The Vercel adapter allows 20 seconds for rendering (plus 15 seconds for fresh module snapshot retrieval).
It sends the optional PDF_RENDERER_TOKEN Bearer credential, NEVER the user's SpacetimeDB token.
IDs and epoch microseconds are decimal strings. Respect permissions/redacted arrays; never reconstruct hidden data.
Render generatedAt, chain result, actual anchoredCheckpoint.headHash/seq/time/ref and independentlyVerified.
auditHead.hash is the current database head, not automatically an external checkpoint. An absent/failed anchor
must remain explicit in the PDF. Keep snapshots, incident evidence and credentials out of renderer logs.

Browser POST /api/pdf uses `{incidentId:"123"}` with the user's session Bearer token. The adapter obtains a new
authorized get_record response instead of trusting a browser-supplied snapshot. Until renderer configuration
is supplied, PDF readiness is false and Export PDF is disabled. JSON export is already available.

Needed from Rabeet: renderer URL, optional private shared credential, deployment readiness and acceptance of
RecordSnapshot v1 including scope, closure provenance and truthful anchoring labels. Renderer implementation
and PDF/security tests remain entirely his ownership.
