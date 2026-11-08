import type { CSSProperties, ReactNode } from 'react';
import type { Tone } from '../lib/vocab';

export function Chip({ tone, children }: { tone?: Tone; children: ReactNode }) {
  const t = tone ?? { color: 'var(--color-text-1)', glyph: '·' };
  return (
    <span className="chip" style={{ '--c': t.color } as CSSProperties}>
      <span aria-hidden>{t.glyph}</span>
      {children}
    </span>
  );
}
