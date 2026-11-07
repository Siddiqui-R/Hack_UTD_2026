# Security findings

Reproduce any finding with `npm run attack` against a local server. IDs match the script output.

## Slice 1 — users, roles, ctx.sender (tested at `4c6eb84`)

**Held (10):** unregistered write · unregistered set_role · direct read of private `user` table ·
`team` view empty for unregistered · observer write · observer self-promote · observer demotes others ·
bogus role string · double register · coerced user's own view shows `flagged=false`.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R5 | **CRITICAL** (until slice 2) | Anyone on the internet who calls `register` first on a fresh DB becomes **commander**. Confirmed with `spacetime call --anonymous`. | Known temporary. Do not publish to Maincloud before slice 2 replaces it with invite codes. |
| R14 | **HIGH** | Duress flag is visible to **every** registered user, including observers. Registration is open (any fresh identity can register), so an attacker can self-register as an observer and watch who gets flagged, which tells the coercer they were detected. | Only show `flagged` to commanders (in the `team` view, check the caller's role before copying `isDuressed`). Better still: keep it in a separate commander-only view. |
| R11 | MEDIUM | Duplicate display names accepted. An observer can register as "Alice" next to the real Alice. Under stress, responders trust names. | Reject names that match an existing one (case-insensitive, after trim). |
| R12 | MEDIUM | Bidi-override (U+202E) and zero-width (U+200B) characters stored in names. These can render as a different name than the one stored. | Allow-list: letters, digits, space, `.-_'`. Reject `\p{C}` (control/format) chars. |

**Notes, not bugs yet**
- The DB owner can `UPDATE user SET role='commander'` via raw SQL with no trace. This is the "attacker owns the DB" threat. Slice 4 must make role changes write an audit row so the chain exposes it.
- A commander can demote every other commander, so one compromised commander locks out the team. Consider putting role changes under the slice 10 two-person approval.
- `spacetime start` listens on `0.0.0.0:3000`: anyone on venue wifi can reach a local demo server. Demo on Maincloud, or start with `--listen-addr 127.0.0.1:3000`.
- `set_role` doesn't reject the NEMOTRON actor yet. Expected in slice 8.
