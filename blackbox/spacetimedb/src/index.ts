import { schema, table, t, SenderError, type InferSchema, type ReducerCtx, type ProcedureCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp, TimeDuration, type Identity } from 'spacetimedb';
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
const SCOPE_STATES = ['unknown', 'compromised', 'encrypted', 'exfiltrated', 'unaffected'] as const;

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
const anchorJob = table({ name: 'anchor_job' }, {
  scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(),
});
const anchor = table({ name: 'anchor' }, {
  id: t.u32().primaryKey(), seq: t.u64(), headHash: t.string(), externalRef: t.string(),
  anchoredAt: t.timestamp(), status: t.string(),
});
const agentRun = table({ name: 'agent_run' }, {
  id: t.u64().primaryKey().autoInc(), incidentId: t.u64().index('btree'), requestedBy: t.identity(),
  tier: t.string(), mode: t.string(), modelId: t.string(), status: t.string(), requestedAt: t.timestamp(),
  worker: t.option(t.identity()), startedAt: t.option(t.timestamp()), finishedAt: t.option(t.timestamp()),
  latencyMs: t.u64(), summary: t.string(), previousSummary: t.string(),
});
const agentStep = table({ name: 'agent_step' }, {
  id: t.u64().primaryKey().autoInc(), incidentId: t.u64().index('btree'), runId: t.u64().index('btree'),
  kind: t.string(), name: t.string(), inputJson: t.string(), outputJson: t.string(), createdAt: t.timestamp(),
});
const message = table({ name: 'message' }, {
  id: t.u64().primaryKey().autoInc(), incidentId: t.u64().index('btree'), sender: t.identity(), text: t.string(), createdAt: t.timestamp(),
});
const scopeItem = table({ name: 'scope_item' }, {
  id: t.u64().primaryKey().autoInc(), incidentId: t.u64().index('btree'), asset: t.string(), dataType: t.string(),
  state: t.string(), confidence: t.string(), records: t.u64(), note: t.string(), updatedAt: t.timestamp(),
});
const closureRequest = table({ name: 'closure_request' }, {
  id: t.u64().primaryKey().autoInc(), incidentId: t.u64().index('btree'), requestedBy: t.identity(),
  reason: t.string(), status: t.string(), requestedAt: t.timestamp(), expiresAt: t.timestamp(),
  expectedUpdatedAt: t.timestamp(), completedAt: t.option(t.timestamp()),
});
const closureApproval = table({ name: 'closure_approval' }, {
  id: t.u64().primaryKey().autoInc(), requestId: t.u64().index('btree'), approver: t.identity(), approvedAt: t.timestamp(),
});
const spacetimedb = schema({ user, session, revokedIdentity, inviteCode, owner, audit, chainHead, sessionSweep, incident, agentIdentity, task, evidence, conflict, anchorJob, anchor, agentRun, agentStep, message, scopeItem, closureRequest, closureApproval }, { env: {
  ANCHOR_URL: t.option(t.string()), ANCHOR_WRITE_TOKEN: t.option(t.string()),
  ANCHOR_READ_TOKEN: t.option(t.string()), ANCHOR_GATE_TOKEN: t.option(t.string()), ANCHOR_INDEPENDENT: t.option(t.string()),
} });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type ProcCtx = ProcedureCtx<InferSchema<typeof spacetimedb>>;

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

  // Reauthentication may change an existing commander's role, just like setRole.
  // Their old invitations must not retain authority after that downgrade.
  if (existing?.role === 'commander' && invite.role !== 'commander') discardInvites(ctx, ctx.sender);

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
  // Otherwise a compromised commander can demote a peer, then bypass the
  // owner-only commander revocation check in revokeSession.
  if (row.role === 'commander' && role !== 'commander' && !isOwner(ctx)) throw new SenderError('only the owner can demote a commander');
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
    if (row.severity !== next.severity) requestAnchor(ctx);
  }
);

// Human commander binds a dedicated service identity to one incident.
const AgentStatusRow = t.row('AgentStatusRow', {
  identity: t.identity().primaryKey(),
  incidentId: t.u64(),
  enrolledAt: t.timestamp(),
  sessionActive: t.bool(), // session row present (sweep removes expired ones within 60 s)
  revoked: t.bool(),
});

