import { setTheme, useTheme, type Theme } from '../lib/theme';

// Two-option switch so the current theme is always visible, not implied by an icon.
export function ThemeToggle() {
  const theme = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {(['dark', 'light'] as Theme[]).map(t => (
        <button key={t} type="button" className="theme-opt" aria-pressed={theme === t} onClick={() => setTheme(t)}>
          {t === 'dark' ? 'Dark' : 'Light'}
        </button>
      ))}
    </div>
  );
}
