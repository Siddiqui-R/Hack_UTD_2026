# Hosted independent checkpoints

Cloudflare Worker ESM with durable D1 binding `DB`. The migration in `drizzle/` creates the append-only
checkpoint table and update/delete rejection triggers. No evidence or database credentials are stored here.

Build with `npm run build`, validate with `npm run validate`, then use the Sites source/archive deployment
workflow. Edit worker/index.js rather than generated dist/. Hosting manifest is .openai/hosting.json.
Set ANCHOR_WRITE_TOKEN and ANCHOR_READ_TOKEN through the host's secret configuration.
Private host service access is separate from these application credentials.

GET /health checks the D1 binding. POST /checkpoint accepts {database,seq,headHash} with write Bearer auth.
GET /checkpoints?database=<64-hex-identity> returns ordered history with read Bearer auth. Identical writes
are idempotent; a conflicting hash or regressing sequence is rejected. See root DEPLOYMENT.md for the
deployed endpoint and current module/client integration state. Rabeet owns adversarial/durability testing.