// Read-only: lets signed-in humans see which service identities are enrolled and whether their
// session is live. Agents get nothing. No write path or restriction changes.
export const agentStatus = spacetimedb.view({ name: 'agent_status', public: true }, t.array(AgentStatusRow), ctx => {
  if (!ctx.db.user.identity.find(ctx.sender) || !ctx.db.session.identity.find(ctx.sender)) return [];
  return [...ctx.db.agentIdentity.iter()].map(a => ({
    identity: a.identity,
    incidentId: a.incidentId,
    enrolledAt: a.createdAt,
    sessionActive: !!ctx.db.session.identity.find(a.identity),
    revoked: !!ctx.db.revokedIdentity.identity.find(a.identity),
  }));
});

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
  requestAnchor(ctx);
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
  return canonicalJson({ incidentId: args.incidentId, available: true, items: [...tx.db.scopeItem.incidentId.filter(args.incidentId)].map(r => ({id:r.id,asset:r.asset,dataType:r.dataType,state:r.state,confidence:r.confidence,records:r.records,note:r.note})) });
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
function checkChain(tx: Ctx) {
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
}
export const verifyChain = spacetimedb.procedure(ChainVerification, ctx => ctx.withTx(tx => {
  requireReader(tx);
  return checkChain(tx);
}));

function requestAnchor(ctx: Ctx) {
  if (ctx.env.ANCHOR_URL) ctx.db.anchorJob.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + 1n) });
}
export const startAnchoring = spacetimedb.reducer(ctx => {
  rejectAgent(ctx);
  if (!isOwner(ctx)) throw new SenderError('owner only');
  if (!ctx.env.ANCHOR_URL || !ctx.env.ANCHOR_WRITE_TOKEN || !ctx.env.ANCHOR_READ_TOKEN) throw new SenderError('anchor environment not configured');
  if ([...ctx.db.anchorJob.iter()].some(j => j.scheduledAt.tag === 'Interval')) throw new SenderError('anchor scheduler already started');
  ctx.db.anchorJob.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(60_000_000n) });
  appendAudit(ctx, 'anchor.start', {});
  requestAnchor(ctx);
});

// Infrastructure checkpoint, intentionally outside the audit chain to avoid recursive anchoring.
export const writeAnchor = spacetimedb.procedure(
  { onSchedule: anchorJob }, { timer: anchorJob.rowType }, t.unit(), ctx => {
    if (!ctx.sender.isEqual(ctx.databaseIdentity)) throw new SenderError('scheduler only');
    const url = ctx.env.ANCHOR_URL;
    const token = ctx.env.ANCHOR_WRITE_TOKEN;
    if (!url || !token) return {};
    const snapshot = ctx.withTx(tx => {
      if (!checkChain(tx).ok) return undefined;
      return tx.db.chainHead.id.find(0);
    });
    if (!snapshot) return {};
    try {
      const response = ctx.http.fetch(`${url.replace(/\/$/, '')}/checkpoint`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(ctx.env.ANCHOR_GATE_TOKEN ? { 'OAI-Sites-Authorization': `Bearer ${ctx.env.ANCHOR_GATE_TOKEN}` } : {}) },
        body: JSON.stringify({ database: ctx.databaseIdentity.toHexString(), seq: snapshot.seq.toString(), headHash: snapshot.headHash }),
        timeout: TimeDuration.fromMillis(4000),
      });
      if (response.status !== 200 && response.status !== 201) return {};
      const result = JSON.parse(response.text());
      if (typeof result.ref !== 'string' || typeof result.at !== 'string') return {};
      ctx.withTx(tx => {
        const row = { id: 0, seq: snapshot.seq, headHash: snapshot.headHash, externalRef: result.ref,
          anchoredAt: new Timestamp(BigInt(result.at)), status: 'stored' };
        const old = tx.db.anchor.id.find(0);
        if (old && old.seq > row.seq) return;
        if (old) tx.db.anchor.id.update(row); else tx.db.anchor.insert(row);
      });
    } catch { console.warn('external checkpoint unavailable'); }
    return {};
  }
);

