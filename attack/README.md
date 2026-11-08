# attack/

Live attack script and security regression suite for BLACKBOX. Zero dependencies: it talks to
SpacetimeDB's HTTP API directly and uses the `spacetime` CLI only for owner-level SQL.

```bash
cd attack
npm run local:publish # once, and after every module change: publish/republish the suite's own local database
npm run attack        # every slice's attacks (suites/), exit 1 if any attack succeeded
npm run attack:demo   # the four on-stage attacks (demo/)
node injection/run.mjs          # prompt-injection payloads: fence + server layers (no model calls)
node injection/run.mjs --live   # + one real Nemotron FAST run over all payloads (~6-8 hosted calls; ask first)
```

Output per check: **PASS** = defense held · **VULN** = attack succeeded · **SKIP** = slice not landed.

## Owner login and database
Owner-level SQL and calls need the identity that published the database. `npm run local:publish` mints a local owner
into `attack/.env.owner-cli.toml` (gitignored, never printed) and publishes `blackbox-attack`; `lib.mjs` then uses that
file for every owner command. The default `spacetime` login can stay on Maincloud for other work without breaking the
suite. Without that file the suite falls back to the default login and the `blackbox` database.

## Safety
- Targets `http://127.0.0.1:3000`, db `blackbox-attack` (or `blackbox` without the owner file). Override with
  `ATTACK_TARGET` / `ATTACK_DB` / `ATTACK_CLI_CONFIG`.
- Refuses any non-local target unless `ATTACK_ALLOW_REMOTE=1`. It rewrites rows as the DB owner;
  never point it at the live demo DB by accident.
- Re-runnable: every run uses fresh identities and run-tagged names, and restores anything it flips.

## Layout
- `suites/sliceNN-*.mjs` — one file per slice, added as each slice lands.
- `demo/1..4-*.mjs` — on-stage attacks (replay, tamper, injection, network cut).
- `FINDINGS.md` — what got through, per slice.

The full suite now includes chat/scope, checkpoint-store restart durability, closure approvals, actual child queue
workers and real PDF generation. It needs the existing agent packages and an installed Chrome/Chromium/Edge browser
for the PDF checks, with PDF_BROWSER_PATH when needed. It makes no model calls. Replay transport is exercised with
an explicitly labelled synthetic fixture; this is not a golden transcript from a real model run.

Open module findings are separately reproducible (see FINDINGS.md), so a passing regression run does not close them:

```powershell
node attack/probes/run-attribution.mjs # from repo root: Q1 stale trace; exits 0 (fixed), 1 if accepted, 2 if refused for another reason
node attack/probes/cancelled-tool.mjs  # Q1: tool write after cancellation; same exit codes (slice 14 covers both by default)
node attack/probes/checkpoint-alias.mjs # A2: local store numeric sequence alias, exits 1 while vulnerable
cd blackbox/spacetimedb
$env:BLACKBOX_PROBE_ANCHOR_RACE='1'
npm test                             # A1: fixed; test 6 covers anchor race by default
Remove-Item Env:BLACKBOX_PROBE_ANCHOR_RACE
```

Anchoring stays unconfigured on the local test database: SpacetimeDB refuses procedure HTTP to this machine's own
loopback address, so a local checkpoint store cannot work. Demo attack 2 shows INTEGRITY BROKEN and the module's red
bar locally; ANCHOR MISMATCH is shown on the deployed module with its independently hosted store.
Demo attack 3 checks the evidence fence and the server's refusals, not the model's own judgment (that is
`injection/run.mjs --live`). Demo attack 4 is an SDK disconnect/reconnect/catch-up, not a physical network test.
