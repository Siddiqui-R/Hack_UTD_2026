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

const agentIdentity = table({ name: 'agent_identity' }, {
  identity: t.identity().primaryKey(), incidentId: t.u64(), enrolledBy: t.identity(), createdAt: t.timestamp(),
});
const task = table({ name: 'task' }, {
  id: t.u64().primaryKey().autoInc(), incidentId: t.u64().index('btree'), text: t.string(),
  assigneeRole: t.string(), createdBy: t.string(), createdAt: t.timestamp(),
});
const evidence = table({ name: 'evidence' }, {
  id: t.u64().primaryKey().autoInc(), incidentId: t.u64().index('btree'), text: t.string(),
  submittedBy: t.identity(), createdAt: t.timestamp(),
});
const conflict = table({ name: 'conflict' }, {
  id: t.u64().primaryKey().autoInc(), incidentId: t.u64().index('btree'),
  evidenceIdA: t.u64(), evidenceIdB: t.u64(), reason: t.string(), createdBy: t.string(), createdAt: t.timestamp(),
});
const spacetimedb = schema({ user, session, revokedIdentity, inviteCode, owner, audit, chainHead, sessionSweep, incident, agentIdentity, task, evidence, conflict });
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

function discardInvites(ctx: Ctx, creator: Identity) {
  for (const i of [...ctx.db.inviteCode.iter()]) if (i.createdBy.isEqual(creator)) ctx.db.inviteCode.codeHash.delete(i.codeHash);
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
  rejectAgent(ctx);
  if (isRevoked(ctx, ctx.sender)) throw new SenderError('access revoked');
  const me = ctx.db.user.identity.find(ctx.sender);
  if (!me) throw new SenderError('not registered');
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s || isExpired(ctx, s.expiresAt)) throw new SenderError('session expired');
  if (!allowed.includes(me.role as Role)) throw new SenderError(`role ${me.role} not permitted`);
  ctx.db.session.identity.update({ ...s, expiresAt: inFuture(ctx, SESSION_TTL_MICROS) });
  return me;
}

function isOwner(ctx: Ctx) {
  const o = ctx.db.owner.id.find(0);
  return !!o && o.identity.isEqual(ctx.sender);
}

function rejectAgent(ctx: Ctx) {
  if (ctx.db.agentIdentity.identity.find(ctx.sender)) throw new SenderError('NEMOTRON cannot perform human operations');
}

function requireAgent(ctx: Ctx) {
  if (isRevoked(ctx, ctx.sender)) throw new SenderError('access revoked');
  const agent = ctx.db.agentIdentity.identity.find(ctx.sender);
  const active = ctx.db.session.identity.find(ctx.sender);
  if (!agent || !active || isExpired(ctx, active.expiresAt)) throw new SenderError('agent session required');
  if (!ctx.db.incident.id.find(agent.incidentId)) throw new SenderError('incident not found');
  ctx.db.session.identity.update({ ...active, expiresAt: inFuture(ctx, SESSION_TTL_MICROS) });
  return agent;
}