const AnchorVerification = t.object('AnchorVerification', {
  anchorOk: t.option(t.bool()), status: t.string(), reason: t.string(),
  lastAnchorSeq: t.option(t.u64()), lastAnchorAt: t.option(t.timestamp()), lastAnchorHash: t.string(), externalRef: t.string(),
});
// The module runtime has no global URL (verified: `new URL()` throws ReferenceError there),
// so parse the host by hand. Unparseable URLs return undefined and are treated as local.
function urlHost(url: string): string | undefined {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@\/?#]*@)?(\[[^\]]+\]|[^\/:?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : undefined;
}

// Fetch outside a transaction; return a comparison that the caller must run
// inside the same transaction as its chain verification and snapshot reads.
function loadAnchorComparison(ctx: ProcCtx) {
  const base = { anchorOk: undefined as boolean | undefined, status: 'unconfigured', reason: 'Independent anchoring not configured',
    lastAnchorSeq: undefined as bigint | undefined, lastAnchorAt: undefined as Timestamp | undefined, lastAnchorHash: '', externalRef: '' };
  const url = ctx.env.ANCHOR_URL;
  const token = ctx.env.ANCHOR_READ_TOKEN;
  if (!url || !token) return (_tx: Ctx) => base;
  try {
    const response = ctx.http.fetch(`${url.replace(/\/$/, '')}/checkpoints?database=${ctx.databaseIdentity.toHexString()}`, {
      headers: { authorization: `Bearer ${token}`, ...(ctx.env.ANCHOR_GATE_TOKEN ? { 'OAI-Sites-Authorization': `Bearer ${ctx.env.ANCHOR_GATE_TOKEN}` } : {}) }, timeout: TimeDuration.fromMillis(4000),
    });
    if (response.status !== 200) return (_tx: Ctx) => ({ ...base, status: 'unavailable', reason: 'External checkpoint store unavailable' });
    const records: unknown = JSON.parse(response.text());
    if (!Array.isArray(records) || records.length === 0) return (_tx: Ctx) => ({ ...base, status: 'pending', reason: 'No external checkpoint yet' });
    const checkpoints = records.map((r: { seq: string; headHash: string; at: string; ref: string }) => {
      if (!/^\d+$/.test(r.seq) || !/^[0-9a-f]{64}$/.test(r.headHash) || !/^\d+$/.test(r.at) || typeof r.ref !== 'string') throw new Error('invalid checkpoint');
      return { seq: BigInt(r.seq), hash: r.headHash, at: new Timestamp(BigInt(r.at)), ref: r.ref };
    }).sort((a,b) => a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0);
    const latest = checkpoints[checkpoints.length - 1];
    const meta = { lastAnchorSeq: latest.seq, lastAnchorAt: latest.at, lastAnchorHash: latest.hash, externalRef: latest.ref };
    const host = urlHost(url);
    const local = host === undefined || ['localhost','127.0.0.1','[::1]'].includes(host);
    const independent = !local && ctx.env.ANCHOR_INDEPENDENT === '1';
    return (tx: Ctx) => {
      const mismatch = checkpoints.find(c => c.seq === 0n ? c.hash !== GENESIS_HASH : tx.db.audit.seq.find(c.seq)?.eventHash !== c.hash);
      if (mismatch) return { ...base, ...meta, anchorOk: false, status: 'mismatch', reason: `Checkpoint #${mismatch.seq} does not match the database` };
      if (!independent) return { ...base, ...meta, status: 'local', reason: 'Checkpoint matches; deployment is not marked independent' };
      return { ...base, ...meta, anchorOk: true, status: 'verified', reason: 'Matches independent external checkpoints' };
    };
  } catch { return (_tx: Ctx) => ({ ...base, status: 'unavailable', reason: 'External checkpoint could not be checked' }); }
}
const IntegrityVerification = t.object('IntegrityVerification', { chain: ChainVerification, anchor: AnchorVerification });
export const verifyIntegrity = spacetimedb.procedure(IntegrityVerification, ctx => {
  ctx.withTx(tx => { requireReader(tx); });
  const compareAnchor = loadAnchorComparison(ctx);
  // Re-authorize and recheck after network I/O: never return data after a concurrent revoke.
  return ctx.withTx(tx => { requireReader(tx); return { chain: checkChain(tx), anchor: compareAnchor(tx) }; });
});

