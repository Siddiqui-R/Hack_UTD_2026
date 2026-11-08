// Mirrors the enums validated in the module. Labels are what a responder reads.
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const STATUSES = ['triage', 'investigating', 'contained', 'eradicated', 'closed'] as const;
export const CONTAINMENT = ['none', 'partial', 'contained'] as const;
export const INCIDENT_TYPES = [
  ['ransomware', 'Ransomware'],
  ['data_breach', 'Data breach'],
  ['bec', 'Business email compromise'],
  ['insider', 'Insider'],
  ['ddos', 'DDoS'],
  ['unknown', 'Unknown'],
] as const;
export const typeLabel = (v: string) => INCIDENT_TYPES.find(([k]) => k === v)?.[1] ?? v;

export type Tone = { color: string; glyph: string };

// Status colors carry meaning only (DESIGN §3). A glyph and a word always accompany the color (References #1).
export const SEVERITY_TONE: Record<string, Tone> = {
  critical: { color: 'var(--color-critical)', glyph: '▲' },
  high: { color: 'var(--color-high)', glyph: '▲' },
  medium: { color: 'var(--color-medium)', glyph: '◆' },
  low: { color: 'var(--color-low)', glyph: '●' },
};
export const CONTAINMENT_TONE: Record<string, Tone> = {
  none: { color: 'var(--color-critical)', glyph: '○' },
  partial: { color: 'var(--color-medium)', glyph: '◐' },
  contained: { color: 'var(--color-ok)', glyph: '●' },
};
export const STATUS_TONE: Record<string, Tone> = {
  triage: { color: 'var(--color-text-1)', glyph: '·' },
  investigating: { color: 'var(--color-text-1)', glyph: '·' },
  contained: { color: 'var(--color-ok)', glyph: '●' },
  eradicated: { color: 'var(--color-ok)', glyph: '●' },
  closed: { color: 'var(--color-text-2)', glyph: '■' },
};
