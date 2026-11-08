// Optional motion layer (motion@14 vanilla API, same as the approved reference). Loaded lazily; if it
// fails or the user prefers reduced motion, every helper is a no-op and the static UI stays complete.
type Animate = typeof import('motion').animate;
type Stagger = typeof import('motion').stagger;

let animate: Animate | undefined;
let stagger: Stagger | undefined;
const preference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
export const reducedMotion = () => !!preference?.matches;

const ready = import('motion').then(m => { animate = m.animate; stagger = m.stagger; }).catch(() => { /* static fallback */ });
export const motionReady = () => ready;

// Finish running animations at once when the user switches to reduced motion.
preference?.addEventListener('change', () => {
  if (!reducedMotion()) return;
  document.getAnimations().forEach(a => { try { a.finish(); } catch { a.cancel(); } });
});

type Keyframes = Record<string, number[] | string[] | number | string>;
type Options = Record<string, unknown> & { staggerBy?: number };
const EASE = [0.22, 1, 0.36, 1] as const;

export function enter(nodes: Element | Element[] | NodeListOf<Element> | null | undefined, keyframes: Keyframes, options: Options = {}) {
  if (!animate || reducedMotion() || !nodes) return;
  const list = nodes instanceof Element ? [nodes] : Array.from(nodes);
  if (!list.length) return;
  const { staggerBy, ...rest } = options;
  return animate(list, keyframes as never, { duration: 0.42, ease: EASE, ...(staggerBy && stagger ? { delay: stagger(staggerBy) } : {}), ...rest } as never);
}

export function drawPaths(nodes: Element[] | NodeListOf<Element>, duration = 1) {
  if (!animate || reducedMotion() || !nodes.length || !stagger) return;
  animate(Array.from(nodes), { pathLength: [0, 1], opacity: [0.1, 1] } as never, { duration, delay: stagger(0.1), ease: 'easeInOut' } as never);
}

export function spring(node: Element | null, keyframes: Keyframes) {
  if (!node) return;
  if (!animate || reducedMotion()) return false;
  animate(node, keyframes as never, { type: 'spring', stiffness: 330, damping: 32 } as never);
  return true;
}

export function exitThen(node: Element | null, keyframes: Keyframes, done: () => void) {
  if (!node || !animate || reducedMotion()) return done();
  animate(node, keyframes as never, { duration: 0.18 } as never).then(done, done);
}
