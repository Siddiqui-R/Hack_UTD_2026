import { useSyncExternalStore } from 'react';

// Dark is the default; light is opt-in and remembered per browser. The choice lives on
// <html data-theme="light"> so styles/light.css applies everywhere, including the login screen.
// index.html applies the saved choice before first paint, under the same key.
export type Theme = 'dark' | 'light';
export const THEME_KEY = 'bb-theme';

const listeners = new Set<() => void>();
const current = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function setTheme(theme: Theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage blocked: still switches for this page */ }
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export const useTheme = () => useSyncExternalStore(subscribe, current);
