import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import type { Incident, TeamMember } from '../module_bindings/types';
import { SEVERITY_TONE } from '../lib/vocab';

function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="font-mono text-[13px] tabular-nums text-text-0">{now.toISOString().slice(11, 19)}Z</span>;
}

const Sep = () => <span className="h-4 w-px bg-line" aria-hidden />;

// DESIGN §5: persistent 44px chrome — wordmark · active incident · chain status · agent · responders · UTC clock.
export function Chrome({ active, me, team, linkUp }: { active?: Incident; me: TeamMember; team: readonly TeamMember[]; linkUp: boolean }) {
  const online = team.filter(m => m.online && !m.revoked).length;
  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-bg-1 px-4">
      <span className="font-mono text-[13px] font-semibold tracking-[0.2em]">BLACKBOX</span>
      <Sep />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {active ? (
          <>
            <span className="font-mono text-[12px]" style={{ color: SEVERITY_TONE[active.severity]?.color }}>
              {SEVERITY_TONE[active.severity]?.glyph}
            </span>
            <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-text-2">INC-{active.id.toString()}</span>
            <span className="truncate text-[13px] text-text-0">{active.title}</span>
          </>
        ) : (
          <span className="text-[13px] text-text-2">No incident selected</span>
        )}
      </div>
      {/* Chain verification lands with verifyChain; until then the bar says so plainly. */}
      <span className="font-mono text-[11px] text-text-2">○ CHAIN VERIFICATION PENDING</span>
      <Sep />
      <span className="font-mono text-[11px] text-text-2">AGENT OFFLINE</span>
      <Sep />
      <span className="flex items-center gap-1 font-mono text-[12px] text-text-1" title="Responders with a live session">
        <Users size={14} strokeWidth={1.5} /> {online}
      </span>
      <Sep />
      <span className="font-mono text-[12px] text-text-1">
        {me.displayName} · <span className="uppercase">{me.role}</span>
      </span>
      <Sep />
      <span className="font-mono text-[11px]" style={{ color: linkUp ? 'var(--color-text-2)' : 'var(--color-critical)' }}>
        {linkUp ? 'LINK UP' : 'LINK DOWN'}
      </span>
      <UtcClock />
    </header>
  );
}
