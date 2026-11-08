import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp, type Identity } from 'spacetimedb';
import { sha256Hex, canonicalJson, type Canonical } from './crypto';

const ROLES = ['commander', 'responder', 'observer'] as const;
type Role = (typeof ROLES)[number];

const INVITE_TTL_MICROS = 30n * 60n * 1_000_000n;
const SESSION_TTL_MICROS = 15n * 60n * 1_000_000n;
// 8 chars from a 31-symbol alphabet (no I, L, O, 0, 1) ≈ 40 bits. Dashes/spaces ignored.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const BAD_CODE = 'invalid or expired code';
const GENESIS_HASH = '0'.repeat(64);

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

// Private. An identity listed here can never act or redeem again (stolen-token kill switch).
const revokedIdentity = table(
  { name: 'revoked_identity' },
  {
    identity: t.identity().primaryKey(),
    revokedBy: t.identity(),
    revokedAt: t.timestamp(),
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

// Hash-chained audit log. Private until slice 4 exposes it through a view.
// event_hash = SHA256(canonicalJson(row without eventHash) + prevHash)
const audit = table(
  { name: 'audit' },
  {
    seq: t.u64().primaryKey(),
    incidentId: t.u64(), // 0 = not incident-scoped
    actor: t.string(), // identity hex, or 'NEMOTRON'
    action: t.string(),
    payloadJson: t.string(),
    prevHash: t.string(),
    eventHash: t.string(),
    createdAt: t.timestamp(),
  }
);

// Private. Single row (id 0) holding the chain tip so appends never scan the log.
const chainHead = table(
  { name: 'chain_head' },
  {
    id: t.u32().primaryKey(),
    seq: t.u64(),
    headHash: t.string(),
  }
);

const sessionSweep = table(
  { name: 'session_sweep' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['triage', 'investigating', 'contained', 'eradicated', 'closed'] as const;
const INCIDENT_TYPES = ['ransomware', 'data_breach', 'bec', 'insider', 'ddos', 'unknown'] as const;
const CONTAINMENT = ['none', 'partial', 'contained'] as const;

// Private. Read through the session-gated `incidents` view.
const incident = table(
  { name: 'incident' },
  {
    id: t.u64().primaryKey().autoInc(),
    title: t.string(),
    severity: t.string(),
    status: t.string(),
    incidentType: t.string(),
    detectedAt: t.timestamp(),
    reportedBy: t.identity(),
    containmentStatus: t.string(),
    systemsAffected: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const spacetimedb = schema({ user, session, revokedIdentity, inviteCode, owner, audit, chainHead, sessionSweep, incident });
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

// Appends exactly one chained audit row. Call once per mutating reducer, after its checks pass.
function appendAudit(ctx: Ctx, action: string, payload: Canonical, incidentId = 0n, actor: string = ctx.sender.toHexString()) {
  const head = ctx.db.chainHead.id.find(0);
  const seq = head ? head.seq + 1n : 1n;
  const prevHash = head ? head.headHash : GENESIS_HASH;
  const payloadJson = canonicalJson(payload);
  const createdAt = ctx.timestamp;
  const eventHash = sha256Hex(
    canonicalJson({
      seq,
      incidentId,
      actor,
      action,
      payloadJson,
      prevHash,
      createdAt: createdAt.microsSinceUnixEpoch,
    }) + prevHash
  );
  ctx.db.audit.insert({ seq, incidentId, actor, action, payloadJson, prevHash, eventHash, createdAt });
  const next = { id: 0, seq, headHash: eventHash };
  if (head) ctx.db.chainHead.id.update(next);
  else ctx.db.chainHead.insert(next);
}

function startSession(ctx: Ctx) {
  const row = { identity: ctx.sender, startedAt: ctx.timestamp, expiresAt: inFuture(ctx, SESSION_TTL_MICROS) };
  if (ctx.db.session.identity.find(ctx.sender)) ctx.db.session.identity.update(row);
  else ctx.db.session.insert(row);
}

function isRevoked(ctx: Ctx, who: Identity) {
  return !!ctx.db.revokedIdentity.identity.find(who);
}

// Throws unless the caller is not revoked, has a user row, a live session, and one of the allowed roles.
// A successful check counts as activity and extends the session.
function requireRole(ctx: Ctx, allowed: readonly Role[]) {
  if (isRevoked(ctx, ctx.sender)) throw new SenderError('access revoked');
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
// Housekeeping only: not audited (it would add a row every minute).
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
  online: t.bool(), // has a session row
  revoked: t.bool(),
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
    online: !!ctx.db.session.identity.find(u.identity),
    revoked: !!ctx.db.revokedIdentity.identity.find(u.identity),
  }));
});

// Owner-only (run from the CLI). The only way the first commander comes into existence.
export const issueBootstrapInvite = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  const o = ctx.db.owner.id.find(0);
  if (!o || !o.identity.isEqual(ctx.sender)) throw new SenderError('owner only');
  storeInvite(ctx, code, 'commander');
  appendAudit(ctx, 'invite.bootstrap', { role: 'commander' });
});

export const createInvite = spacetimedb.reducer({ code: t.string(), role: t.string() }, (ctx, { code, role }) => {
  requireRole(ctx, ['commander']);
  if (!ROLES.includes(role as Role)) throw new SenderError('unknown role');
  storeInvite(ctx, code, role as Role);
  appendAudit(ctx, 'invite.create', { role });
});

