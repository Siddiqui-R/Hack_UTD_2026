# RECORD PDF endpoint

## Hosted (production)
Deployed as its own Vercel project `rabeet1/blackbox-pdf` at **`https://blackbox-pdf.vercel.app/api/record`**
(`/api/health` for liveness). The client project's server-only `PDF_RENDERER_URL` points there and both projects hold
the same `PDF_RENDERER_TOKEN` as a sensitive variable (local copy only in the gitignored root `.env.pdf-renderer`).
`api/record.mjs` prints the same HTML as `render.mjs` with `@sparticuz/chromium@153.0.0` + `puppeteer-core@25.11.0`
(pinned pair, installed with `npm install --before=2026-10-24`). It refuses every request until a 32+ character token is
configured, checks it before reading the body, caps snapshots at 2 MiB and PDFs at 4 MiB, and aborts every page request.
Measured: 3.7 s cold, 0.4 s warm, against the adapter's 20 s. This project is not Git-connected: redeploy changes with
`cd pdf && npx vercel@65.2.0 deploy --prod --scope rabeet1`.
Limitation: the serverless Chromium ships only Latin-script fonts, so CJK, Arabic and symbol characters print as empty
boxes (they are not silently dropped). The RECORD view and JSON export keep the exact text.

## Local
Run `cd pdf && npm start` with Node 22+ and installed Chrome, Chromium or Edge. `npm start` uses no npm packages.
Set `PDF_BROWSER_PATH` when the browser is not at a standard path. The service binds to loopback port 4400;
override `PDF_HOST`/`PDF_PORT` for hosting. `GET /health` checks HTTP availability.

Set `VITE_PDF_URL=http://127.0.0.1:4400/record.pdf` in `blackbox/client/.env.local`, then restart Vite.
The existing Export PDF button posts the unmodified RecordSnapshot v1 JSON and downloads application/pdf.
The renderer receives no SpacetimeDB token and makes no NVIDIA requests. No contract changes are required.
For deployment, install Chromium on the renderer host, use HTTPS, set `PDF_ALLOWED_ORIGINS` to the exact client
origin, and prefer a same-origin `/record.pdf` reverse proxy. The local endpoint is not a deployed service.
On any internet-reachable host set `PDF_PUBLIC=1`: the server then refuses to start without a `PDF_RENDERER_TOKEN`
of at least 32 characters (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

The owner's newer authenticated Vercel adapter (`4eb367f`) is supported without signature changes: set its
server-only PDF_RENDERER_URL to this service's HTTPS `/record.pdf`. Set the same PDF_RENDERER_TOKEN on both
services to require the adapter's dedicated Bearer credential. Leave VITE_PDF_URL unset in production to use
`/api/pdf`; that route fetches a fresh authorized snapshot and sends only the renderer credential here.
The browser's SpacetimeDB token is never the renderer credential. Rendering times out at 18 seconds and
output is capped at 4 MiB, within the adapter's 20-second/4-MiB limits. Local direct-snapshot mode remains available.

Snapshots are rendered in memory plus temporary browser files, removed after each request, and never logged.
Untrusted content is escaped into text and network content is blocked by CSP. The endpoint rejects tokens,
unknown origins, malformed snapshots, payloads over 2 MiB and concurrent rendering. Keep it behind the same
deployment's access controls when publicly hosted; CORS alone is not server authentication.

Reports contain the actual external checkpoint hash separately from the current database head. Unconfigured,
local, unavailable, mismatched and broken states remain explicit. Later uncheckpointed audit events are called
out. Observer evidence/scope restrictions are applied again during rendering. A PDF is an unsigned rendering
of supplied JSON, not an independent attestation that the snapshot or its verification claims are authentic.
