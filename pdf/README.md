# RECORD PDF endpoint

Run `cd pdf && npm start` with Node 22+ and installed Chrome, Chromium or Edge. No npm packages are required.
Set `PDF_BROWSER_PATH` when the browser is not at a standard path. The service binds to loopback port 4400;
override `PDF_HOST`/`PDF_PORT` for hosting. `GET /health` checks HTTP availability.

Set `VITE_PDF_URL=http://127.0.0.1:4400/record.pdf` in `blackbox/client/.env.local`, then restart Vite.
The existing Export PDF button posts the unmodified RecordSnapshot v1 JSON and downloads application/pdf.
The renderer receives no SpacetimeDB token and makes no NVIDIA requests. No contract changes are required.
For deployment, install Chromium on the renderer host, use HTTPS, set `PDF_ALLOWED_ORIGINS` to the exact client
origin, and prefer a same-origin `/record.pdf` reverse proxy. The local endpoint is not a deployed service.

Snapshots are rendered in memory plus temporary browser files, removed after each request, and never logged.
Untrusted content is escaped into text and network content is blocked by CSP. The endpoint rejects tokens,
unknown origins, malformed snapshots, payloads over 2 MiB and concurrent rendering. Keep it behind the same
deployment's access controls when publicly hosted; CORS alone is not server authentication.

Reports contain the actual external checkpoint hash separately from the current database head. Unconfigured,
local, unavailable, mismatched and broken states remain explicit. Later uncheckpointed audit events are called
out. Observer evidence/scope restrictions are applied again during rendering. A PDF is an unsigned rendering
of supplied JSON, not an independent attestation that the snapshot or its verification claims are authentic.
