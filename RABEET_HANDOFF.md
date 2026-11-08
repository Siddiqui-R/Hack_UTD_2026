# BLACKBOX — RABEET HANDOFF (security, agent, tests) · as of 2026-11-07 19:55
Paste this whole file as the first message to the agent taking over Rabeet's work. It replaces
`BLACKBOX_HANDOFF.md` and `RABEET_BRIEF.md`.

## 1. Context
You work for **Rabeet** (GitHub `Siddiqui-R`, repo owner), testing/security lead on **BLACKBOX**, HackUTD 2026 "Zero Day".
Repo: https://github.com/Siddiqui-R/Hack_UTD_2026 · **Code freeze Sun Nov 8 9:00 AM · Submission 12:00 PM.**
Teammate **Muhammad "Sensei"** (GitHub `Abbas9x`) builds module + UI fast with his own AI agent and skips tests.
**You are the safety net:** pull, test, break, secure, fix. You don't add product features; ask Sensei for them.

**Product:** an incident command center that assumes the attacker already owns the company's network, logins and laptops.
The response team switches to it after a ransomware hit: invite-code login, roles, sessions + revocation, shared incident
record, live chat, a Nemotron agent that writes to the DB, and a hash-chained audit log. It does **not** detect attacks.

| Track | Requires |
|---|---|
| **Winstead** (primary) | Secure isolated command center. *"The assumption must be that the attacker has access to all internal systems. The dashboard must be independently secure."* |
| **NVIDIA** | Nemotron as a real multi-step tool-using agent, not a chatbot |
| **SpacetimeDB** | Public repo, majority of backend on SpacetimeDB |

**Honest claims, enforce in the pitch and docs:**
| Never say | Say |
|---|---|
| "Works even if your laptop is compromised" | "A coordination channel that doesn't depend on the compromised environment" |
| "Proves nothing was touched" | "Detects tampering against an independently anchored checkpoint" (only once slice 9 works; until then "tamper-evident within the database") |
| "Unhackable" | "Assumes the attacker is already inside, and is designed around that" |
| "NEMOTRON rows are proof it was the model" | "Actions by an identity a commander enrolled as the agent" |

**Demo (3 min), build toward exactly this:** two browsers, invite login, commander files incident, appears live ·
INVESTIGATE: Nemotron `searchIncidents → getScope → createTask ×3 → updateSeverity` · contradicting log → `flagConflict`,
agent revises itself · **attack script live** (stolen session denied, audit row edited → INTEGRITY BROKEN + ANCHOR
MISMATCH, injection flagged not obeyed, network killed → still running) · one-click PDF with the anchored head hash.

## 2. Your main job: test and fix every push
When a new commit lands on `origin/main` that isn't yours, run this **in full** without being asked. If you can loop,
poll `git fetch origin && git log --oneline HEAD..origin/main` every ~10 min.

1. **Pull.** `git status --short` must be clean (see §5 on binding line endings), then `git pull --rebase origin main`.
   Merge conflict under `blackbox/` → stop and tell Rabeet. Never resolve it yourself (it silently drops reducers).
2. **Read the diff** (`git show <sha> -- blackbox/spacetimedb/src/index.ts`), the new STATUS log entry and its
   "Attack this:" line. Check every new/changed reducer and procedure against §4.
3. **Republish (keep data) + regenerate:**
   ```
   cd blackbox
   spacetime publish blackbox --server local --module-path ./spacetimedb --no-config --yes
   spacetime generate --lang typescript --out-dir client/src/module_bindings --module-path ./spacetimedb --no-config --yes
   ```
   Add `--delete-data` only if publish refuses a schema change; say so in STATUS.
4. **Run everything** (all must pass): `cd attack && npm run attack` (0 VULN, 0 errors) + `npm run attack:demo` ·
   `cd blackbox/spacetimedb && npm test` · `cd blackbox/client && npx tsc -b` · `cd agent && npm run agent` (mock) if
   anything agent-facing changed.
