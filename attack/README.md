# attack/

Live attack script and security regression suite for BLACKBOX. Zero dependencies: it talks to
SpacetimeDB's HTTP API directly and uses the `spacetime` CLI only for owner-level SQL.

```bash
cd attack
npm run attack        # every slice's attacks (suites/), exit 1 if any attack succeeded
npm run attack:demo   # the four on-stage attacks (demo/)
```

Output per check: **PASS** = defense held · **VULN** = attack succeeded · **SKIP** = slice not landed.

## Safety
- Targets `http://127.0.0.1:3000`, db `blackbox` by default. Override with `ATTACK_TARGET` / `ATTACK_DB`.
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
node attack/probes/run-attribution.mjs # from repo root: Q1, exits 1 while vulnerable
cd blackbox/spacetimedb
$env:BLACKBOX_PROBE_ANCHOR_RACE='1'
npm test                             # A1: test 6 fails while vulnerable
Remove-Item Env:BLACKBOX_PROBE_ANCHOR_RACE
```

The unconfigured/local anchor is not an independently deployed checkpoint. Injection and offline browser demo
scripts are still skipped; they are not claimed verified by mock worker tests.
