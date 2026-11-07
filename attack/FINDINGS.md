# Security findings

Reproduce any finding with `npm run attack` against a local server. IDs match the script output.
Unit tests: `cd blackbox/spacetimedb && npm test`.

## Open

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R14 | **HIGH** | Duress flag is visible to **every** signed-in user, observers included. Anyone given an observer invite (or a coerced user's coercer, holding a second account) sees who got flagged, which tells the coercer they were detected. | Only copy `isDuressed` into the `team` view when the caller is a commander. Better: a separate commander-only view. |
| S9 | MEDIUM | Any 8 chars from the alphabet are accepted as a code, e.g. `AAAAAAAA`. Bootstrap codes are typed by hand at the CLI, so humans will pick guessable ones. | Have `issue_bootstrap_invite` generate the code with `ctx.random` and print it with `console.log` (only the owner can read `spacetime logs`). At minimum reject codes with fewer than 5 distinct characters. |
| S-off | MEDIUM (code review) | Codes are ~40 bits, hashed with plain SHA-256. Anyone who gets a **read** of the DB (backup, snapshot, leaked owner token) can crack an unused code on one GPU in about 1–2 minutes, then redeem it within its 30-minute window. A bootstrap code yields commander. | 12-char codes (~59 bits) make this impractical. Also delete invite rows once they are used or expired, so there is nothing left to crack. |
| R11 | MEDIUM | Duplicate display names accepted. Someone can join as "Alice" next to the real Alice. | Reject a name matching an existing one (case-insensitive, trimmed). |
| R12 | MEDIUM | Bidi-override (U+202E) and zero-width (U+200B) chars stored in names; a name can display differently from what's stored. | Allow-list letters, digits, space, `.-_'`; reject `\p{C}`. |
| S-rev | LOW (code review) | Demoting a compromised commander leaves their unredeemed invites valid for up to 30 min. | When `set_role` demotes someone, delete invites with `createdBy` = them. |

**Known and accepted by Sensei:** a token stolen while its session is live works until the session expires (≤15 min idle). There's no revoke. Suggest a commander-only `revoke_session(target)`; slice 13's duress could call it too.

## Held

**Slice 1 (14 attacks):** unregistered write / set_role · direct read of private `user` · `team` empty for outsiders ·
self-registration removed (old R5 critical, **fixed in slice 2**) · observer write / self-promote / demote commander ·
bogus role · commander self-change · coerced user's own view shows `flagged=false`.

**Slice 2 (13 attacks):** non-owner and commander bootstrap · responder mints commander invite · external `sweep_sessions` ·
forged code · race of two redeems on one code (exactly 1 wins) · replay of used code with different formatting ·
uniform error message (no oracle) · online brute force (~3,000 guesses/s locally → ~38,000 h expected per code vs 0.5 h lifetime) ·
second redeem while signed in · **replayed token after session expiry: write rejected, no team data served.**

## Notes, not bugs yet
- The DB owner can `UPDATE user SET role='commander'` via raw SQL with no trace. Slice 4 must audit role changes so the chain exposes it.
- One commander can demote every other commander. Consider two-person approval (slice 10) for role changes.
- `spacetime start` listens on `0.0.0.0:3000`, so anyone on venue wifi can reach a local server. Demo on Maincloud, or use `--listen-addr 127.0.0.1:3000`.
- `set_role` / `create_invite` don't reject the NEMOTRON actor yet. Expected in slice 8.
