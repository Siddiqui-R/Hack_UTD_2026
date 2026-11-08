import { useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import type { Identity } from 'spacetimedb';
import { useRun } from './Toast';
import { Modal } from './Modal';
import { fmtUtc, tsToDate } from '../lib/format';

export function useClosure(incident: Incident, team: readonly TeamMember[]) {
  const [requests] = useTable(tables.closureRequests.where(r => r.incidentId.eq(incident.id)));
  const [approvals] = useTable(tables.closureApprovals);
  const latest = [...requests].sort((a, b) => (a.id > b.id ? -1 : 1))[0];
  const pending = latest?.status === 'pending';
  const votes = approvals.filter(a => a.requestId === latest?.id);
  // Same rule approveClosure applies at execution: only live, unrevoked commanders/responders count,
  // and the requester counts only while still a live commander. `online` = session row present.
  const live = (who: Identity, roles: readonly string[]) => { const m = team.find(u => u.identity.isEqual(who)); return !!m && m.online && !m.revoked && roles.includes(m.role); };
  const validVotes = votes.filter(a => live(a.approver, ['commander', 'responder'])).length;
  const counted = validVotes + (latest && live(latest.requestedBy, ['commander']) ? 1 : 0);
  return { latest, pending, votes, counted, lapsed: votes.length - validVotes };
}

export function ClosurePanel({ incident, me, team }: { incident: Incident; me: TeamMember; team: readonly TeamMember[] }) {
  const request = useReducer(reducers.requestClosure), approve = useReducer(reducers.approveClosure), cancel = useReducer(reducers.cancelClosure), run = useRun(true);
  const [reason, setReason] = useState(''), [open, setOpen] = useState(false);
  const { latest, pending, votes, counted, lapsed } = useClosure(incident, team);
  const already = votes.some(a => a.approver.isEqual(me.identity)), self = latest?.requestedBy.isEqual(me.identity);
  const stale = latest && latest.expectedUpdatedAt.microsSinceUnixEpoch !== incident.updatedAt.microsSinceUnixEpoch;
  const requester = latest && (team.find(u => u.identity.isEqual(latest.requestedBy))?.displayName ?? latest.requestedBy.toHexString().slice(0, 8));

  let body;
  if (incident.status === 'closed') body = <p className="muted">This incident is closed. Two different people approved it.</p>;
  else if (pending) body = <>
    <div className="callout">
      <span className="amber">{counted >= 2 ? 'APPROVALS COMPLETE' : 'WAITING FOR A SECOND APPROVAL'}</span>
      <p style={{ marginTop: 8 }}>{latest.reason}</p>
      <p className="mono dim" style={{ marginTop: 10, fontSize: 11 }}>
        REQUEST #{latest.id.toString()} · {counted}/2 VALID APPROVALS{lapsed ? ` · ${lapsed} LAPSED (SESSION ENDED)` : ''}{counted < 2 ? ` · ${2 - counted} MORE NEEDED` : ''} · EXPIRES {fmtUtc(tsToDate(latest.expiresAt), false)}
      </p>
      <p>{requester} requested closure. Their request counts as the first approval while they are signed in as a commander.</p>
    </div>
    {stale && <p className="form-warning" role="alert">The incident changed after this request. Cancel it and review the current incident before requesting again.</p>}
    <div className="action-row" style={{ marginTop: 14 }}>
      {me.role !== 'observer' && <button className="btn danger" disabled={!!self || already || !!stale} onClick={() => run(() => approve({ requestId: latest.id }))}>
        {self ? 'Your request counts as approval 1' : already ? 'Your approval is recorded' : 'Approve closure · approval 2'}
      </button>}
      {me.role === 'commander' && <button className="btn" onClick={() => run(() => cancel({ requestId: latest.id }))}>Cancel close request</button>}
    </div>
  </>;
  else if (me.role === 'commander') body = <>
    <p className="section-note" style={{ marginBottom: 16 }}>Your request counts as the first approval. One other signed-in commander or responder must approve this exact version of the incident.</p>
    <button className="btn danger" onClick={() => setOpen(true)}>Request to close</button>
  </>;
  else body = <p className="muted">Only a commander can request closure. Incidents can’t be closed directly.</p>;

  return (
    <section className="focused-section narrow-section">
      <span className="eyebrow">TWO-PERSON APPROVAL</span>
      <h2 style={{ margin: '10px 0 22px' }}>Close this incident</h2>
      {body}
      <div className="callout" style={{ marginTop: 28 }}>Requesting closure keeps the incident open until a second eligible teammate approves. The agent cannot request or approve closure.</div>
      <Modal open={open} onClose={() => setOpen(false)} title="Request to close this incident" intro="The incident stays open until a second eligible teammate approves.">
        <form onSubmit={async e => {
          e.preventDefault();
          if (await run(() => request({ incidentId: incident.id, reason, expectedUpdatedAt: incident.updatedAt }))) { setOpen(false); setReason(''); }
        }}>
          <label>Reason for closing<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} required /></label>
          <div className="form-actions"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn danger" type="submit">Send close request</button></div>
        </form>
      </Modal>
    </section>
  );
}
