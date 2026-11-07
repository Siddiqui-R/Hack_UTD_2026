import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';

const ROLES = ['commander', 'responder', 'observer'] as const;
type Role = (typeof ROLES)[number];

// Private. Clients read it only through the `team` / `me` views below,
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

const ping = table(
  { name: 'ping', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    text: t.string(),
    author: t.identity(),
  }
);

const spacetimedb = schema({ user, ping });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

// Throws unless the caller has a user row with one of the allowed roles.
function requireRole(ctx: Ctx, allowed: readonly Role[]) {
  const me = ctx.db.user.identity.find(ctx.sender);
  if (!me) throw new SenderError('not registered');
  if (!allowed.includes(me.role as Role)) throw new SenderError(`role ${me.role} not permitted`);
  return me;
}

const TeamMember = t.row('TeamMember', {
  identity: t.identity().primaryKey(),
  displayName: t.string(),
  role: t.string(),
  joinedAt: t.timestamp(),
  flagged: t.bool(),
});

// Everyone registered sees the team. The caller's own row always reports flagged=false.
export const team = spacetimedb.view({ name: 'team', public: true }, t.array(TeamMember), ctx => {
  if (!ctx.db.user.identity.find(ctx.sender)) return [];
  return [...ctx.db.user.iter()].map(u => ({
    identity: u.identity,
    displayName: u.displayName,
    role: u.role,
    joinedAt: u.joinedAt,
    flagged: u.identity.isEqual(ctx.sender) ? false : u.isDuressed,
  }));
});

// TEMPORARY until slice 2 (invite codes): the first identity to register becomes
// commander, everyone after is an observer until a commander promotes them.
export const register = spacetimedb.reducer({ displayName: t.string() }, (ctx, { displayName }) => {
  const name = displayName.trim();
  if (!name || name.length > 40) throw new SenderError('display name must be 1-40 chars');
  if (ctx.db.user.identity.find(ctx.sender)) throw new SenderError('already registered');
  const isFirst = ctx.db.user.count() === 0n;
  ctx.db.user.insert({
    identity: ctx.sender,
    displayName: name,
    role: isFirst ? 'commander' : 'observer',
    joinedAt: ctx.timestamp,
    isDuressed: false,
  });
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