function storeInvite(ctx: Ctx, code: string, role: Role) {
  const normalized = normalizeCode(code);
  if (!normalized) throw new SenderError(`code must be ${CODE_LENGTH} chars from ${CODE_ALPHABET}`);
  if (new Set(normalized).size < 5) throw new SenderError("code too weak; generate one, don't type one");
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
    // Expired invites are deleted so a DB copy has nothing left to crack offline.
    for (const i of [...ctx.db.inviteCode.iter()]) {
      if (isExpired(ctx, i.expiresAt)) ctx.db.inviteCode.codeHash.delete(i.codeHash);
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

// Only callers with a session row see the team. Only commanders see duress flags,
// and the caller's own row always reports flagged=false.
export const team = spacetimedb.view({ name: 'team', public: true }, t.array(TeamMember), ctx => {
  const me = ctx.db.user.identity.find(ctx.sender);
  if (!me || !ctx.db.session.identity.find(ctx.sender)) return [];
  const seesDuress = me.role === 'commander';
  return [...ctx.db.user.iter()].map(u => ({
    identity: u.identity,
    displayName: u.displayName,
    role: u.role,
    joinedAt: u.joinedAt,
    flagged: seesDuress && !u.identity.isEqual(ctx.sender) ? u.isDuressed : false,
    online: !!ctx.db.session.identity.find(u.identity),
    revoked: !!ctx.db.revokedIdentity.identity.find(u.identity),
  }));
});

// Owner-only (run from the CLI). The only way the first commander comes into existence.
export const issueBootstrapInvite = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  rejectAgent(ctx);
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
  rejectAgent(ctx);
  const name = cleanText('display name', displayName, 1, 40);
  if (isRevoked(ctx, ctx.sender)) throw new SenderError(BAD_CODE);
  const existing = ctx.db.user.identity.find(ctx.sender);
  const live = ctx.db.session.identity.find(ctx.sender);
  if (existing && live && !isExpired(ctx, live.expiresAt)) throw new SenderError('already signed in');

  const normalized = normalizeCode(code);
  if (!normalized) throw new SenderError(BAD_CODE);
  const invite = ctx.db.inviteCode.codeHash.find(sha256Hex(normalized));
  if (!invite || invite.usedBy !== undefined || isExpired(ctx, invite.expiresAt)) throw new SenderError(BAD_CODE);
  // Checked only after the code is valid, so outsiders can't probe which names exist.
  const taken = [...ctx.db.user.iter()].some(
    u => !u.identity.isEqual(ctx.sender) && !isRevoked(ctx, u.identity) && u.displayName.toLowerCase() === name.toLowerCase()
  );
  if (taken) throw new SenderError('display name already in use');

  // Deleted, not marked used: nothing left to crack; the audit row records the redeem.
  ctx.db.inviteCode.codeHash.delete(invite.codeHash);
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
  if (ctx.db.agentIdentity.identity.find(target)) throw new SenderError('cannot grant roles to NEMOTRON');
  if (isRevoked(ctx, target)) throw new SenderError('target is revoked');
  const row = ctx.db.user.identity.find(target);
  if (!row) throw new SenderError('target not registered');
  ctx.db.user.identity.update({ ...row, role });
  // A demoted commander's outstanding invites die with their authority.
  if (row.role === 'commander' && role !== 'commander') {
    for (const i of [...ctx.db.inviteCode.iter()]) if (i.createdBy.isEqual(target)) ctx.db.inviteCode.codeHash.delete(i.codeHash);
  }
  appendAudit(ctx, 'user.set_role', { target: target.toHexString(), from: row.role, to: role });
});

// Commander kills a (possibly stolen) identity: its session is deleted immediately and it can
// never act or redeem again. The real person re-enters on a fresh identity with a new invite.
// Only the owner (out-of-band key) may revoke a commander, so one stolen commander can't lock out the rest.
export const revokeSession = spacetimedb.reducer({ target: t.identity() }, (ctx, { target }) => {
  const byOwner = isOwner(ctx);
  if (byOwner) rejectAgent(ctx);
  else requireRole(ctx, ['commander']);
  if (target.isEqual(ctx.sender)) throw new SenderError('cannot revoke yourself');
  const row = ctx.db.user.identity.find(target);
  const agent = ctx.db.agentIdentity.identity.find(target);
  if (!row && !agent) throw new SenderError('target not registered');
  if (row?.role === 'commander' && !byOwner) throw new SenderError('only the owner can revoke a commander');
  if (isRevoked(ctx, target)) throw new SenderError('already revoked');
  ctx.db.session.identity.delete(target);
  ctx.db.revokedIdentity.insert({ identity: target, revokedBy: ctx.sender, revokedAt: ctx.timestamp });
  discardInvites(ctx, target);
  appendAudit(ctx, 'user.revoke', { target: target.toHexString(), displayName: row?.displayName ?? 'NEMOTRON', role: row?.role ?? 'agent' });
});

