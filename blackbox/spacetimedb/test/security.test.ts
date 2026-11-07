// The 8 security tests from the brief (max 8 — delete any that get slow or flaky).
// Each `it.todo` is filled in when its slice lands.
import { describe, it, expect } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import spacetimedb, * as mod from '../src/index';

let nextConn = 1n;
const as = (sub: string) =>
  TestAuth.fromJwtPayload(JSON.stringify({ iss: 'blackbox-test', sub }), new ConnectionId(nextConn++));

// Fresh in-memory DB with one user per role.
function setup() {
  const test = createModuleTestHarness(spacetimedb, mod);
  const users = { commander: as('cmd'), responder: as('resp'), observer: as('obs') };
  for (const [role, auth] of Object.entries(users)) {
    test.db.user.insert({
      identity: test.viewContext(auth).sender,
      displayName: role,
      role,
      joinedAt: test.clock.now(),
      isDuressed: false,
    });
  }
  return { test, ...users };
}

describe('BLACKBOX security', () => {
  it.todo('1. observer cannot read scope_item rows (slice 6)');
  it.todo('2. responder cannot delete or close an incident (slice 3)');
  it.todo('3. expired invite code is rejected (slice 2)');
  it.todo('4. invite code cannot be redeemed twice (slice 2)');
  it.todo('5. verifyChain ok on a clean 20-row chain (slice 4)');
  it.todo('6. verifyChain reports the correct brokenAt after a row edit (slice 4)');
  it.todo('7. destructive action with one approver stays pending (slice 10)');

  // 8 (partial until slice 8 adds the NEMOTRON actor): a non-commander cannot grant a role.
  it('8. permission-granting reducer rejects non-commanders', () => {
    const { test, responder, observer } = setup();
    const target = test.viewContext(observer).sender;
    expect(() =>
      test.withReducerTx(responder, ctx => mod.setRole(ctx, { target, role: 'commander' })),
    ).toThrow(/not permitted/);
    expect(test.db.user.identity.find(target)?.role).toBe('observer');
    // TODO(slice 8): repeat as the NEMOTRON actor and expect rejection.
  });
});
