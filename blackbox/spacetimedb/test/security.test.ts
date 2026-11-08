// The 8 security tests from the brief (max 8 — delete any that get slow or flaky).
// Each `it.todo` is filled in when its slice lands.
import { describe, it, expect } from 'vitest';
import { ConnectionId, TimeDuration, Timestamp } from 'spacetimedb';
import type { InferSchema } from 'spacetimedb/server';
import { createModuleTestHarness, createProcedureTestHooks, TestAuth } from 'spacetimedb/server/test-utils';
import { sha256Hex, canonicalJson } from '../src/crypto';
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
  // The portable harness has no env_get syscall yet. Supply an explicitly unconfigured anchor
  // environment on test contexts; real configured anchoring is exercised by the live suites.
  const tx = (auth: TestAuth, fn: (ctx: any) => void) => test.withReducerTx(auth, ctx => {
    Object.defineProperty(ctx, 'env', { value: {} });
    return fn(ctx);
  });

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
  it('1. observer cannot read scope through views or procedures', () => {
    const { test, tx, commander, observer } = setup();
    tx(commander, ctx => mod.createIncident(ctx, {
      title: 'Scope privacy', incidentType: 'ransomware', severity: 'high',
      detectedAt: test.clock.now(), systemsAffected: 'DB-1', containmentStatus: 'none',
    }));
    const inc = [...test.db.incident.iter()][0];
    tx(commander, ctx => mod.addScopeItem(ctx, {
      incidentId: inc.id, asset: 'private database', dataType: 'customer records',
      state: 'exfiltrated', confidence: 'confirmed', records: 40000n, note: 'restricted evidence',
    }));
    expect(test.runQuery(mod.scopeItems(test.viewContext(commander)))).toHaveLength(1);
    expect(test.runQuery(mod.scopeItems(test.viewContext(observer)))).toEqual([]);
    expect(() => mod.getScope(test.procedureContext(observer), { incidentId: inc.id })).toThrow('observer cannot read scope');
  });
  // There is no delete reducer at all, so "close" is the live check.
  it('2. responder cannot close an incident', () => {
    const { test, tx, commander, responder } = setup();
    tx(commander, ctx => mod.createIncident(ctx, {
      title: 'Payroll ransomware', incidentType: 'ransomware', severity: 'high',
      detectedAt: test.clock.now(), systemsAffected: 'fin-db-02', containmentStatus: 'partial',
    }));
    const inc = [...test.db.incident.iter()][0];
    expect(() => tx(responder, ctx => mod.updateIncident(ctx, {
      incidentId: inc.id, expectedUpdatedAt: inc.updatedAt, severity: inc.severity, status: 'closed',
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

  it('5. verifyChain ok on a clean 20-row chain', () => {
    const { test, tx, commander } = setup();
    while (test.db.audit.count() < 20n) tx(commander, ctx => mod.createIncident(ctx, {
      title: 'Chain check', incidentType: 'ransomware', severity: 'high',
      detectedAt: test.clock.now(), systemsAffected: 'FS-1', containmentStatus: 'none',
    }));
    expect(mod.verifyChain(test.procedureContext(commander), {})).toEqual({
      ok: true, checked: 20n, brokenAt: undefined, reason: 'internally consistent; no independent anchor',
    });
    expect(test.db.audit.count()).toBe(20n);
  });
  it('6. verifyChain detects edits, gaps, deleted tails and corrupt heads, then recovers after repair', () => {
    const { test, tx, commander } = setup();
    tx(commander, ctx => mod.createIncident(ctx, {
      title: 'Atomic anchored snapshot', incidentType: 'ransomware', severity: 'high',
      detectedAt: test.clock.now(), systemsAffected: 'DB-1', containmentStatus: 'none',
    }));
    const incidentId = [...test.db.incident.iter()][0].id;
    const verify = () => mod.verifyChain(test.procedureContext(commander), {});
    const rows = [...test.db.audit.iter()].sort((a, b) => Number(a.seq - b.seq));
    const row = rows[2];
    tx(commander, ctx => ctx.db.audit.seq.update({ ...row, payloadJson: '{"tampered":true}' }));
    expect(verify()).toMatchObject({ ok: false, checked: row.seq - 1n, brokenAt: row.seq, reason: 'event hash mismatch' });
    tx(commander, ctx => ctx.db.audit.seq.update(row));
    tx(commander, ctx => ctx.db.audit.seq.delete(row.seq));
    expect(verify()).toMatchObject({ ok: false, brokenAt: row.seq, reason: 'sequence gap or invalid sequence' });
    tx(commander, ctx => ctx.db.audit.insert(row));
    const last = rows[rows.length - 1];
    tx(commander, ctx => ctx.db.audit.seq.delete(last.seq));
    expect(verify()).toMatchObject({ ok: false, brokenAt: last.seq, reason: 'chain head sequence mismatch' });
    tx(commander, ctx => ctx.db.audit.insert(last));
    const head = test.db.chainHead.id.find(0)!;
    tx(commander, ctx => ctx.db.chainHead.id.update({ ...head, headHash: '0'.repeat(64) }));
    expect(verify()).toMatchObject({ ok: false, brokenAt: head.seq, reason: 'chain head hash mismatch' });
    tx(commander, ctx => ctx.db.chainHead.id.update(head));
    expect(verify().ok).toBe(true);
    {
      // Probe both transaction boundaries. A rewrite before the final transaction
      // must mismatch; a rewrite after it must not retroactively change its snapshot.
      const context = (rewriteAfter: number) => {
        tx(commander, ctx => {
          for (const original of rows) ctx.db.audit.seq.update(original);
          ctx.db.chainHead.id.update(head);
        });
        let commits = 0;
        const hooks = createProcedureTestHooks<InferSchema<typeof spacetimedb>>().afterTxCommit(() => {
          if (++commits !== rewriteAfter) return;
          tx(commander, ctx => {
            let previous = '0'.repeat(64);
            for (const original of rows) {
              const r = { ...original, payloadJson: '{"rewritten":true}', prevHash: previous };
              const eventHash = sha256Hex(canonicalJson({ seq:r.seq,incidentId:r.incidentId,actor:r.actor,action:r.action,
                payloadJson:r.payloadJson,prevHash:r.prevHash,createdAt:r.createdAt.microsSinceUnixEpoch }) + r.prevHash);
              ctx.db.audit.seq.update({ ...r, eventHash }); previous = eventHash;
            }
            ctx.db.chainHead.id.update({ ...head, headHash: previous });
          });
        });
        const ctx = test.procedureContextBuilder(commander).hooks(hooks).http(() => ({
          code: 200, headers: { entries: [] }, version: { tag:'Http11' },
          body: JSON.stringify([{seq:head.seq.toString(),headHash:head.headHash,at:'0',ref:'test:checkpoint'}]),
        })).build();
        Object.defineProperty(ctx, 'env', { value: { ANCHOR_URL:'https://checkpoint.invalid',ANCHOR_READ_TOKEN:'test',ANCHOR_INDEPENDENT:'1' } });
        return ctx;
      };
      const result = mod.verifyIntegrity(context(1), {});
      expect(result.chain.ok).toBe(true);
      expect(result.anchor.anchorOk).toBe(false);
      // No rewrite at either transaction: retain the positive independent path.
      expect(mod.verifyIntegrity(context(99), {}).anchor.anchorOk).toBe(true);
      for (const boundary of [1, 2]) {
        const snapshot = JSON.parse(mod.getRecord(context(boundary), { incidentId }));
        expect(snapshot.verification.ok).toBe(true);
        // The old implementation returns a rewritten head with stale verified=true
        // at boundary 2. Atomic snapshots return either mismatch or the original head.
        if (snapshot.verification.anchorOk === true) expect(snapshot.auditHead.hash).toBe(head.headHash);
        else expect(snapshot.verification.anchorOk).toBe(false);
      }
    }
  });
  it('7. closure needs two distinct non-requester humans; one approver stays pending', () => {
    const { test, tx, commander, responder, observer } = setup();
    tx(commander, ctx => mod.createIncident(ctx, {
      title: 'Closure review', incidentType: 'ransomware', severity: 'high',
      detectedAt: test.clock.now(), systemsAffected: 'DB-1', containmentStatus: 'none',
    }));
    const inc = [...test.db.incident.iter()][0];
    tx(commander, ctx => mod.requestClosure(ctx, { incidentId: inc.id, reason: 'Contained', expectedUpdatedAt: inc.updatedAt }));
    const request = [...test.db.closureRequest.iter()][0];
    const approve = (auth: TestAuth) => tx(auth, ctx => mod.approveClosure(ctx, { requestId: request.id }));
    expect(() => approve(commander)).toThrow('requester cannot approve');
    expect(() => approve(observer)).toThrow('not permitted');
    approve(responder);
    expect(test.db.closureRequest.id.find(request.id)?.status).toBe('pending');
    expect(test.db.incident.id.find(inc.id)?.status).toBe('triage');
    expect(() => approve(responder)).toThrow('already approved');
    tx(commander, ctx => mod.createInvite(ctx, { code: CODES.extra, role: 'responder' }));
    const reviewer = as('second-reviewer');
    tx(reviewer, ctx => mod.redeemInvite(ctx, { code: CODES.extra, displayName: 'reviewer' }));
    approve(reviewer);
    expect(test.db.closureRequest.id.find(request.id)?.status).toBe('approved');
    expect(test.db.incident.id.find(inc.id)?.status).toBe('closed');
    tx(commander, ctx => mod.createIncident(ctx, {
      title: 'Expired closure request', incidentType: 'ransomware', severity: 'high',
      detectedAt: test.clock.now(), systemsAffected: 'DB-2', containmentStatus: 'none',
    }));
    const fresh = [...test.db.incident.iter()].find(r => r.id !== inc.id)!;
    tx(commander, ctx => mod.requestClosure(ctx, { incidentId:fresh.id, reason:'Expiry check', expectedUpdatedAt:fresh.updatedAt }));
    const late = [...test.db.closureRequest.iter()].find(r => r.id !== request.id)!;
    test.clock.advance(TimeDuration.fromMillis(31 * 60 * 1000));
    // Give the reviewer a live session so this exercises REQUEST expiry, not session expiry.
    const reviewerId = test.viewContext(reviewer).sender;
    tx(reviewer, ctx => {
      const session = ctx.db.session.identity.find(reviewerId);
      ctx.db.session.identity.update({ ...session, expiresAt:new Timestamp(ctx.timestamp.microsSinceUnixEpoch + 60_000_000n) });
    });
    expect(() => tx(reviewer, ctx => mod.approveClosure(ctx, { requestId:late.id }))).toThrow('live pending closure request required');
    expect(test.db.closureRequest.id.find(late.id)?.status).toBe('pending');
  });

  // 8 (partial until slice 8 adds the NEMOTRON actor): a non-commander cannot grant a role.
  it('8. permission-granting reducer rejects non-commanders', () => {
    const { test, tx, id, owner, commander, responder, observer } = setup();
    const target = id(observer);
    expect(() => tx(responder, ctx => mod.setRole(ctx, { target, role: 'commander' }))).toThrow(/not permitted/);
    expect(() => tx(observer, ctx => mod.createInvite(ctx, { code: CODES.extra, role: 'commander' })))
      .toThrow(/not permitted/);
    expect(test.db.user.identity.find(target)?.role).toBe('observer');
    tx(commander, ctx => mod.createIncident(ctx, {
      title: 'Agent permission boundary', incidentType: 'ransomware', severity: 'high',
      detectedAt: test.clock.now(), systemsAffected: 'DB-1', containmentStatus: 'none',
    }));
    const agent = as('agent');
    const agentId = id(agent), incidentId = [...test.db.incident.iter()][0].id;
    tx(commander, ctx => mod.enrollAgent(ctx, { target: agentId, incidentId }));
    const before = test.db.audit.count();
    expect(() => tx(agent, ctx => mod.setRole(ctx, { target, role: 'commander' }))).toThrow('NEMOTRON');
    expect(() => tx(agent, ctx => mod.createInvite(ctx, { code: CODES.extra, role: 'commander' }))).toThrow('NEMOTRON');
    expect(test.db.audit.count()).toBe(before);

    // A peer demotion must not bypass the owner-only commander revoke boundary.
    tx(commander, ctx => mod.setRole(ctx, { target: id(responder), role: 'commander' }));
    const peerAudit = test.db.audit.count();
    expect(() => tx(commander, ctx => mod.setRole(ctx, { target: id(responder), role: 'observer' }))).toThrow('only the owner');
    expect(test.db.user.identity.find(id(responder))?.role).toBe('commander');
    expect(test.db.audit.count()).toBe(peerAudit);

    // The real owner retains this operation after signing in through bootstrap.
    tx(owner, ctx => mod.issueBootstrapInvite(ctx, { code: CODES.extra }));
    tx(owner, ctx => mod.redeemInvite(ctx, { code: CODES.extra, displayName: 'owner' }));
    tx(owner, ctx => mod.setRole(ctx, { target: id(responder), role: 'observer' }));
    expect(test.db.user.identity.find(id(responder))?.role).toBe('observer');
  });
});