// Binds the caller's identity to the invite's role and starts a 15-minute session.
// Every failure mode returns the same error so the response is not an oracle.
export const redeemInvite = spacetimedb.reducer({ code: t.string(), displayName: t.string() }, (ctx, { code, displayName }) => {
  const name = displayName.trim();
  if (!name || name.length > 40) throw new SenderError('display name must be 1-40 chars');
  if (isRevoked(ctx, ctx.sender)) throw new SenderError(BAD_CODE);
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
  appendAudit(ctx, 'invite.redeem', { displayName: name, role: invite.role });
});

// Client calls this on user activity; requireRole does the refresh.
// Session keep-alive only: not audited (it would add a row every minute per user).
export const touchSession = spacetimedb.reducer(ctx => {
  requireRole(ctx, ROLES);
});

export const setRole = spacetimedb.reducer({ target: t.identity(), role: t.string() }, (ctx, { target, role }) => {
  requireRole(ctx, ['commander']);
  if (!ROLES.includes(role as Role)) throw new SenderError('unknown role');
  if (target.isEqual(ctx.sender)) throw new SenderError('cannot change your own role');
  if (isRevoked(ctx, target)) throw new SenderError('target is revoked');
  const row = ctx.db.user.identity.find(target);
  if (!row) throw new SenderError('target not registered');
  ctx.db.user.identity.update({ ...row, role });
  appendAudit(ctx, 'user.set_role', { target: target.toHexString(), from: row.role, to: role });
});

// Commander kills a (possibly stolen) identity: its session is deleted immediately and it can
// never act or redeem again. The real person re-enters on a fresh identity with a new invite.
export const revokeSession = spacetimedb.reducer({ target: t.identity() }, (ctx, { target }) => {
  requireRole(ctx, ['commander']);
  if (target.isEqual(ctx.sender)) throw new SenderError('cannot revoke yourself');
  const row = ctx.db.user.identity.find(target);
  if (!row) throw new SenderError('target not registered');
  if (isRevoked(ctx, target)) throw new SenderError('already revoked');
  ctx.db.session.identity.delete(target);
  ctx.db.revokedIdentity.insert({ identity: target, revokedBy: ctx.sender, revokedAt: ctx.timestamp });
  appendAudit(ctx, 'user.revoke', { target: target.toHexString(), displayName: row.displayName, role: row.role });
});

function oneOf<T extends string>(field: string, value: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new SenderError(`${field} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

function cleanText(field: string, value: string, min: number, max: number) {
  const v = value.trim();
  if (v.length < min || v.length > max) throw new SenderError(`${field} must be ${min}-${max} chars`);
  return v;
}

// Only signed-in callers with a live session row see incidents.
export const incidents = spacetimedb.view({ name: 'incidents', public: true }, t.array(incident.rowType), ctx => {
  if (!ctx.db.user.identity.find(ctx.sender) || !ctx.db.session.identity.find(ctx.sender)) return [];
  return [...ctx.db.incident.iter()];
});

export const createIncident = spacetimedb.reducer(
  {
    title: t.string(),
    incidentType: t.string(),
    severity: t.string(),
    detectedAt: t.timestamp(),
    systemsAffected: t.string(),
    containmentStatus: t.string(),
  },
  (ctx, args) => {
    requireRole(ctx, ['commander', 'responder']);
    const title = cleanText('title', args.title, 1, 120);
    const incidentType = oneOf('type', args.incidentType, INCIDENT_TYPES);
    const severity = oneOf('severity', args.severity, SEVERITIES);
    const containmentStatus = oneOf('containment', args.containmentStatus, CONTAINMENT);
    const systemsAffected = cleanText('systems affected', args.systemsAffected, 0, 500);
    if (args.detectedAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch + 60_000_000n) {
      throw new SenderError('detected time cannot be in the future');
    }
    const row = ctx.db.incident.insert({
      id: 0n,
      title,
      severity,
      status: 'triage',
      incidentType,
      detectedAt: args.detectedAt,
      reportedBy: ctx.sender,
      containmentStatus,
      systemsAffected,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
    appendAudit(
      ctx,
      'incident.create',
      { title, incidentType, severity, containmentStatus, systemsAffected, detectedAt: args.detectedAt.microsSinceUnixEpoch },
      row.id
    );
  }
);

// Changes any of severity / status / containment / systems. Audit records old -> new for each changed field.
export const updateIncident = spacetimedb.reducer(
  { incidentId: t.u64(), severity: t.string(), status: t.string(), containmentStatus: t.string(), systemsAffected: t.string() },
  (ctx, args) => {
    requireRole(ctx, ['commander', 'responder']);
    const row = ctx.db.incident.id.find(args.incidentId);
    if (!row) throw new SenderError('incident not found');
    const next = {
      severity: oneOf('severity', args.severity, SEVERITIES),
      status: oneOf('status', args.status, STATUSES),
      containmentStatus: oneOf('containment', args.containmentStatus, CONTAINMENT),
      systemsAffected: cleanText('systems affected', args.systemsAffected, 0, 500),
    };
    const changes: { [k: string]: Canonical } = {};
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      if (row[k] !== next[k]) changes[k] = { from: row[k], to: next[k] };
    }
    if (Object.keys(changes).length === 0) throw new SenderError('no changes');
    ctx.db.incident.id.update({ ...row, ...next, updatedAt: ctx.timestamp });
    appendAudit(ctx, 'incident.update', changes, row.id);
  }
);
