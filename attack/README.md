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
