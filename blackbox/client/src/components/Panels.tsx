import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { tables, reducers } from '../module_bindings';
import type { Incident, TeamMember } from '../module_bindings/types';
import { useRun } from './Toast';
import { generateInviteCode } from '../inviteCode';
import { displayValue, incidentNumber } from '../lib/copy';
import { fmtUtc, shortId, tsToDate } from '../lib/format';
import { enter, exitThen } from '../lib/motion';

// Side panel shell (team / chat). Escape and the scrim close it; focus moves into it on open.
export function Drawer({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const drawer = useRef<HTMLElement>(null), scrim = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    if (!shown) return;
    let cancelled = false;
    exitThen(drawer.current, { x: 25, opacity: 0 }, () => { if (!cancelled) setShown(false); });
    exitThen(scrim.current, { opacity: 0 }, () => {});
    return () => { cancelled = true; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !shown) return;
    const previousFocus = document.activeElement;
    enter(drawer.current, { x: [35, 0], opacity: [0.3, 1] }, { duration: 0.38 });
    enter(scrim.current, { opacity: [0, 1] }, { duration: 0.2 });
    drawer.current?.querySelector<HTMLElement>('textarea:not([disabled]),button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') { e.preventDefault(); close.current(); }
      if (e.key !== 'Tab') return;
      const controls = Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]') ?? [])
        .filter(el => el.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && (document.activeElement === first || !drawer.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !drawer.current?.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, [open, shown]);
  if (!shown) return null;
  return <>
    <div id="scrim" ref={scrim} onClick={onClose} />
    <aside id="drawer" ref={drawer} role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close panel">×</button></div>
      {children}
    </aside>
  </>;
}

const ROLES = ['responder', 'observer', 'commander'] as const;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

// Team, invite codes (createInvite) and access removal (revokeSession). Commander-only controls as before.
export function TeamPanel({ team, me }: { team: readonly TeamMember[]; me: TeamMember }) {
  const createInvite = useReducer(reducers.createInvite), revokeSession = useReducer(reducers.revokeSession), run = useRun(true);
  const [role, setRole] = useState<string>('responder');
  const [issued, setIssued] = useState<{ code: string; role: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const isCommander = me.role === 'commander';
  const issue = async () => { const code = generateInviteCode(); if (await run(() => createInvite({ code, role }))) setIssued({ code, role }); };
  const sorted = [...team].sort((a, b) => Number(a.revoked) - Number(b.revoked) || Number(b.online) - Number(a.online));
  return <>
    <p className="section-note">{team.filter(m => m.online && !m.revoked).length} signed in now · {team.length} on this team</p>
    {sorted.map(m => {
      const hex = m.identity.toHexString(), self = m.identity.isEqual(me.identity);
      return (
        <div className="member" key={hex} title={`Identity ${shortId(hex)}`}>
          <span className={`avatar ${m.revoked ? 'revoked' : m.online ? 'online' : ''}`} aria-hidden>{initials(m.displayName)}</span>
          <div>
            {m.revoked ? <s>{m.displayName}</s> : m.displayName}
            <small>{m.revoked ? 'access removed' : `${displayValue(m.role)} · ${m.online ? 'signed in' : 'not signed in'}${self ? ' · you' : ''}`}</small>
          </div>
          {isCommander && !self && !m.revoked && (confirming === hex
            ? <button className="btn danger" autoFocus onBlur={() => setConfirming(null)} onClick={async () => { await run(() => revokeSession({ target: m.identity })); setConfirming(null); }}>Confirm remove access</button>
            : <button onClick={() => setConfirming(hex)} title="Ends this identity’s session on the server, permanently">Remove access</button>)}
        </div>
      );
    })}
    {isCommander ? (
      <div className="drawer-form">
        <h3>Invite a teammate</h3>
        <p className="section-note">Each code works once and expires after 30 minutes. It is shown only here.</p>
        <select aria-label="Invite role" value={role} onChange={e => setRole(e.target.value)}>
          {ROLES.map(r => <option key={r} value={r}>{displayValue(r)}</option>)}
        </select>
        <button className="btn primary" onClick={issue}>Create {displayValue(role).toLowerCase()} invite code</button>
        {issued && <div className="callout invite-code" data-testid="issued-code-box">
          <span className="mono" data-testid="issued-code">{issued.code}</span>
          <small className="dim">{displayValue(issued.role).toUpperCase()} · SINGLE USE · EXPIRES IN 30 MIN · SHOWN ONCE</small>
          <button className="btn" onClick={() => window.open(`${location.origin}/?invite=${encodeURIComponent(issued.code)}&name=${encodeURIComponent(`Demo ${displayValue(issued.role).toLowerCase()}`)}`, '_blank', 'noopener')}>
            Open sign-in window (demo) ↗
          </button>
        </div>}
      </div>
    ) : <p className="section-note" style={{ marginTop: 22 }}>Only commanders can invite teammates or remove access.</p>}
  </>;
}

// Incident chat (sendMessage). Enter sends, Shift+Enter adds a line. The draft lives in the parent so
// closing the panel does not lose it.
export function ChatPanel({ incident, me, team, draft, setDraft }: { incident: Incident; me: TeamMember; team: readonly TeamMember[]; draft: string; setDraft: (v: string) => void }) {
  const [messages] = useTable(tables.messages.where(r => r.incidentId.eq(incident.id)));
  const send = useReducer(reducers.sendMessage), run = useRun();
  const bottom = useRef<HTMLDivElement>(null);
  const sending = useRef(false), latestDraft = useRef(draft);
  latestDraft.current = draft;
  const [busy, setBusy] = useState(false);
  const rows = [...messages].sort((a, b) => (a.id < b.id ? -1 : 1));
  // Block body on purpose: newer browsers return a Promise from scrollIntoView, and React
  // treats any returned value as a cleanup function ("destroy is not a function").
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [rows.length]);
  const submit = async () => {
    if (!draft.trim() || sending.current) return;
    const text = draft;
    sending.current = true; setBusy(true);
    const ok = await run(() => send({ incidentId: incident.id, text }));
    sending.current = false; setBusy(false);
    if (ok && latestDraft.current === text) setDraft('');
  };
  const observer = me.role === 'observer';
  return <>
    <p className="section-note" style={{ marginBottom: 25 }}>{incidentNumber(incident.id)} · {incident.title}</p>
    {!rows.length && <p className="empty-note">No messages in this incident yet.</p>}
    {rows.map(m => (
      <div className="chat-message" key={m.id.toString()}>
        <h3>{team.find(u => u.identity.isEqual(m.sender))?.displayName ?? m.sender.toHexString().slice(0, 8)}<time>{fmtUtc(tsToDate(m.createdAt)).slice(11)}</time></h3>
        <p>{m.text}</p>
      </div>
    ))}
    <div ref={bottom} />
    <form className="drawer-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <label>Message your team
        <textarea value={draft} onChange={e => setDraft(e.target.value)} disabled={observer} maxLength={4000} required
          placeholder="Enter to send. Shift+Enter for a new line."
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
      </label>
      <button className="btn primary" type="submit" disabled={observer || busy}>{busy ? 'Sending…' : 'Send message ↗'}</button>
      {observer && <p className="section-note">Observer · viewing only</p>}
    </form>
  </>;
}