// Owner-only undo for a mistaken or malicious revoke.
export const unrevokeSession = spacetimedb.reducer({ target: t.identity() }, (ctx, { target }) => {
  rejectAgent(ctx);
  if (!isOwner(ctx)) throw new SenderError('owner only');
  if (ctx.db.agentIdentity.identity.find(target)) throw new SenderError('agent revocation is permanent');
  if (!ctx.db.revokedIdentity.identity.find(target)) throw new SenderError('not revoked');
  ctx.db.revokedIdentity.identity.delete(target);
  appendAudit(ctx, 'user.unrevoke', { target: target.toHexString() });
});

function oneOf<T extends string>(field: string, value: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new SenderError(`${field} must be one of: ${allowed.join(', ')}`);
  return value as T;
}

// Invisible formatting chars (bidi overrides, zero-width) and control chars other than \t \n \r.
const HIDDEN_CHARS = /\p{Cf}|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

// strict (default) for anything shown as a label or written by the agent: names, titles, tasks, reasons.
// Raw evidence passes strict=false: hidden characters in a phishing email are themselves evidence.
function cleanText(field: string, value: string, min: number, max: number, strict = true) {
  const v = value.normalize('NFC').trim();
  if (strict && HIDDEN_CHARS.test(v)) throw new SenderError(`${field} contains hidden or control characters`);
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
    if (args.detectedAt.microsSinceUnixEpoch < ctx.timestamp.microsSinceUnixEpoch - 365n * 24n * 3600n * 1_000_000n) {
      throw new SenderError('detected time is more than a year ago');
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
  { incidentId: t.u64(), severity: t.string(), status: t.string(), containmentStatus: t.string(), systemsAffected: t.string(), expectedUpdatedAt: t.timestamp() },
  (ctx, args) => {
    requireRole(ctx, ['commander', 'responder']);
    if (args.status === 'closed') throw new SenderError('closing requires two-person approval');
    const row = ctx.db.incident.id.find(args.incidentId);
    if (!row) throw new SenderError('incident not found');
    if (row.status === 'closed') throw new SenderError('reopening requires two-person approval');
    if (row.updatedAt.microsSinceUnixEpoch !== args.expectedUpdatedAt.microsSinceUnixEpoch) throw new SenderError('incident changed; review latest values before saving');
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

// Human commander binds a dedicated service identity to one incident.
export const enrollAgent = spacetimedb.reducer({ target: t.identity(), incidentId: t.u64() }, (ctx, args) => {
  requireRole(ctx, ['commander']);
  if (isRevoked(ctx, args.target)) throw new SenderError('target is revoked');
  if (ctx.db.user.identity.find(args.target) || ctx.db.owner.id.find(0)?.identity.isEqual(args.target)) throw new SenderError('agent requires a separate identity');
  if (!ctx.db.incident.id.find(args.incidentId)) throw new SenderError('incident not found');
  const row = { identity: args.target, incidentId: args.incidentId, enrolledBy: ctx.sender, createdAt: ctx.timestamp };
  if (ctx.db.agentIdentity.identity.find(args.target)) ctx.db.agentIdentity.identity.update(row);
  else ctx.db.agentIdentity.insert(row);
  const active = { identity: args.target, startedAt: ctx.timestamp, expiresAt: inFuture(ctx, SESSION_TTL_MICROS) };
  if (ctx.db.session.identity.find(args.target)) ctx.db.session.identity.update(active);
  else ctx.db.session.insert(active);
  appendAudit(ctx, 'agent.enroll', { target: args.target.toHexString() }, args.incidentId);
});

export const createTask = spacetimedb.reducer({ text: t.string(), assigneeRole: t.string() }, (ctx, args) => {
  const agent = requireAgent(ctx);
  const text = cleanText('task', args.text, 1, 1000);
  const assigneeRole = oneOf('assignee role', args.assigneeRole, ROLES);
  const row = ctx.db.task.insert({ id: 0n, incidentId: agent.incidentId, text, assigneeRole, createdBy: 'NEMOTRON', createdAt: ctx.timestamp });
  appendAudit(ctx, 'task.create', { id: row.id, text, assigneeRole, sender: ctx.sender.toHexString() }, agent.incidentId, 'NEMOTRON');
});

export const updateSeverity = spacetimedb.reducer({ incidentId: t.u64(), severity: t.string(), reason: t.string() }, (ctx, args) => {
  const agent = requireAgent(ctx);
  if (args.incidentId !== agent.incidentId) throw new SenderError('agent incident mismatch');
  const row = ctx.db.incident.id.find(args.incidentId)!;
  const severity = oneOf('severity', args.severity, SEVERITIES);
  const reason = cleanText('reason', args.reason, 1, 2000);
  if (SEVERITIES.indexOf(severity) < SEVERITIES.indexOf(row.severity as typeof severity)) throw new SenderError('agent cannot lower severity; human review required');
  ctx.db.incident.id.update({ ...row, severity, updatedAt: ctx.timestamp });
  appendAudit(ctx, 'incident.severity', { from: row.severity, to: severity, reason, sender: ctx.sender.toHexString() }, row.id, 'NEMOTRON');
});

export const submitEvidence = spacetimedb.reducer({ incidentId: t.u64(), text: t.string() }, (ctx, args) => {
  requireRole(ctx, ['commander', 'responder']);
  if (!ctx.db.incident.id.find(args.incidentId)) throw new SenderError('incident not found');
  const text = cleanText('evidence', args.text, 1, 32000, false);
  const row = ctx.db.evidence.insert({ id: 0n, incidentId: args.incidentId, text, submittedBy: ctx.sender, createdAt: ctx.timestamp });
  appendAudit(ctx, 'evidence.submit', { id: row.id, text }, args.incidentId);
});

export const flagConflict = spacetimedb.reducer({ evidenceIdA: t.u64(), evidenceIdB: t.u64(), reason: t.string() }, (ctx, args) => {
  const agent = requireAgent(ctx);
  const a = ctx.db.evidence.id.find(args.evidenceIdA);
  const b = ctx.db.evidence.id.find(args.evidenceIdB);
  if (!a || !b || a.id === b.id || a.incidentId !== agent.incidentId || b.incidentId !== agent.incidentId) {
    throw new SenderError('two distinct evidence records in the agent incident required');
  }
  const reason = cleanText('reason', args.reason, 1, 2000);
  const row = ctx.db.conflict.insert({ id: 0n, incidentId: agent.incidentId, evidenceIdA: a.id, evidenceIdB: b.id, reason, createdBy: 'NEMOTRON', createdAt: ctx.timestamp });
  appendAudit(ctx, 'conflict.flag', { id: row.id, evidenceIdA: a.id, evidenceIdB: b.id, reason, sender: ctx.sender.toHexString() }, agent.incidentId, 'NEMOTRON');
});

// Read procedures return JSON with decimal-string u64 IDs. They do not mutate session state.
function requireReader(ctx: Ctx) {
  if (isRevoked(ctx, ctx.sender)) throw new SenderError('access revoked');
  const active = ctx.db.session.identity.find(ctx.sender);
  if (!active || isExpired(ctx, active.expiresAt)) throw new SenderError('session expired');
  const agent = ctx.db.agentIdentity.identity.find(ctx.sender);
  const human = ctx.db.user.identity.find(ctx.sender);
  if (!agent && !human) throw new SenderError('not registered');
  return { agent, human };
}
export const searchIncidents = spacetimedb.procedure({ query: t.string() }, t.string(), (ctx, args) => ctx.withTx(tx => {
  const { agent } = requireReader(tx);
  const query = args.query.trim().toLowerCase();
  if (query.length > 200) throw new SenderError('query too long');
  const rows = agent ? [...tx.db.incident.iter()].filter(r => r.id === agent.incidentId) : [...tx.db.incident.iter()];
  return canonicalJson(rows.filter(r => r.title.toLowerCase().includes(query)).slice(0, 50).map(r => ({
    incidentId: r.id, title: r.title, severity: r.severity, status: r.status,
  })));
}));
export const getScope = spacetimedb.procedure({ incidentId: t.u64() }, t.string(), (ctx, args) => ctx.withTx(tx => {
  const { agent, human } = requireReader(tx);
  if (human?.role === 'observer') throw new SenderError('observer cannot read scope');
  if (agent && agent.incidentId !== args.incidentId) throw new SenderError('agent incident mismatch');
  if (!tx.db.incident.id.find(args.incidentId)) throw new SenderError('incident not found');
  return canonicalJson({ incidentId: args.incidentId, available: false, items: [], reason: 'Scope storage arrives in slice 6' });
}));
export const evidenceRecords = spacetimedb.procedure({ incidentId: t.u64() }, t.string(), (ctx, args) => ctx.withTx(tx => {
  const { agent, human } = requireReader(tx);
  if (human?.role === 'observer') throw new SenderError('observer cannot read evidence');
  if (agent && agent.incidentId !== args.incidentId) throw new SenderError('agent incident mismatch');
  return canonicalJson([...tx.db.evidence.incidentId.filter(args.incidentId)].map(r => ({ id: r.id, incidentId: r.incidentId, text: r.text })));
}));
export const tasks = spacetimedb.view({ public: true }, t.array(task.rowType), ctx => {
  const allowed = !!ctx.db.user.identity.find(ctx.sender) && !!ctx.db.session.identity.find(ctx.sender);
  return ctx.from.task.where(row => allowed ? row.id.gt(0n) : row.id.eq(0n));
});

const ChainVerification = t.object('ChainVerification', {
  ok: t.bool(), checked: t.u64(), brokenAt: t.option(t.u64()), reason: t.string(),
});

// Callable from SDK, HTTP and module tests. Read-only; hash formula matches appendAudit exactly.
// This proves internal consistency only. Independent checkpoints are slice 9.
export const verifyChain = spacetimedb.procedure(ChainVerification, ctx => ctx.withTx(tx => {
  requireReader(tx);
  const rows = [...tx.db.audit.iter()].sort((a, b) => a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0);
  let previous = GENESIS_HASH;
  let expected = 1n;
  let checked = 0n;
  const broken = (brokenAt: bigint, reason: string) => ({ ok: false, checked, brokenAt, reason });
  for (const row of rows) {
    if (row.seq !== expected) return broken(expected, 'sequence gap or invalid sequence');
    if (row.prevHash !== previous) return broken(row.seq, 'previous hash mismatch');
    const actual = sha256Hex(canonicalJson({
      seq: row.seq, incidentId: row.incidentId, actor: row.actor, action: row.action,
      payloadJson: row.payloadJson, prevHash: row.prevHash, createdAt: row.createdAt.microsSinceUnixEpoch,
    }) + row.prevHash);
    if (actual !== row.eventHash) return broken(row.seq, 'event hash mismatch');
    previous = row.eventHash;
    expected++;
    checked++;
  }
  const head = tx.db.chainHead.id.find(0);
  if (!head && checked !== 0n) return broken(expected - 1n, 'chain head missing');
  if (head && head.seq !== checked) return broken(head.seq > checked ? expected : head.seq, 'chain head sequence mismatch');
  if (head && head.headHash !== previous) return broken(head.seq, 'chain head hash mismatch');
  return { ok: true, checked, brokenAt: undefined, reason: 'internally consistent; no independent anchor' };
}));
