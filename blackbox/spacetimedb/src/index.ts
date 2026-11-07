import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import { sha256Hex } from './crypto';

const ROLES = ['commander', 'responder', 'observer'] as const;
type Role = (typeof ROLES)[number];

const INVITE_TTL_MICROS = 30n * 60n * 1_000_000n;
const SESSION_TTL_MICROS = 15n * 60n * 1_000_000n;
// 8 chars from a 31-symbol alphabet (no I, L, O, 0, 1) ≈ 40 bits. Dashes/spaces ignored.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const BAD_CODE = 'invalid or expired code';

// Private. Clients read it only through the `team` view below,
// so fields like isDuressed are never shipped to the user they describe.
const user = table(
  { name: 'user' },
  {
    identity: t.identity().primaryKey(),
    displayName: t.string(),
    role: t.string(),
    joinedAt: t.timestamp(),
    isDuressed: t.bool(),
  }
);

// Private. One live session per identity; reducers reject callers whose session is missing or expired.
const session = table(
  { name: 'session' },
  {
    identity: t.identity().primaryKey(),
    startedAt: t.timestamp(),
    expiresAt: t.timestamp(),
  }
);

// Private. Only SHA-256(code) is stored; the plaintext code is never persisted.
const inviteCode = table(
  { name: 'invite_code' },
  {
    codeHash: t.string().primaryKey(),
    role: t.string(),
    incidentId: t.u64(), // 0 = not bound to an incident yet (incidents arrive in slice 3)
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    expiresAt: t.timestamp(),
    usedBy: t.option(t.identity()),
    usedAt: t.option(t.timestamp()),
  }
);

// Private. The identity that published the module (captured in init). It can mint commander invites.
const owner = table(
  { name: 'owner' },
  {
    id: t.u32().primaryKey(),
    identity: t.identity(),
  }
);

const sessionSweep = table(
  { name: 'session_sweep' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const ping = table(
  { name: 'ping', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    text: t.string(),
    author: t.identity(),
  }
);

const spacetimedb = schema({ user, session, inviteCode, owner, sessionSweep, ping });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function inFuture(ctx: Ctx, micros: bigint) {
  return new Timestamp(ctx.timestamp.microsSinceUnixEpoch + micros);
}

function isExpired(ctx: Ctx, at: Timestamp) {
  return at.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch;
}

function normalizeCode(code: string) {
  const c = code.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== CODE_LENGTH || [...c].some(ch => !CODE_ALPHABET.includes(ch))) return null;
  return c;
}

function startSession(ctx: Ctx) {
  const row = { identity: ctx.sender, startedAt: ctx.timestamp, expiresAt: inFuture(ctx, SESSION_TTL_MICROS) };
  if (ctx.db.session.identity.find(ctx.sender)) ctx.db.session.identity.update(row);
  else ctx.db.session.insert(row);
}

// Throws unless the caller has a user row, a live session, and one of the allowed roles.
// A successful check counts as activity and extends the session.
function requireRole(ctx: Ctx, allowed: readonly Role[]) {
  const me = ctx.db.user.identity.find(ctx.sender);
  if (!me) throw new SenderError('not registered');
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s || isExpired(ctx, s.expiresAt)) throw new SenderError('session expired');
  if (!allowed.includes(me.role as Role)) throw new SenderError(`role ${me.role} not permitted`);
  ctx.db.session.identity.update({ ...s, expiresAt: inFuture(ctx, SESSION_TTL_MICROS) });
  return me;
}

function storeInvite(ctx: Ctx, code: string, role: Role) {
  const normalized = normalizeCode(code);
  if (!normalized) throw new SenderError(`code must be ${CODE_LENGTH} chars from ${CODE_ALPHABET}`);
  const codeHash = sha256Hex(normalized);
  if (ctx.db.inviteCode.codeHash.find(codeHash)) throw new SenderError('code already exists');
  ctx.db.inviteCode.insert({
    codeHash,
    role,
    incidentId: 0n,
    createdBy: ctx.sender,
    createdAt: ctx.timestamp,
    expiresAt: inFuture(ctx, INVITE_TTL_MICROS),
    usedBy: undefined,
    usedAt: undefined,
  });
}

export const init = spacetimedb.init(ctx => {
  ctx.db.owner.insert({ id: 0, identity: ctx.sender });
  ctx.db.sessionSweep.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(60_000_000n) });
});

