# BLACKBOX handoff for Codex · 2026-11-07 20:15 CT

Start a **new** Codex chat and paste this file. Then read `RABEET_HANDOFF.md` (full rules, environment, per-push
routine) and the "FROM RABEET" section of `STATUS.md`. This file only says what changed and what is next.

## Who and what
You work for Rabeet (GitHub `Siddiqui-R`), test lead on BLACKBOX for HackUTD 2026. Teammate Muhammad "Sensei"
(`Abbas9x`) owns `blackbox/**`. Rabeet owns `agent/`, `attack/`, `tests/`, `pdf/`, `blackbox/spacetimedb/test/`.
**Code freeze Sun Nov 8 9:00 AM, submission 12:00 PM.**

Hard rules: no AI attribution in commits, PRs or comments · never force-push · never commit `.env`,
`agent/.agent-token`, `agent-logs/`, `node_modules` · ask Rabeet before any live NVIDIA call, new dependency or
schema change · don't edit `blackbox/**` except small fixes to security holes in `index.ts` (then say so on issue #2).

## State right now (all pushed)
- `main` = `fix/attack-scaffold` = `2905835`. Working tree clean except untracked handoff `.md` files (leave them).
- Local SpacetimeDB is running on `127.0.0.1:3000`, module `blackbox` republished at this commit.
- Results at `2905835`: **275 regression checks pass, 0 fail** (`cd attack && npm run attack`) · unit tests 8/8
  (`cd blackbox/spacetimedb && npm test`) · `cd blackbox/client && npx tsc -b` passes · demo 5 pass / 2 skipped.
- Last two commits: worker checks `agent_run_status` for its exact run before every trace; PDF renderer accepts the
  owner's adapter credential `PDF_RENDERER_TOKEN`; new suites for the hosted checkpoint store and `/api/pdf` adapter.
- Issue #2 updated: https://github.com/Siddiqui-R/Hack_UTD_2026/issues/2#issuecomment-6715909851

## Waiting on Sensei (don't fix these yourself; they are in his module)
- **A1 HIGH:** anchor comparison must run in the same final transaction as chain verification.
  Check: `BLACKBOX_PROBE_ANCHOR_RACE=1 npm test` in `blackbox/spacetimedb` (test 6 fails until fixed).
- **Q1 MED:** `record_agent_step` needs an expected `runId` argument. Check: `node attack/probes/run-attribution.mjs`
  (exits 1 until fixed). When he picks the signature, update `agent/src/worker.mjs` `trace` to pass it.
- **P1 LOW:** read procedures throw instead of returning `{error}`.

## Your next tasks, in order
1. **Every new commit on `origin/main` that isn't Rabeet's:** run the routine in `RABEET_HANDOFF.md` §2
   (pull, republish, regenerate, run all checks, record in FINDINGS/STATUS, push, comment on issue #2).
   After `spacetime generate`, revert line-ending-only binding changes before pulling.
2. When A1 or Q1 lands: rerun the probes above, move the item to "Fixed" in `attack/FINDINGS.md`.
3. Deployment prep before 9 AM (`RABEET_HANDOFF.md` §7 item 8): Maincloud demo DB, phone-hotspot test,
   `AGENT_MODE=replay`, final gitleaks sweep (`gitleaks git . --redact` must say no leaks), make repo public.
4. **Demo is finished (`098d049`):** `cd attack && npm run attack:demo` → 16 held, 0 skipped. Demo 3 checks the
   evidence fence and that the agent server-side can't do what injected text asks; demo 4 opens two live SDK
   connections, drops one, and checks it resyncs. No Playwright needed. Please update the "Demo:" line in `STATUS.md`
   and the "Injection and offline browser demo scripts are still skipped" line in `attack/README.md` (Claude left
   them alone because you had uncommitted edits in both files). Rehearse `npm run attack:demo` 10× before 9 AM.

**Leave to Rabeet / Claude:** anything that edits the prompt-injection payloads or demo 3. Writing those tripped OpenAI's
safety filter and stalled the last Codex chat. If a reply is refused with "flagged for possible cybersecurity risk",
stop and tell Rabeet instead of retrying in the same chat.