export const requestAgentRun = spacetimedb.reducer({ incidentId: t.u64(), tier: t.string(), mode: t.string() }, (ctx, args) => {
  requireRole(ctx, ['commander', 'responder']);
  if (!ctx.db.incident.id.find(args.incidentId)) throw new SenderError('incident not found');
  const tier = oneOf('tier', args.tier, ['fast','deep']);
  const mode = oneOf('mode', args.mode, ['mock','replay']); // UI never silently spends live credits.
  if ([...ctx.db.agentRun.incidentId.filter(args.incidentId)].some(r => r.status === 'queued' || r.status === 'running')) throw new SenderError('investigation already queued or running');
  const modelId = tier === 'deep' ? 'nvidia/nemotron-3-ultra-550b-a55b' : 'nvidia/nemotron-3.5-lightning-30b-a3b';
  const row = ctx.db.agentRun.insert({ id: 0n, incidentId: args.incidentId, requestedBy: ctx.sender, tier, mode, modelId,
    status: 'queued', requestedAt: ctx.timestamp, worker: undefined, startedAt: undefined, finishedAt: undefined,
    latencyMs: 0n, summary: '', previousSummary: '' });
  appendAudit(ctx, 'agent.request', { runId: row.id, tier, mode }, args.incidentId);
});
export const nextAgentRun = spacetimedb.procedure(t.string(), ctx => ctx.withTx(tx => {
  const { agent } = requireReader(tx);
  if (!agent) throw new SenderError('agent identity required');
  const row = [...tx.db.agentRun.incidentId.filter(agent.incidentId)].filter(r => r.status === 'queued').sort((a,b) => a.id < b.id ? -1 : 1)[0];
  return canonicalJson(row ? { runId: row.id, incidentId: row.incidentId, tier: row.tier, mode: row.mode, modelId: row.modelId } : null);
}));
// Workers cannot subscribe to human investigation views. Read only their enrolled incident's run status.
export const agentRunStatus = spacetimedb.procedure({ runId: t.u64() }, t.string(), (ctx, { runId }) => ctx.withTx(tx => {
  const { agent } = requireReader(tx);
  if (!agent) throw new SenderError('agent identity required');
  const row = tx.db.agentRun.id.find(runId);
  if (!row || row.incidentId !== agent.incidentId) throw new SenderError('run in enrolled incident required');
  return canonicalJson({ runId: row.id, status: row.status, modelId: row.modelId });
}));
export const beginAgentRun = spacetimedb.reducer({ runId: t.u64(), modelId: t.string() }, (ctx, args) => {
  const agent = requireAgent(ctx);
  const row = ctx.db.agentRun.id.find(args.runId);
  if (!row || row.incidentId !== agent.incidentId || row.status !== 'queued') throw new SenderError('queued run in enrolled incident required');
  if ([...ctx.db.agentRun.incidentId.filter(agent.incidentId)].some(r => r.status === 'running')) throw new SenderError('worker already running');
  const modelId = cleanText('model', args.modelId, 1, 160);
  ctx.db.agentRun.id.update({ ...row, modelId, status: 'running', worker: ctx.sender, startedAt: ctx.timestamp });
  appendAudit(ctx, 'agent.begin', { runId: row.id, mode: row.mode, modelId }, row.incidentId, 'NEMOTRON');
});
// Diagnostic trace only: authorization/session checked; no business action or audit row.
export const recordAgentStep = spacetimedb.reducer({ kind: t.string(), name: t.string(), inputJson: t.string(), outputJson: t.string() }, (ctx, args) => {
  const agent = requireAgent(ctx);
  const run = [...ctx.db.agentRun.incidentId.filter(agent.incidentId)].find(r => r.status === 'running' && r.worker?.isEqual(ctx.sender));
  if (!run) throw new SenderError('begin a queued run before recording trace');
  const kind = oneOf('kind', args.kind, ['call','result','revision','error','summary']);
  const name = cleanText('step name', args.name, 1, 160);
  if (args.inputJson.length > 32000 || args.outputJson.length > 32000) throw new SenderError('step exceeds 32000 chars');
  JSON.parse(args.inputJson || 'null'); JSON.parse(args.outputJson || 'null');
  ctx.db.agentStep.insert({ id: 0n, incidentId: agent.incidentId, runId: run.id, kind, name,
    inputJson: args.inputJson || 'null', outputJson: args.outputJson || 'null', createdAt: ctx.timestamp });
});
export const finishAgentRun = spacetimedb.reducer({ runId: t.u64(), summary: t.string(), failed: t.bool() }, (ctx, args) => {
  const agent = requireAgent(ctx);
  const row = ctx.db.agentRun.id.find(args.runId);
  if (!row || row.incidentId !== agent.incidentId || row.status !== 'running' || !row.worker?.isEqual(ctx.sender)) throw new SenderError('own running investigation required');
  const summary = cleanText('summary', args.summary, 1, 16000, false);
  const previous = [...ctx.db.agentRun.incidentId.filter(agent.incidentId)].filter(r => r.id < row.id && r.status === 'completed').sort((a,b) => a.id > b.id ? -1 : 1)[0];
  const latencyMs = row.startedAt ? (ctx.timestamp.microsSinceUnixEpoch - row.startedAt.microsSinceUnixEpoch) / 1000n : 0n;
  ctx.db.agentRun.id.update({ ...row, summary, previousSummary: previous?.summary ?? '', latencyMs, finishedAt: ctx.timestamp, status: args.failed ? 'failed' : 'completed' });
  appendAudit(ctx, 'agent.finish', { runId: row.id, failed: args.failed, modelId: row.modelId, latencyMs, summary }, row.incidentId, 'NEMOTRON');
});
export const cancelAgentRun = spacetimedb.reducer({ runId: t.u64() }, (ctx, args) => {
  requireRole(ctx, ['commander']);
  const row = ctx.db.agentRun.id.find(args.runId);
  if (!row || !['queued','running'].includes(row.status)) throw new SenderError('active run required');
  ctx.db.agentRun.id.update({ ...row, status: 'cancelled', finishedAt: ctx.timestamp });
  appendAudit(ctx, 'agent.cancel', { runId: row.id }, row.incidentId);
});
export const investigationRuns = spacetimedb.view({ public: true }, t.array(agentRun.rowType), ctx => {
  const me = ctx.db.user.identity.find(ctx.sender);
  const allowed = !!me && me.role !== 'observer' && !!ctx.db.session.identity.find(ctx.sender);
  return ctx.from.agentRun.where(r => allowed ? r.id.gt(0n) : r.id.eq(0n));
});
export const investigationSteps = spacetimedb.view({ public: true }, t.array(agentStep.rowType), ctx => {
  const me = ctx.db.user.identity.find(ctx.sender);
  const allowed = !!me && me.role !== 'observer' && !!ctx.db.session.identity.find(ctx.sender);
  return ctx.from.agentStep.where(r => allowed ? r.id.gt(0n) : r.id.eq(0n));
});
export const investigationEvidence = spacetimedb.view({ public: true }, t.array(evidence.rowType), ctx => {
  const me = ctx.db.user.identity.find(ctx.sender);
  const allowed = !!me && me.role !== 'observer' && !!ctx.db.session.identity.find(ctx.sender);
  return ctx.from.evidence.where(r => allowed ? r.id.gt(0n) : r.id.eq(0n));
});
export const investigationConflicts = spacetimedb.view({ public: true }, t.array(conflict.rowType), ctx => {
  const me = ctx.db.user.identity.find(ctx.sender);
  const allowed = !!me && me.role !== 'observer' && !!ctx.db.session.identity.find(ctx.sender);
  return ctx.from.conflict.where(r => allowed ? r.id.gt(0n) : r.id.eq(0n));
});

