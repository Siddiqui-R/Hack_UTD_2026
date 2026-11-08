import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Incident, ScopeItem } from '../module_bindings/types';
import { containmentLabel, displayValue, incidentNumber } from '../lib/copy';
import { typeLabel } from '../lib/vocab';
import { fmtUtc, tsToDate } from '../lib/format';
import { createField, type Field } from '../lib/fieldShader';
import { drawPaths, enter, reducedMotion, spring } from '../lib/motion';

// One WebGL canvas for the page's life: reused across incidents and tab switches instead of
// allocating a new context each time (browsers cap live contexts).
let sharedCanvas: HTMLCanvasElement | undefined, sharedField: Field | undefined;
function field() {
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas');
    sharedCanvas.className = 'response-field';
    sharedCanvas.setAttribute('aria-hidden', 'true');
    sharedField = createField(sharedCanvas);
  }
  return { canvas: sharedCanvas, field: sharedField! };
}

type Node = { name: string; scope?: ScopeItem };
const IMPACT_TONE: Record<string, string> = { encrypted: 'danger', compromised: 'danger', exfiltrated: 'danger', unknown: 'caution', unaffected: 'ok' };

// Systems listed on the incident, plus recorded scope assets not in that list. No relationships between
// them are known, so none are drawn: this is a list of reported systems, not a network map.
function nodesFor(incident: Incident, scope: readonly ScopeItem[]): Node[] {
  const names = incident.systemsAffected.split(',').map(s => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: Node[] = [];
  for (const name of [...names, ...scope.map(s => s.asset)]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, scope: scope.find(s => s.asset.toLowerCase() === key) });
  }
  return out;
}

type Step = { title: string; copy: string; label: string; duration: number };
export type NextStep = { title: string; copy: string };

