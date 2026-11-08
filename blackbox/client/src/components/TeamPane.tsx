import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { Ban } from 'lucide-react';
import { reducers } from '../module_bindings';
import type { TeamMember } from '../module_bindings/types';
import { useRun } from './Toast';
import { generateInviteCode } from '../inviteCode';
import { shortId } from '../lib/format';

const ROLES = ['responder', 'observer', 'commander'] as const;

// Right pane until chat lands: who is on the channel, invites, and the stolen-session kill switch.
export function TeamPane({ team, me }: { team: readonly TeamMember[]; me: TeamMember }) {
  const createInvite = useReducer(reducers.createInvite);
  const revokeSession = useReducer(reducers.revokeSession);
  const run = useRun();
  const [role, setRole] = useState<string>('responder');
  const [issued, setIssued] = useState<{ code: string; role: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const isCommander = me.role === 'commander';

  const issue = async () => {
    const code = generateInviteCode();
    if (await run(() => createInvite({ code, role }))) setIssued({ code, role });
  };

  const sorted = [...team].sort((a, b) => Number(a.revoked) - Number(b.revoked) || Number(b.online) - Number(a.online));

  return (
    <section className="flex min-h-0 flex-col border-l border-line bg-bg-1">
      <div className="flex h-10 shrink-0 items-center border-b border-line px-3">
        <span className="label">
          Team <span className="font-mono text-text-2">{team.filter(m => m.online && !m.revoked).length} online</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sorted.map(m => {
          const hex = m.identity.toHexString();
          const self = m.identity.isEqual(me.identity);
          return (
            <div key={hex} className="flex h-8 items-center gap-2 border-b border-line px-3" title={`Identity ${shortId(hex)}`}>
              <span
                className="font-mono text-[12px]"
                style={{ color: m.revoked ? 'var(--color-critical)' : m.online ? 'var(--color-ok)' : 'var(--color-text-2)' }}
                aria-label={m.revoked ? 'revoked' : m.online ? 'online' : 'offline'}
              >
                {m.revoked ? '✕' : m.online ? '●' : '○'}
              </span>
              <span className={`min-w-0 flex-1 truncate ${m.revoked ? 'text-text-2 line-through' : ''}`}>
                {m.displayName}
                {self && <span className="text-text-2"> (you)</span>}
              </span>
              <span className="shrink-0 font-mono text-[11px] uppercase text-text-2">{m.revoked ? 'revoked' : m.role}</span>
              {isCommander && !self && !m.revoked && (
                confirming === hex ? (
                  <button
                    className="btn btn-danger h-6 px-2"
                    onClick={async () => {
                      await run(() => revokeSession({ target: m.identity }));
                      setConfirming(null);
                    }}
                    onBlur={() => setConfirming(null)}
                    autoFocus
                  >
                    Confirm revoke
                  </button>
                ) : (
                  <button className="btn h-6 px-2 text-[12px]" title="Kill this identity's session permanently" onClick={() => setConfirming(hex)}>
                    <Ban size={14} strokeWidth={1.5} /> Revoke
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      {isCommander && (
        <div className="flex shrink-0 flex-col gap-2 border-t border-line p-3">
          <span className="label">Issue invite code</span>
          <div className="seg flex-nowrap" role="group" aria-label="Invite role">
            {ROLES.map(r => (
              <button key={r} type="button" className="flex-1" aria-pressed={r === role} onClick={() => setRole(r)}>
                {r[0].toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
          <button className="btn btn-primary justify-center" onClick={issue}>
            Issue {role} code
          </button>
          {issued && (
            <div className="flex flex-col gap-1 rounded-[4px] border border-line bg-bg-2 p-2">
              <span className="font-mono text-[20px] font-semibold tracking-[0.12em]" data-testid="issued-code">
                {issued.code}
              </span>
              <span className="font-mono text-[11px] uppercase text-text-2">
                {issued.role} · single use · expires 30 min · shown once
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