export const getRecord = spacetimedb.procedure({ incidentId: t.u64() }, t.string(), (ctx, args) => {
  ctx.withTx(tx => { const { human } = requireReader(tx); if (!human) throw new SenderError('human record reader required'); });
  const compareAnchor = loadAnchorComparison(ctx);
  return ctx.withTx(tx => {
    const { human } = requireReader(tx);
    if (!human) throw new SenderError('human record reader required');
    const row = tx.db.incident.id.find(args.incidentId);
    if (!row) throw new SenderError('incident not found');
    const restricted = human.role === 'observer';
    const chain = checkChain(tx);
    const external = compareAnchor(tx);
    const events = [...tx.db.audit.iter()].filter(e => e.incidentId === row.id).sort((a,b) => a.seq < b.seq ? -1 : 1);
    const head = tx.db.chainHead.id.find(0);
    return canonicalJson({
      schemaVersion: 1, generatedAt: tx.timestamp.microsSinceUnixEpoch,
      incident: { id: row.id, title: row.title, severity: row.severity, status: row.status, type: row.incidentType,
        containment: row.containmentStatus, systemsAffected: row.systemsAffected, detectedAt: row.detectedAt.microsSinceUnixEpoch,
        createdAt: row.createdAt.microsSinceUnixEpoch, updatedAt: row.updatedAt.microsSinceUnixEpoch, reportedBy: row.reportedBy.toHexString() },
      permissions: { canReadEvidence: !restricted, canReadScope: !restricted },
      verification: { ...chain, anchorOk: external.anchorOk, anchorStatus: external.status, anchorReason: external.reason },
      auditHead: { seq: head?.seq ?? 0n, hash: head?.headHash ?? GENESIS_HASH },
      anchoredCheckpoint: external.lastAnchorSeq === undefined ? null : { seq: external.lastAnchorSeq, headHash: external.lastAnchorHash,
        at: external.lastAnchorAt?.microsSinceUnixEpoch, externalRef: external.externalRef, independentlyVerified: external.anchorOk === true },
      audit: events.map(e => ({ seq: e.seq, action: e.action, actor: e.actor, createdAt: e.createdAt.microsSinceUnixEpoch,
        payloadJson: restricted ? '[restricted]' : e.payloadJson, prevHash: e.prevHash, eventHash: e.eventHash })),
      tasks: [...tx.db.task.incidentId.filter(row.id)].map(r => ({ id: r.id, text: r.text, assigneeRole: r.assigneeRole, createdBy: r.createdBy })),
      evidence: restricted ? [] : [...tx.db.evidence.incidentId.filter(row.id)].map(r => ({ id: r.id, text: r.text, submittedBy: r.submittedBy.toHexString(), createdAt: r.createdAt.microsSinceUnixEpoch })),
      conflicts: restricted ? [] : [...tx.db.conflict.incidentId.filter(row.id)].map(r => ({ id: r.id, evidenceIdA: r.evidenceIdA, evidenceIdB: r.evidenceIdB, reason: r.reason })),
      investigations: restricted ? [] : [...tx.db.agentRun.incidentId.filter(row.id)].map(r => ({ id: r.id, modelId: r.modelId, mode: r.mode, status: r.status,
        summary: r.summary, previousSummary: r.previousSummary, latencyMs: r.latencyMs })),
      closures: [...tx.db.closureRequest.incidentId.filter(row.id)].map(r => ({id:r.id,status:r.status,reason:r.reason,
        requestedBy:r.requestedBy.toHexString(),requestedAt:r.requestedAt.microsSinceUnixEpoch,expiresAt:r.expiresAt.microsSinceUnixEpoch,
        approvals:[...tx.db.closureApproval.requestId.filter(r.id)].map(a=>({approver:a.approver.toHexString(),at:a.approvedAt.microsSinceUnixEpoch}))})),
      scope: restricted ? [] : [...tx.db.scopeItem.incidentId.filter(row.id)].map(r => ({ id:r.id,asset:r.asset,dataType:r.dataType,state:r.state,confidence:r.confidence,records:r.records,note:r.note })),
    });
  });
});
export const inspectAuditEvent = spacetimedb.procedure({ seq: t.u64() }, t.string(), (ctx, args) => ctx.withTx(tx => {
  const { human } = requireReader(tx);
  if (!human || human.role === 'observer') throw new SenderError('audit detail restricted');
  const row = tx.db.audit.seq.find(args.seq);
  if (!row) throw new SenderError('audit event not found');
  const recomputedHash = sha256Hex(canonicalJson({ seq: row.seq, incidentId: row.incidentId, actor: row.actor, action: row.action,
    payloadJson: row.payloadJson, prevHash: row.prevHash, createdAt: row.createdAt.microsSinceUnixEpoch }) + row.prevHash);
  return canonicalJson({ ...row, actor: row.actor, createdAt: row.createdAt.microsSinceUnixEpoch, storedHash: row.eventHash, recomputedHash });
}));

