# Fixes for open findings

Exact patches for `blackbox/spacetimedb/src/index.ts` as of `7d7d7ba` (slice 3), in priority order.
Each fix names the attack or test that proves it: re-run `cd attack && npm run attack` and
`cd blackbox/spacetimedb && npm test` afterwards. IDs match `FINDINGS.md`.

**Fix before the demo:** 1–4. **Fix if there's time:** 5–8. **Don't do:** see the warning at the end.

### Fastest path: apply the verified patch
Fixes **1–3 and 5–8** are in `attack/fixes.patch`, tested against `7d7d7ba`:

```bash
git apply attack/fixes.patch          # from the repo root; touches only blackbox/spacetimedb/src/index.ts
spacetime publish blackbox --server local --module-path blackbox/spacetimedb --no-config --yes --delete-data
spacetime generate ...                # new reducer: unrevoke_session
```

Result with the patch: unit tests **4/4 pass** (test #2 goes green), attacks **59 held, 1 open** (I12 = fix 4,
which needs a client change so it isn't in the patch). Three consecutive runs were identical. No reducer
arguments changed, so the client keeps working. New reducer: `unrevoke_session` (owner only).

---

## 1. I5 (HIGH): responders can close incidents
Proof: attack `I5`, unit test `#2` (currently failing).

In `updateIncident`, keep the caller's row and gate any move to or from `closed`:

```ts
// was: requireRole(ctx, ['commander', 'responder']);
const me = requireRole(ctx, ['commander', 'responder']);
const row = ctx.db.incident.id.find(args.incidentId);
if (!row) throw new SenderError('incident not found');
const next = { /* unchanged */ };
// NEW: only a commander may close or re-open
if ((next.status === 'closed') !== (row.status === 'closed') && me.role !== 'commander') {
  throw new SenderError('only a commander can close or reopen an incident');
}
```

---

## 2. R14 (HIGH): every user can see who is flagged for duress
Proof: attack `R14`. Must stay green: `R13` (the coerced user sees nothing).

In the `team` view, only commanders get the real flag:

```ts
export const team = spacetimedb.view({ name: 'team', public: true }, t.array(TeamMember), ctx => {
  const me = ctx.db.user.identity.find(ctx.sender);
  if (!me || !ctx.db.session.identity.find(ctx.sender)) return [];
  const seesDuress = me.role === 'commander';
  return [...ctx.db.user.iter()].map(u => ({
    // ...other fields unchanged...
    flagged: seesDuress && !u.identity.isEqual(ctx.sender) ? u.isDuressed : false,
  }));
});
```

---

## 3. V9 (HIGH): one commander can permanently revoke every other commander
Proof: attack `V9`. Must stay green: `V1`–`V8`.

Only the owner can revoke a commander, and only the owner can un-revoke. The owner isn't a
`user` row, so check it before `requireRole`:

```ts
function isOwner(ctx: Ctx) {
  const o = ctx.db.owner.id.find(0);
  return !!o && o.identity.isEqual(ctx.sender);
}

export const revokeSession = spacetimedb.reducer({ target: t.identity() }, (ctx, { target }) => {
  const byOwner = isOwner(ctx);
  if (!byOwner) requireRole(ctx, ['commander']);
  if (target.isEqual(ctx.sender)) throw new SenderError('cannot revoke yourself');
  const row = ctx.db.user.identity.find(target);
  if (!row) throw new SenderError('target not registered');
  if (row.role === 'commander' && !byOwner) throw new SenderError('only the owner can revoke a commander');
  // ...rest unchanged (delete session, insert revoked_identity, appendAudit)...
});

// Owner-only undo, for when a revoke was a mistake or the result of an attack.
export const unrevokeSession = spacetimedb.reducer({ target: t.identity() }, (ctx, { target }) => {
  if (!isOwner(ctx)) throw new SenderError('owner only');
  if (!ctx.db.revokedIdentity.identity.find(target)) throw new SenderError('not revoked');
  ctx.db.revokedIdentity.identity.delete(target);
  appendAudit(ctx, 'user.unrevoke', { target: target.toHexString() });
});
```

The demo story gets better too: "a stolen commander can't lock out the team; only the
out-of-band owner key can remove a commander."

---

## 4. I12 (MEDIUM): concurrent edits silently revert each other
Proof: attack `I12`.

Optimistic concurrency: the caller says which version they edited, and the server rejects stale writes.

```ts
export const updateIncident = spacetimedb.reducer(
  { incidentId: t.u64(), expectedUpdatedAt: t.timestamp(), severity: t.string(), status: t.string(),
    containmentStatus: t.string(), systemsAffected: t.string() },
  (ctx, args) => {
    const me = requireRole(ctx, ['commander', 'responder']);
    const row = ctx.db.incident.id.find(args.incidentId);
    if (!row) throw new SenderError('incident not found');
    if (row.updatedAt.microsSinceUnixEpoch !== args.expectedUpdatedAt.microsSinceUnixEpoch) {
      throw new SenderError('incident changed since you opened it; review and retry');
    }
    // ...rest unchanged...
```

Client (`IncidentDetail.tsx`): pass `expectedUpdatedAt: incident.updatedAt` and show the error as a
toast. Regenerate bindings. **Tell Rabeet** when you change the reducer arguments: the attack suite's
`update_incident` helper must add the new argument.

---

## 5. S9 (MEDIUM): weak codes like `AAAAAAAA` are accepted
Proof: attack `S9`.

In `storeInvite`, after `normalizeCode`:

```ts
if (new Set(normalized).size < 5) throw new SenderError('code too weak; generate one, don\'t type one');
```

For bootstrap codes, don't type them. Generate them with Node's crypto, e.g. add `scripts/new-code.mjs`:

```js
import { randomInt } from 'node:crypto';
const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const c = Array.from({ length: 8 }, () => A[randomInt(A.length)]).join('');
console.log(`${c.slice(0, 4)}-${c.slice(4)}`);
```

and in STATUS's run steps: ``spacetime call ... issue_bootstrap_invite "$(node scripts/new-code.mjs)"``.

---

## 6. Offline code cracking (MEDIUM): 40-bit codes + SHA-256
Proof: code review (not attackable live).

The design specifies 8 boxes, so keep the length. Instead, leave nothing to crack: delete the invite
row when it's redeemed, and have `sweepSessions` delete expired invites too:

```ts
// redeemInvite, replacing the update that marks it used:
ctx.db.inviteCode.codeHash.delete(invite.codeHash);   // the audit row already records the redeem

// sweepSessions, after the session loop:
for (const i of [...ctx.db.inviteCode.iter()]) {
  if (isExpired(ctx, i.expiresAt)) ctx.db.inviteCode.codeHash.delete(i.codeHash);
}
```

A DB copy then exposes only codes that are live right now (≤30 min, single use). Must stay green:
`S6`, `S7`, unit tests `#3` and `#4`. A deleted code reads as "invalid or expired", same as a used one.

---

## 7. R11 / R12 / I10 (MEDIUM/LOW): name impersonation, hidden characters
Proof: attacks `R11`, `R12`, `I10`.

One shared text rule, used for display names and incident titles:

```ts
// Invisible formatting chars (bidi overrides, zero-width) and control chars other than \n and \t.
// (Not \p{C}: that also rejects the newlines a multi-line "systems affected" field needs.)
const HIDDEN_CHARS = /\p{Cf}|[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

function cleanText(field: string, value: string, min: number, max: number) {
  const v = value.normalize('NFC').trim();
  if (HIDDEN_CHARS.test(v)) throw new SenderError(`${field} contains hidden or control characters`);
  if (v.length < min || v.length > max) throw new SenderError(`${field} must be ${min}-${max} chars`);
  return v;
}

// redeemInvite: replace the manual displayName check with
const name = cleanText('display name', displayName, 1, 40);
// ...and AFTER the invite has been validated (not before: that would let anyone without a code
// probe which names are on the team):
const taken = [...ctx.db.user.iter()].some(u =>
  !u.identity.isEqual(ctx.sender) && u.displayName.toLowerCase() === name.toLowerCase());
if (taken) throw new SenderError('display name already in use');
```

Move `cleanText` above `redeemInvite` (it's currently defined in the slice 3 section).

---

## 8. Small ones
- **S-rev (LOW):** in `setRole`, when demoting a commander, delete their outstanding invites:
  `for (const i of [...ctx.db.inviteCode.iter()]) if (i.createdBy.isEqual(target)) ctx.db.inviteCode.codeHash.delete(i.codeHash);`
- **I9 (LOW):** in `createIncident`, also reject old dates:
  `if (args.detectedAt.microsSinceUnixEpoch < ctx.timestamp.microsSinceUnixEpoch - 365n * 24n * 3600n * 1_000_000n) throw new SenderError('detected time is more than a year ago');`

---

## ⚠️ Don't use `ctx.random` (or `ctx.newUuidV4`) for anything secret

SpacetimeDB seeds the reducer RNG **from the transaction timestamp only**
(`node_modules/spacetimedb/dist/server/index.mjs`: `makeRandom(this.timestamp)`). That timestamp is
stored in `audit.created_at` and `invite_code.created_at`, so anyone who can read either can
regenerate every "random" value from that transaction.

It's fine for shuffles or IDs. It's **not** fine for invite codes, TOTP secrets (slice 13), duress PINs,
anchor nonces, or session tokens. Generate secrets on the client (`crypto.getRandomValues`) or in the
agent service (`node:crypto`), and pass in only what the module must store, hashed where possible.