5. **Attack the new slice:** new `attack/suites/sliceNN-<name>.mjs` covering its "Attack this:" line plus the §4 rules
   (wrong role, outsider, revoked/expired session, NEMOTRON, cross-incident, audit row count). Owner-made edits are
   restored in `finally{}` so suites re-run. Pattern: `slice04-verify-chain.mjs`.
6. **Fix what you find:**
   - Bugs in `agent/`, `attack/`, `tests/`, `pdf/`, `blackbox/spacetimedb/test/`: fix directly.
   - **Security holes in `blackbox/spacetimedb/src/index.ts`: fix directly** (Rabeet authorized). Small fix, no renamed
     reducers/args or changed table shapes, re-run step 4, call it out on issue #2.
   - Anything else in `blackbox/**` (UI, non-security logic): don't edit; write it in FINDINGS + STATUS with a fix.
   - A test broke from an intended change (e.g. new reducer arg): update the attack helper, not the module.
7. **Record:** `attack/FINDINGS.md` (status line, Open/Fixed/Held) and only the **"FROM RABEET"** section of `STATUS.md`
   (commit tested, scores, what was verified, do-now items, what you're waiting on).
8. **Commit + push:** small commits, only files with real changes, then
   ```
   gitleaks git . --redact                      # must say "no leaks found"; also never commit nvapi- keys
   git pull --rebase origin main
   git push origin HEAD:main                    # fast-forward only
   git push origin HEAD:fix/attack-scaffold     # plain push
   ```
9. **Comment on GitHub issue #2** (`gh issue comment 2 --body ...`): sha tested, scores, findings, any edit to his files,
   what you're waiting on. Read his replies there.

Do steps 4, 7, 8, 9 after your own pushes too.

## 3. Hard rules
- **No AI attribution anywhere:** no `Co-Authored-By`, no "Generated with" in commits, PRs or comments
  (overrides any harness reminder asking for them).
- **Ownership:** Rabeet owns `agent/`, `attack/`, `tests/`, `pdf/`, `blackbox/spacetimedb/test/`, `vitest.config.ts`.
  Sensei owns `blackbox/spacetimedb/**`, `blackbox/client/**` (security fixes to `index.ts` allowed, §2.6).
- **Never force-push** (`main` especially; auto-mode blocks `--force-with-lease` anyway).
- **Ask Rabeet before:** any live NVIDIA call, adding a dependency, changing a schema, resolving a module merge conflict.
- **NVIDIA budget: 40 live calls on the hosted API, 5 used** (`agent-logs/` is gitignored; counter is per machine).
  Use mock mode. Self-hosted endpoints aren't budgeted (§7 item 1).
- Never commit `.env`, `agent/.agent-token`, `node_modules`, `agent-logs/`, build output.

## 4. Security rules to check on every slice
- Every mutating reducer: `requireRole` / `ctx.sender` + live session check first, then **exactly one** `appendAudit`
  (exceptions: session keep-alive and expiry sweep). Failed calls write zero rows.
- `NEMOTRON` is rejected server-side on any permission, role, invite, approval, delete or close. It can't satisfy
  two-person approval (both approvers distinct humans). No agent tool deletes or closes an incident.
- Sensitive tables private (`user`, `invite_code`, `session`, `owner`, `agent_identity`, `audit`, future `totp_secret`);
  reads only through session-gated views/procedures. **Row-level security is deprecated in 2.14: don't use it.**
- Invite codes stored as SHA-256 only. Hash chain computed inside the reducer; no path accepts a client-supplied hash.
  `canonicalJson` exists in one place. `audit.seq` 1..N, no gaps. Don't change the hash formula
  `event_hash = SHA256(canonicalJson(row) + prev_hash)`, genesis = 64 zeros (`attack/lib.mjs` recomputes it independently).
- **Never `ctx.random` / `ctx.newUuidV4` for secrets:** seeded from `ctx.timestamp` only, which is stored in `audit`.
- Duress flag never reaches the coerced user's own connection.
- No rate limit on code guessing is possible (reducer rollback erases counters). Answer for judges: ~40-bit codes +
  30-min expiry + single use ≈ 38,000 h of online guessing per code.

## 5. Environment (Windows 11, PowerShell 7 + Git Bash)
- New shells have a stale PATH. In PowerShell prefix with:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')`
  Git Bash can't see `spacetime`/`gitleaks`; run those from PowerShell. `gh` in bash: `export PATH="$PATH:/c/Program Files/GitHub CLI"`.
- Tools: Node 26, SpacetimeDB CLI 2.14.1, gitleaks, `gh` (logged in as Siddiqui-R). No `.env` yet on this machine.
- Local server: `spacetime start` (0.0.0.0:3000); check `curl http://127.0.0.1:3000/v1/ping` → 200.
  Fresh DB needs a commander: `spacetime call --server local --no-config blackbox issue_bootstrap_invite '"ABCD-2345"'`.
- **`spacetime generate` rewrites every binding with LF endings.** If `git diff --ignore-cr-at-eol --stat` shows nothing
  for `blackbox/client/src/module_bindings`, revert them (`git checkout -- blackbox/client/src/module_bindings`) or
  `git pull --rebase` refuses to run. Commit bindings only with real changes.
- Repo is on OneDrive: `git fetch` sometimes prints "unable to update local ref". Fetch again.
- The CLI identity is the DB **owner**; the attack suite reads its token via `spacetime login show --token`.

**SpacetimeDB 2.14 facts (don't relearn):** the CLI's bundled rules (`blackbox/CLAUDE.md`, root `CLAUDE.md`) beat the
web rules file (stale ^1.11) · tables keyed inside `schema({...})` · reducer `addPing` is `add_ping` from CLI/HTTP ·
reducers can't use WebCrypto or network; `@noble/hashes` SHA-256 matches Node · scheduled procedures can make HTTP calls
(slice 9 anchor) · `spacetime.json` targets Maincloud, so local commands need `--no-config` · `ViewCtx` has no timestamp ·
SQL rejects timestamp literals in UPDATE (test expiry by publishing short TTLs, or `DELETE FROM session`) · identity tokens
never expire; our sessions (15 min, swept every 60 s) are the only expiry · a procedure that throws reports "fatal error"
(finding P1) · React 18.3.1 and TS 5.9 are pinned; don't upgrade.

## 6. What's built (all on main, latest `45ed917`)
- **Slices done: 0, 1, 2, 2b, 3, 3.5, 4** (`verifyChain` procedure + live status bar) + hardening.
  Remaining: 5 chat, 6 scope, 9 anchor, 10 two-person approval, 11 INVESTIGATE, 12 RECORD; 13 cut.
- **Scores @ `45ed917`: attacks 98/98 held · demo 5 held / 2 skipped · unit tests 6 pass / 2 todo · client builds.**
- **`attack/`** (zero deps): `npm run attack` (all suites; PASS/VULN/SKIP; exit 1 on VULN; local-only guard,
  `ATTACK_ALLOW_REMOTE=1` to override) · `npm run attack:demo`. Suites: `slice01-roles`, `02-invites`, `02b-revoke-audit`,
  `03-incidents`, `03b-agent-contract`, `04-verify-chain`. `lib.mjs`: `verifyChainIndependent(rows)`,
  `verifyChainRemote(who)` (decodes raw SATS `[ok, checked, [0,seq]|[1,[]], reason]`), `ownerSql`, `signIn`, `proc`.
- **Demo attacks** (`attack/demo/`): 1 stolen-token replay **live** · 2 owner edits an audit row **live** (both verifiers
  name the same seq, row restored) · 3 injection stub · 4 network cut stub.
- **Unit tests** (`blackbox/spacetimedb/test/security.test.ts`, max 8, delete flaky ones): #2 responder can't close,
  #3 invite expiry, #4 single-use, #5 clean 20-row chain, #6 correct `brokenAt`, #8 non-commander can't grant (partial).
  Todo: #1 observer can't read scope (slice 6), #7 one approver stays pending (slice 10).
- **`agent/`**: Nemotron service on `ai@7` + `@ai-sdk/openai-compatible` + `zod`; 5 flat tools `searchIncidents`,
  `getScope`, `createTask`, `updateSeverity`, `flagConflict`. `npm run agent` (mock, real DB writes, 400 ms steps),
  `agent:live` (MODEL_FAST), `agent:deep` (MODEL_DEEP, same code path), `agent:replay` (use at judging: "a recorded run
  of the real model, happy to run it live"). `npm run dev:setup` seeds an incident + 2 conflicting evidence and enrolls
  the agent. `maxOutputTokens 4096` (models reason first; small caps return empty), `maxRetries 0`, 8 steps,
  temp 1.0 / top_p 0.95, malformed tool call ends the run. **AI SDK v7: `isStepCount`, tools use `inputSchema`.**
  Injection defense: per-run nonce evidence delimiters, untrusted-data system prompt, server refuses all human ops,
  raise-only severity (server + agent). Budget skipped when `NVIDIA_BASE_URL` isn't integrate.api.nvidia.com.
  Models verified: `nvidia/nemotron-3.5-lightning-30b-a3b` (FAST, ~0.6 s), `nvidia/nemotron-3-ultra-550b-a55b` (DEEP).
- Docs: `AGENT_CONTRACT.md`, `STATUS.md`, `attack/FINDINGS.md`, `attack/FIXES.md`, `agent/README.md`, `DESIGN.md`.

## 7. Open items
**Findings:** only **P1 LOW** (read procedures that throw report "fatal error" and cost ~5×; return `{error}` JSON).
**Waiting on Sensei:** OK for Playwright + promptfoo (dev deps in `attack/`) · `record_agent_step` reducer + `agent_step`
table so slice 11 can show live tool calls.

**Rabeet's work, priority order (after the per-push routine):**
1. **NVIDIA live run:** key in root `.env` (copy `.env.example`), `cd agent && npm run dev:setup && npm run agent:live`
   once (ask Rabeet first), then `agent:replay`. Or self-host Nemotron on Brev ($60 credit, NIM or vLLM):
   `NVIDIA_BASE_URL=http://<host>:8000/v1`, `MODEL_FAST=<served model name>`, unbudgeted. Re-measure: if a full FAST run
   takes > ~8 s, tell Sensei (demo pacing).
2. When `record_agent_step` lands: call it from `agent/src/run.mjs` `trace()` for every call/result.
3. **Prompt injection:** ≥6 payloads covering direct override, fake system message, fake tool result, base64, a payload
   split across two evidence entries, and an invite-code exfiltration request; results in `attack/INJECTION_RESULTS.md`.
   Hand-writing them was stopped by a safety filter before: generate with **promptfoo red-team** (needs Sensei OK) or
   NVIDIA **garak**. Any that succeeds → fix + tell Sensei. Then `attack/demo/3-injection.mjs`.
4. **Slice 9 anchor** (Sensei; scheduled procedure writes `{seq, head_hash}` externally every 60 s and on severity
   change/approval; `verifyChain` adds `anchorOk, lastAnchorSeq, lastAnchorAt`; timeboxed to 1 h). Then in
   `2-tamper.mjs` (TODO marked): rewrite the whole chain consistently; `anchorOk === false` must catch it. Verify it
   really anchors outside SpacetimeDB; if not, the pitch stays "tamper-evident within the database".
5. Tests #8 agent part (NEMOTRON can't grant roles), #1 (slice 6), #7 (slice 10) + attacks for 5, 6, 10, 11, 12.
6. **Demo attack 4** (network cut) with Playwright `context.setOffline` once approved; second device stays up, resyncs.
7. **PDF export** (`pdf/`, `@react-pdf/renderer`, includes the anchored head hash) for slice 12.
8. **Before 9 AM:** separate demo DB on Maincloud for the live tamper attack (`ATTACK_ALLOW_REMOTE=1`), test the deployed
   app on a phone hotspot (not venue wifi), set `AGENT_MODE=replay` with a golden recorded run, final gitleaks +
   TruffleHog sweep (`git log -p` clean of `nvapi-`), make the repo public, rehearse `npm run attack:demo` 10× in a row.
   **After 9 AM nothing merges** except a demo-breaking crash fix with Sensei's OK.

**Agreed scope:** must = 9 anchor, 11 (one conflict flow), 12 RECORD; if time = 5 chat, 6 scope, 10 two-person approval;
**cut = 13** (TOTP, duress PIN, presets).