export const sendMessage = spacetimedb.reducer({ incidentId: t.u64(), text: t.string() }, (ctx, args) => {
  requireRole(ctx, ['commander','responder']);
  if (!ctx.db.incident.id.find(args.incidentId)) throw new SenderError('incident not found');
  const text=cleanText('message',args.text,1,4000);
  const row=ctx.db.message.insert({id:0n,incidentId:args.incidentId,sender:ctx.sender,text,createdAt:ctx.timestamp});
  appendAudit(ctx,'message.send',{id:row.id,text},args.incidentId);
});
export const messages = spacetimedb.view({public:true},t.array(message.rowType),ctx=>{
  const allowed=!!ctx.db.user.identity.find(ctx.sender)&&!!ctx.db.session.identity.find(ctx.sender);
  return ctx.from.message.where(r=>allowed?r.id.gt(0n):r.id.eq(0n));
});
export const addScopeItem = spacetimedb.reducer({incidentId:t.u64(),asset:t.string(),dataType:t.string(),state:t.string(),confidence:t.string(),records:t.u64(),note:t.string()},(ctx,args)=>{
  requireRole(ctx,['commander','responder']);
  if(!ctx.db.incident.id.find(args.incidentId))throw new SenderError('incident not found');
  const asset=cleanText('asset',args.asset,1,160),dataType=cleanText('data type',args.dataType,1,160);
  const state=oneOf('state',args.state,SCOPE_STATES);
  const confidence=oneOf('confidence',args.confidence,['unconfirmed','likely','confirmed']);
  const note=cleanText('note',args.note,0,2000);
  const row=ctx.db.scopeItem.insert({id:0n,incidentId:args.incidentId,asset,dataType,state,confidence,records:args.records,note,updatedAt:ctx.timestamp});
  appendAudit(ctx,'scope.add',{id:row.id,asset,dataType,state,confidence,records:args.records,note},args.incidentId);
});
export const updateScopeItem = spacetimedb.reducer({scopeId:t.u64(),state:t.string(),confidence:t.string(),records:t.u64(),expectedUpdatedAt:t.timestamp()},(ctx,args)=>{
  requireRole(ctx,['commander','responder']);
  const row=ctx.db.scopeItem.id.find(args.scopeId);
  if(!row)throw new SenderError('scope item not found');
  if(row.updatedAt.microsSinceUnixEpoch!==args.expectedUpdatedAt.microsSinceUnixEpoch)throw new SenderError('scope item changed; review latest values');
  const state=oneOf('state',args.state,SCOPE_STATES);
  const confidence=oneOf('confidence',args.confidence,['unconfirmed','likely','confirmed']);
  ctx.db.scopeItem.id.update({...row,state,confidence,records:args.records,updatedAt:ctx.timestamp});
  appendAudit(ctx,'scope.update',{id:row.id,from:{state:row.state,confidence:row.confidence,records:row.records},to:{state,confidence,records:args.records}},row.incidentId);
});
export const scopeItems = spacetimedb.view({public:true},t.array(scopeItem.rowType),ctx=>{
  const me=ctx.db.user.identity.find(ctx.sender);
  const allowed=!!me&&me.role!=='observer'&&!!ctx.db.session.identity.find(ctx.sender);
  return ctx.from.scopeItem.where(r=>allowed?r.id.gt(0n):r.id.eq(0n));
});

