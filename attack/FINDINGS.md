# Security findings

Reproduce any finding with `npm run attack` against a local server. IDs match the script output.
Unit tests: `cd blackbox/spacetimedb && npm test`.

## Open

| ID | Severity | Finding | Fix |
|---|---|---|---|
| V9 | **HIGH** | Any commander can **permanently** revoke any other commander: no second approver, and no un-revoke. A stolen commander token can revoke every other commander, then revoke each new commander the owner bootstraps as they appear. | Owner-only `unrevoke`, or let only the owner revoke commanders. Better: put commander-on-commander revokes under the slice 10 two-person approval. |
| R14 | **HIGH** | Duress flag is visible to **every** signed-in user, observers included. Anyone given an observer invite (or a coerced user's coercer, holding a second account) sees who got flagged, which tells the coercer they were detected. | Only copy `isDuressed` into the `team` view when the caller is a commander. Better: a separate commander-only view. |
| S9 | MEDIUM | Any 8 chars from the alphabet are accepted as a code, e.g. `AAAAAAAA`. Bootstrap codes are typed by hand at the CLI, so humans will pick guessable ones. | Have `issue_bootstrap_invite` generate the code with `ctx.random` and print it with `console.log` (only the owner can read `spacetime logs`). At minimum reject codes with fewer than 5 distinct characters. |
| S-off | MEDIUM (code review) | Codes are ~40 bits, hashed with plain SHA-256. Anyone who gets a **read** of the DB (backup, snapshot, leaked owner token) can crack an unused code on one GPU in about 1–2 minutes, then redeem it within its 30-minute window. A bootstrap code yields commander. | 12-char codes (~59 bits) make this impractical. Also delete invite rows once they are used or expired, so there is nothing left to crack. |
| R11 | MEDIUM | Duplicate display names accepted. Someone can join as "Alice" next to the real Alice. | Reject a name matching an existing one (case-insensitive, trimmed). |
| R12 | MEDIUM | Bidi-override (U+202E) and zero-width (U+200B) chars stored in names; a name can display differently from what's stored. | Allow-list letters, digits, space, `.-_'`; reject `\p{C}`. |
| S-rev | LOW (code review) | Demoting a compromised commander leaves their unredeemed invites valid for up to 30 min. | When `set_role` demotes someone, delete invites with `createdBy` = them. |

**Fixed:** a stolen live token can now be killed with `revoke_session` (slice 2b). V1–V8 confirm it.

## Held

**Slice 1 (14 attacks):** unregistered write / set_role · direct read of private `user` · `team` empty for outsiders ·
self-registration removed (old R5 critical, **fixed in slice 2**) · observer write / self-promote / demote commander ·
bogus role · commander self-change · coerced user's own view shows `flagged=false`.

**Slice 2 (13 attacks):** non-owner and commander bootstrap · responder mints commander invite · external `sweep_sessions` ·
forged code · race of two redeems on one code (exactly 1 wins) · replay of used code with different formatting ·
uniform error message (no oracle) · online brute force (~3,000 guesses/s locally → ~38,000 h expected per code vs 0.5 h lifetime) ·
second redeem while signed in · **replayed token after session expiry: write rejected, no team data served.**

**Slice 2b (18 attacks):** self-revoke · responder or outsider revokes · revoked token writes, reads, or redeems a fresh code ·
the code isn't burned by that attempt · un-revoke via set_role · audit private · seq 1..N no gaps · prev_hash links ·
**independent recompute of every event_hash matches** · chain_head = last row · exactly 1 audit row per add_ping /
create_invite / set_role, 0 per failed call. A one-row owner edit is caught at the right seq, and restoring it makes the chain verify clean again.

## Notes, not bugs yet
- **Pitch honesty until slice 9:** an owner who edits a row *and recomputes every later hash* (or deletes the last N rows and resets `chain_head`) leaves a chain that verifies clean. Until the external anchor lands, say "tamper-evident within the database", nothing stronger.
- Failed redeem attempts write no audit row (the throw rolls back), so a brute-force attempt leaves no trace. Logging failures needs somewhere outside the transaction, e.g. the agent service.
- `init` (owner capture) isn't audited, so the chain doesn't record who the owner is.
- The DB owner can still `UPDATE user SET role='commander'` via raw SQL. Role changes made through `set_role` are audited now; a raw SQL edit isn't, so only an external anchor or a verifier that compares roles against audit history would expose it.
- One commander can demote every other commander. Consider two-person approval (slice 10) for role changes.
- `spacetime start` listens on `0.0.0.0:3000`, so anyone on venue wifi can reach a local server. Demo on Maincloud, or use `--listen-addr 127.0.0.1:3000`.
- `set_role` / `create_invite` don't reject the NEMOTRON actor yet. Expected in slice 8.
