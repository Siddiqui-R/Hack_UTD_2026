// The 8 security tests from the brief (max 8 — delete any that get slow or flaky).
// Each `it.todo` is filled in when its slice lands.
import { describe, it, expect } from 'vitest';
import { ConnectionId, TimeDuration } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import spacetimedb, * as mod from '../src/index';

let nextConn = 1n;
const as = (sub: string) =>
  TestAuth.fromJwtPayload(JSON.stringify({ iss: 'blackbox-test', sub }), new ConnectionId(nextConn++));

// Fixed, valid codes (8 chars from the module's alphabet).
const CODES = { cmd: 'CMDA2345', resp: 'RESP2345', obs: 'BSVW2345', extra: 'XTRA2345' };

// Fresh in-memory DB built through the real flow:
// owner publishes (init) → bootstrap commander invite → commander invites the rest.
function setup() {
  const test = createModuleTestHarness(spacetimedb, mod);
  const owner = as('owner');
  const commander = as('cmd');
  const responder = as('resp');
  const observer = as('obs');
  const tx = (auth: TestAuth, fn: (ctx: any) => void) => test.withReducerTx(auth, fn);

  tx(owner, ctx => mod.init(ctx, {}));
  tx(owner, ctx => mod.issueBootstrapInvite(ctx, { code: CODES.cmd }));
  tx(commander, ctx => mod.redeemInvite(ctx, { code: CODES.cmd, displayName: 'cmd' }));
  tx(commander, ctx => mod.createInvite(ctx, { code: CODES.resp, role: 'responder' }));
  tx(commander, ctx => mod.createInvite(ctx, { code: CODES.obs, role: 'observer' }));
  tx(responder, ctx => mod.redeemInvite(ctx, { code: CODES.resp, displayName: 'resp' }));
  tx(observer, ctx => mod.redeemInvite(ctx, { code: CODES.obs, displayName: 'obs' }));

  const id = (auth: TestAuth) => test.viewContext(auth).sender;
  return { test, tx, id, owner, commander, responder, observer };
}

describe('BLACKBOX security', () => {
  it.todo('1. observer cannot read scope_item rows (slice 6)');
  // There is no delete reducer at all, so "close" is the live check.
  it('2. responder cannot close an incident', () => {
    const { test, tx, commander, responder } = setup();
    tx(commander, ctx => mod.createIncident(ctx, {
      title: 'Payroll ransomware', incidentType: 'ransomware', severity: 'high',
      detectedAt: test.clock.now(), systemsAffected: 'fin-db-02', containmentStatus: 'partial',
    }));
    const inc = [...test.db.incident.iter()][0];
    expect(() => tx(responder, ctx => mod.updateIncident(ctx, {
      incidentId: inc.id, severity: inc.severity, status: 'closed',
      containmentStatus: inc.containmentStatus, systemsAffected: inc.systemsAffected,
    }))).toThrow();
    expect(test.db.incident.id.find(inc.id)?.status).toBe('triage');
    expect('deleteIncident' in mod).toBe(false); // if a delete reducer appears, extend this test
  });

  it('3. expired invite code is rejected', () => {
    const { test, tx, id, commander } = setup();
    tx(commander, ctx => mod.createInvite(ctx, { code: CODES.extra, role: 'responder' }));
    test.clock.advance(TimeDuration.fromMillis(31 * 60 * 1000)); // TTL is 30 min
    const late = as('late');
    expect(() => tx(late, ctx => mod.redeemInvite(ctx, { code: CODES.extra, displayName: 'late' })))
      .toThrow('invalid or expired code');
    expect(test.db.user.identity.find(id(late))).toBeNull();
  });

  it('4. invite code cannot be redeemed twice', () => {
    const { test, tx, id, commander } = setup();
    tx(commander, ctx => mod.createInvite(ctx, { code: CODES.extra, role: 'commander' }));
    const first = as('first');
    const second = as('second');
    tx(first, ctx => mod.redeemInvite(ctx, { code: CODES.extra, displayName: 'first' }));
    // Same code, different case and formatting: must still be treated as the same, used code.
    expect(() => tx(second, ctx => mod.redeemInvite(ctx, { code: 'xtra-2345', displayName: 'second' })))
      .toThrow('invalid or expired code');
    expect(test.db.user.identity.find(id(second))).toBeNull();
    expect(test.db.user.identity.find(id(first))?.role).toBe('commander');
  });

  it.todo('5. verifyChain ok on a clean 20-row chain (slice 4)');
  it.todo('6. verifyChain reports the correct brokenAt after a row edit (slice 4)');
  it.todo('7. destructive action with one approver stays pending (slice 10)');

  // 8 (partial until slice 8 adds the NEMOTRON actor): a non-commander cannot grant a role.
  it('8. permission-granting reducer rejects non-commanders', () => {
    const { test, tx, id, responder, observer } = setup();
    const target = id(observer);
    expect(() => tx(responder, ctx => mod.setRole(ctx, { target, role: 'commander' }))).toThrow(/not permitted/);
    expect(() => tx(observer, ctx => mod.createInvite(ctx, { code: CODES.extra, role: 'commander' })))
      .toThrow(/not permitted/);
    expect(test.db.user.identity.find(target)?.role).toBe('observer');
    // TODO(slice 8): repeat as the NEMOTRON actor and expect rejection.
  });
});