export function IncidentPicture({ incident, scope, canReadScope, conflicts, evidence, next, onScope }: {
  incident: Incident; scope: readonly ScopeItem[]; canReadScope: boolean; conflicts: number; evidence: number; next: NextStep; onScope: () => void;
}) {
  const nodes = useMemo(() => nodesFor(incident, canReadScope ? scope : []), [incident, scope, canReadScope]);
  const shown = nodes.slice(0, 3), more = nodes.length - shown.length;
  const contained = incident.containmentStatus !== 'none';

  // Playback steps are written from recorded fields only; nothing here claims an event that wasn't recorded.
  const steps: Step[] = useMemo(() => [
    { label: 'Overview', duration: 2200, title: 'See the recorded picture, then choose your next step.',
      copy: nodes.length ? `${nodes.length} system${nodes.length === 1 ? ' is' : 's are'} listed on this incident. Select one to see what is recorded.` : 'No affected systems are recorded yet.' },
    { label: 'Detection', duration: 3200, title: `Detected ${fmtUtc(tsToDate(incident.detectedAt), false)}.`,
      copy: `Severity is ${displayValue(incident.severity).toLowerCase()}. Incident type: ${typeLabel(incident.incidentType)}.` },
    { label: 'Containment', duration: 3400, title: `${containmentLabel(incident.containmentStatus)}.`,
      copy: incident.containmentStatus === 'none' ? 'No containment has been recorded for this incident yet.'
        : incident.containmentStatus === 'partial' ? 'The team recorded partial containment. Check which systems still need action.'
        : 'The team recorded this incident as contained.' },
    { label: 'Reports', duration: 3600,
      title: !canReadScope ? 'Evidence is restricted to commanders and responders.' : conflicts ? 'Two reports disagree.' : 'No conflicting reports recorded.',
      copy: !canReadScope ? 'Your role can see the incident summary only.' : conflicts
        ? `${conflicts} conflicting report pair${conflicts === 1 ? ' is' : 's are'} recorded. Review both before changing the response.`
        : `${evidence} evidence record${evidence === 1 ? '' : 's'} submitted so far.` },
    { label: 'Your decision', duration: 2400, title: next.title, copy: next.copy },
  ], [incident, nodes.length, conflicts, evidence, canReadScope, next]);
  const total = steps.reduce((n, s) => n + s.duration, 0);
  const starts = useMemo(() => steps.map((_, i) => steps.slice(0, i).reduce((n, s) => n + s.duration, 0)), [steps]);
  const phaseAt = useCallback((ms: number) => { let n = 0; while (n < steps.length - 1 && ms >= starts[n + 1]) n++; return n; }, [steps.length, starts]);

  const root = useRef<HTMLElement>(null), scene = useRef<HTMLDivElement>(null), timeEl = useRef<HTMLTimeElement>(null), bar = useRef<HTMLElement>(null);
  const clock = useRef({ elapsed: 0, started: 0, playing: false, raf: 0, pointer: [0.5, 0.5] as [number, number] });
  const [phase, setPhase] = useState(0), [playing, setPlaying] = useState(false), [ended, setEnded] = useState(false);
  const [shaderReady, setShaderReady] = useState(false), [inspect, setInspect] = useState<Node | null>(null);
  const phaseRef = useRef(0);
  // The frame loop calls the latest paint through this ref, so data changes mid-play never paint stale steps.
  const paintRef = useRef<(now?: number) => void>(() => {});
  const tick = useCallback((now: number) => paintRef.current(now), []);

  const paint = useCallback((now = performance.now()) => {
    const c = clock.current;
    if (c.playing) c.elapsed = Math.min(total, now - c.started);
    const p = phaseAt(c.elapsed);
    if (p !== phaseRef.current) { phaseRef.current = p; setPhase(p); }
    if (timeEl.current) timeEl.current.textContent = `${String(Math.floor(c.elapsed / 1000)).padStart(2, '0')} / ${Math.ceil(total / 1000)}s`;
    if (bar.current) bar.current.style.transform = `scaleX(${c.elapsed / total})`;
    const { field: f } = field();
    f.draw({ phase: p, progress: reducedMotion() ? 0.5 : (c.elapsed - starts[p]) / steps[p].duration, time: now / 1000, pointer: c.pointer, contained, conflict: conflicts > 0 });
    if (c.elapsed >= total && c.playing) { c.playing = false; setPlaying(false); setEnded(true); }
    if (c.playing && !reducedMotion()) c.raf = requestAnimationFrame(tick);
  }, [total, phaseAt, starts, steps, contained, conflicts, tick]);
  useEffect(() => { paintRef.current = paint; }, [paint]);

  const pause = useCallback(() => {
    const c = clock.current;
    if (c.playing) c.elapsed = Math.min(total, performance.now() - c.started);
    c.playing = false; cancelAnimationFrame(c.raf); setPlaying(false); paint();
  }, [total, paint]);
  const play = useCallback(() => {
    const c = clock.current;
    if (reducedMotion()) { c.elapsed = starts[(phaseRef.current + 1) % steps.length]; paint(); return; } // one phase per press
    if (c.elapsed >= total) c.elapsed = 0;
    c.playing = true; c.started = performance.now() - c.elapsed; setPlaying(true); setEnded(false);
    cancelAnimationFrame(c.raf); c.raf = requestAnimationFrame(tick);
  }, [starts, steps.length, total, paint, tick]);
  const seek = (n: number) => { pause(); clock.current.elapsed = starts[n]; paint(); };

  // Mount the shared canvas, auto-play once, and stop all work when hidden or unmounted.
  useEffect(() => {
    const { canvas, field: f } = field();
    scene.current?.prepend(canvas);
    setShaderReady(f.available);
    const c = clock.current;
    c.elapsed = 0; phaseRef.current = -1; paint();
    const auto = window.setTimeout(() => { if (!document.hidden && !reducedMotion()) play(); }, 1100);
    const onHidden = () => { if (document.hidden) pause(); };
    const onResize = () => { if (!clock.current.playing) paint(); };
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => { if (preference.matches) pause(); };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('resize', onResize);
    preference.addEventListener('change', onMotion);
    enter(root.current?.querySelectorAll('.system-node') ?? null, { opacity: [0, 1], y: [8, 0] }, { staggerBy: 0.12, duration: 0.6 });
    drawPaths(root.current?.querySelectorAll('.network-link') ?? [], 1.05);
    return () => {
      window.clearTimeout(auto); cancelAnimationFrame(c.raf); c.playing = false;
      document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('resize', onResize);
      preference.removeEventListener('change', onMotion);
      canvas.remove();
    };
  }, [incident.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Repaint (not replay) when the recorded data behind the picture changes.
  useEffect(() => { if (!clock.current.playing) paint(); }, [paint]);
  useEffect(() => {
    enter(root.current?.querySelectorAll('.response-narrative>div,.response-number') ?? null, { opacity: [0.2, 1], y: [7, 0] }, { duration: 0.45 });
    if (phase === 1 || phase === 2) spring(root.current?.querySelector('.system-node') ?? null, { scale: [1, 1.035, 1] });
  }, [phase]);

  const onPointer = (e: React.PointerEvent) => {
    const r = scene.current!.getBoundingClientRect();
    clock.current.pointer = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
    if (!clock.current.playing && !reducedMotion()) paint();
  };
  const open = (n: Node) => { pause(); setInspect(n); };
  const step = steps[Math.max(0, phase)];
  const width = 820, slot = width / Math.max(1, shown.length);

  return (
    <section ref={root} className={`incident-picture ${shaderReady ? 'shader-ready' : ''} ${playing ? 'is-playing' : ''} ${reducedMotion() ? 'reduced-playback' : ''}`} data-phase={phase} aria-label="Incident summary picture">
      <div className="picture-heading">
        <div><span className="eyebrow">WHAT’S HAPPENING</span><span className="playback-label">SUMMARY PLAYBACK</span></div>
        <div className="playback-controls">
          <time ref={timeEl}>00 / {Math.ceil(total / 1000)}s</time>
          <button className="playback-restart" aria-label="Restart playback" onClick={() => { clock.current.elapsed = 0; paint(); play(); }}>↺</button>
          <button aria-pressed={playing} onClick={() => (playing ? pause() : play())}>
            {reducedMotion() ? 'Next step' : playing ? 'Ⅱ Pause' : ended ? '↺ Play again' : '▶ Play summary'}
          </button>
        </div>
      </div>
      <div className="map-body">
        <div className="network-scene" ref={scene} onPointerMove={onPointer}>
          {shown.length ? (
            <svg viewBox={`0 0 ${width} 210`} role="group" aria-label={`Systems listed on ${incidentNumber(incident.id)}`}>
              <defs><pattern id="map-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" style={{ fill: 'var(--lt-34465a, #34465a)' }} /></pattern></defs>
              <rect width={width} height="210" fill="url(#map-grid)" opacity=".45" />
              <path className="network-link review" d={`M40 192 H${width - 40}`} />
              <text className="edge-label" x="40" y="186">LISTED ON THIS INCIDENT · NO NETWORK LINKS RECORDED</text>
              {shown.map((n, i) => {
                const x = i * slot + (slot - 200) / 2, tone = n.scope ? IMPACT_TONE[n.scope.state] ?? '' : 'dim';
                const focus = (phase === 1 || phase === 2) && i === 0;
                return (
                  <g key={n.name} className={`system-node ${inspect?.name === n.name ? 'chosen' : ''} ${focus ? 'phase-focus' : ''}`} tabIndex={0} role="button"
                    aria-label={`View ${n.name}`} onClick={() => open(n)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(n); } }}>
                    <rect x={x} y="48" width="200" height="96" rx="3" />
                    <path className="server-symbol" d={`M${x + 18} ${70}h20v10h-20zm0 16h20v10h-20z`} />
                    <text className="asset-name" x={x + 52} y="84">{n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name}</text>
                    <text className={`asset-state ${tone === 'danger' ? 'danger' : tone === 'caution' ? 'caution' : ''}`} x={x + 18} y="124">
                      {n.scope ? displayValue(n.scope.state).toUpperCase() : canReadScope ? 'IMPACT NOT RECORDED' : 'LISTED'}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="picture-empty"><p>No affected systems are recorded for this incident yet.</p><button className="btn" onClick={onScope}>Record systems &amp; data ↗</button></div>
          )}
          <div className="map-caption">
            <span className="map-coordinate">{incidentNumber(incident.id)} / REPORTED SYSTEMS{more > 0 ? ` · +${more} MORE` : ''}</span>
            <span>From this incident’s recorded fields · not a live network scan</span>
          </div>
        </div>
        {inspect && (
          <div className="map-inspector visible" id="map-inspector">
            <button className="inspector-close" onClick={() => setInspect(null)} aria-label="Close system details">×</button>
            <span className="eyebrow">ABOUT THIS SYSTEM</span>
            <h3>{inspect.name}</h3>
            {inspect.scope ? <>
              <span className="map-inspector-state">{displayValue(inspect.scope.state).toUpperCase()} · {displayValue(inspect.scope.confidence).toUpperCase()}</span>
              <p>{inspect.scope.dataType} · {inspect.scope.records.toLocaleString()} affected records recorded.{inspect.scope.note ? ` ${inspect.scope.note}` : ''}</p>
            </> : <>
              <span className="map-inspector-state">{canReadScope ? 'IMPACT NOT RECORDED' : 'LISTED ON THE INCIDENT'}</span>
              <p>{canReadScope ? 'This system is listed on the incident, but no impact has been recorded for it yet.' : 'Your role can see the systems list but not recorded impact.'}</p>
            </>}
            {canReadScope && <button onClick={onScope}>View systems &amp; data ↗</button>}
          </div>
        )}
      </div>
      <div className="storyboard">
        <div className="story-progress"><i ref={bar} id="response-progress" /></div>
        <div className="response-narrative">
          <span className="response-number">{String(Math.max(0, phase) + 1).padStart(2, '0')}</span>
          <div><h3>{step.title}</h3><p>{step.copy}</p></div>
        </div>
        <div className="response-stages">
          {steps.map((s, n) => (
            <button key={s.label} onClick={() => seek(n)} aria-current={n === phase ? 'step' : 'false'} className={`${n === phase ? 'current' : ''} ${n < phase ? 'done' : ''}`}>
              <i className="phase-dot" />{s.label}<span>0{n + 1}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