export const requestClosure = spacetimedb.reducer({incidentId:t.u64(),reason:t.string(),expectedUpdatedAt:t.timestamp()},(ctx,args)=>{
  requireRole(ctx,['commander']);
  const row=ctx.db.incident.id.find(args.incidentId);
  if(!row||row.status==='closed')throw new SenderError('open incident required');
  if(row.updatedAt.microsSinceUnixEpoch!==args.expectedUpdatedAt.microsSinceUnixEpoch)throw new SenderError('incident changed; review latest version');
  if([...ctx.db.closureRequest.incidentId.filter(row.id)].some(r=>r.status==='pending'&&!isExpired(ctx,r.expiresAt)))throw new SenderError('closure already pending');
  const reason=cleanText('closure reason',args.reason,1,2000);
  const request=ctx.db.closureRequest.insert({id:0n,incidentId:row.id,requestedBy:ctx.sender,reason,status:'pending',requestedAt:ctx.timestamp,
    expiresAt:inFuture(ctx,30n*60n*1_000_000n),expectedUpdatedAt:row.updatedAt,completedAt:undefined});
  appendAudit(ctx,'closure.request',{requestId:request.id,reason,requiredApprovals:2},row.id);
});
export const approveClosure = spacetimedb.reducer({requestId:t.u64()},(ctx,args)=>{
  requireRole(ctx,['commander','responder']);
  const request=ctx.db.closureRequest.id.find(args.requestId);
  if(!request||request.status!=='pending'||isExpired(ctx,request.expiresAt))throw new SenderError('live pending closure request required');
  if(request.requestedBy.isEqual(ctx.sender))throw new SenderError('requester already counts as the first approval');
  const row=ctx.db.incident.id.find(request.incidentId);
  if(!row||row.status==='closed'||row.updatedAt.microsSinceUnixEpoch!==request.expectedUpdatedAt.microsSinceUnixEpoch)throw new SenderError('incident changed; cancel and request fresh approval');
  const approvals=[...ctx.db.closureApproval.requestId.filter(request.id)];
  if(approvals.some(a=>a.approver.isEqual(ctx.sender)))throw new SenderError('already approved by this identity');
  // Two distinct humans: the requester (a commander, counted by the request itself) plus one other
  // commander/responder. Revoked/expired identities, including the requester, do not count.
  const live=(who:Identity,roles:readonly string[])=>roles.includes(ctx.db.user.identity.find(who)?.role ?? '')&&!isRevoked(ctx,who)&&!!ctx.db.session.identity.find(who)&&!isExpired(ctx,ctx.db.session.identity.find(who)!.expiresAt);
  const valid=approvals.filter(a=>live(a.approver,['commander','responder']));
  const requesterCounts=live(request.requestedBy,['commander']);
  ctx.db.closureApproval.insert({id:0n,requestId:request.id,approver:ctx.sender,approvedAt:ctx.timestamp});
  const total=(requesterCounts?1:0)+valid.length+1;
  const executed=total>=2;
  if(executed){
    ctx.db.incident.id.update({...row,status:'closed',updatedAt:ctx.timestamp});
    ctx.db.closureRequest.id.update({...request,status:'approved',completedAt:ctx.timestamp});
  }
  appendAudit(ctx,'closure.approve',{requestId:request.id,approvals:total,requesterCounted:requesterCounts,executed},row.id);
  requestAnchor(ctx);
});
export const cancelClosure = spacetimedb.reducer({requestId:t.u64()},(ctx,args)=>{
  requireRole(ctx,['commander']);
  const request=ctx.db.closureRequest.id.find(args.requestId);
  if(!request||request.status!=='pending')throw new SenderError('pending request required');
  ctx.db.closureRequest.id.update({...request,status:'cancelled',completedAt:ctx.timestamp});
  appendAudit(ctx,'closure.cancel',{requestId:request.id},request.incidentId);
});
export const closureRequests = spacetimedb.view({public:true},t.array(closureRequest.rowType),ctx=>{
  const allowed=!!ctx.db.user.identity.find(ctx.sender)&&!!ctx.db.session.identity.find(ctx.sender);
  return ctx.from.closureRequest.where(r=>allowed?r.id.gt(0n):r.id.eq(0n));
});
export const closureApprovals = spacetimedb.view({public:true},t.array(closureApproval.rowType),ctx=>{
  const allowed=!!ctx.db.user.identity.find(ctx.sender)&&!!ctx.db.session.identity.find(ctx.sender);
  return ctx.from.closureApproval.where(r=>allowed?r.id.gt(0n):r.id.eq(0n));
});