// Deletes expired sessions so the views stop serving data to them (views cannot read the clock).
export const sweepSessions = spacetimedb.reducer(
  { onSchedule: sessionSweep },
  { timer: sessionSweep.rowType },
  ctx => {
    if (!ctx.sender.isEqual(ctx.databaseIdentity)) throw new SenderError('scheduler only');
    for (const s of [...ctx.db.session.iter()]) {
      if (isExpired(ctx, s.expiresAt)) ctx.db.session.identity.delete(s.identity);
    }
  }
);

const TeamMember = t.row('TeamMember', {
  identity: t.identity().primaryKey(),
  displayName: t.string(),
  role: t.string(),
  joinedAt: t.timestamp(),
  flagged: t.bool(),
});

// Only callers with a session row see the team. The caller's own row always reports flagged=false.
export const team = spacetimedb.view({ name: 'team', public: true }, t.array(TeamMember), ctx => {
  if (!ctx.db.user.identity.find(ctx.sender) || !ctx.db.session.identity.find(ctx.sender)) return [];
  return [...ctx.db.user.iter()].map(u => ({
    identity: u.identity,
    displayName: u.displayName,
    role: u.role,
    joinedAt: u.joinedAt,
    flagged: u.identity.isEqual(ctx.sender) ? false : u.isDuressed,
  }));
});

// Owner-only (run from the CLI). The only way the first commander comes into existence.
export const issueBootstrapInvite = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  const o = ctx.db.owner.id.find(0);
  if (!o || !o.identity.isEqual(ctx.sender)) throw new SenderError('owner only');
  storeInvite(ctx, code, 'commander');
});

export const createInvite = spacetimedb.reducer({ code: t.string(), role: t.string() }, (ctx, { code, role }) => {
  requireRole(ctx, ['commander']);
  if (!ROLES.includes(role as Role)) throw new SenderError('unknown role');
  storeInvite(ctx, code, role as Role);
});

// Binds the caller's identity to the invite's role and starts a 15-minute session.
// Every failure mode returns the same error so the response is not an oracle.
export const redeemInvite = spacetimedb.reducer({ code: t.string(), displayName: t.string() }, (ctx, { code, displayName }) => {
  const name = displayName.trim();
  if (!name || name.length > 40) throw new SenderError('display name must be 1-40 chars');
  const existing = ctx.db.user.identity.find(ctx.sender);
  const live = ctx.db.session.identity.find(ctx.sender);
  if (existing && live && !isExpired(ctx, live.expiresAt)) throw new SenderError('already signed in');

  const normalized = normalizeCode(code);
  if (!normalized) throw new SenderError(BAD_CODE);
  const invite = ctx.db.inviteCode.codeHash.find(sha256Hex(normalized));
  if (!invite || invite.usedBy !== undefined || isExpired(ctx, invite.expiresAt)) throw new SenderError(BAD_CODE);

  ctx.db.inviteCode.codeHash.update({ ...invite, usedBy: ctx.sender, usedAt: ctx.timestamp });
  const row = { identity: ctx.sender, displayName: name, role: invite.role, joinedAt: ctx.timestamp, isDuressed: false };
  if (existing) ctx.db.user.identity.update({ ...existing, displayName: name, role: invite.role });
  else ctx.db.user.insert(row);
  startSession(ctx);
});

// Client calls this on user activity; requireRole does the refresh.
export const touchSession = spacetimedb.reducer(ctx => {
  requireRole(ctx, ROLES);
});

export const setRole = spacetimedb.reducer({ target: t.identity(), role: t.string() }, (ctx, { target, role }) => {
  requireRole(ctx, ['commander']);
  if (!ROLES.includes(role as Role)) throw new SenderError('unknown role');
  if (target.isEqual(ctx.sender)) throw new SenderError('cannot change your own role');
  const row = ctx.db.user.identity.find(target);
  if (!row) throw new SenderError('target not registered');
  ctx.db.user.identity.update({ ...row, role });
});

export const addPing = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  requireRole(ctx, ['commander', 'responder']);
  const trimmed = text.trim();
  if (!trimmed) throw new SenderError('text required');
  if (trimmed.length > 500) throw new SenderError('text too long');
  ctx.db.ping.insert({ id: 0n, text: trimmed, author: ctx.sender });
});
