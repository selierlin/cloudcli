import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { BUILTIN_THEMES } from '@/shared/constants';
import type { ThemeManifest } from '@/shared/types';
import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';
import { applyThemeChrome } from '@/shared/utils';

type ThemeContextValue = {
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

/**
 * The built-in theme for an appearance. Its `id` is also the `<html data-theme>` value selecting
 * that theme's overlay, and its optional `themeColor` / `statusBar` override what the browser
 * chrome is painted with. Both appearances are always registered, so a miss means the registry lost
 * an entry and should fail loudly rather than leave the document without a theme id.
 */
function builtinThemeFor(appearance: 'light' | 'dark'): ThemeManifest {
  const manifest = BUILTIN_THEMES.find((candidate) => candidate.appearance === appearance);
  if (!manifest) {
    throw new Error(`No built-in theme registered for the ${appearance} appearance`);
  }
  return manifest;
}

/** Mounted once by App so every module can read and switch the colour theme through useTheme. */
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(() => {
    const localTheme = localStorage.getItem('theme');
    if (localTheme === 'light' || localTheme === 'dark' || localTheme === 'system') {
      return localTheme;
    }
    const syncedTheme = readUserPreference<string | null>('theme', null);
    return syncedTheme === 'light' || syncedTheme === 'dark' ? syncedTheme : 'system';
  });
  // Check for saved theme preference or default to system preference. The
  // stored theme is read synchronously from the preference mirror so the very
  // first paint is already the right colour.
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (theme !== 'system') {
      return theme === 'dark';
    }

    // Check system preference
    if (window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    return false;
  });

  // The theme now lives in auth.db, so a change made on another device (or in
  // another tab) arrives through the preference store rather than a re-render.
  useEffect(() => subscribeToUserPreferences(() => {
    const savedTheme = readUserPreference<string | null>('theme', null);
    if (theme !== 'system' && (savedTheme === 'light' || savedTheme === 'dark')) {
      setThemeState(savedTheme);
      setIsDarkMode(savedTheme === 'dark');
    }
  }), [theme]);

  // Applying the theme to the document and persisting it are deliberately
  // separate. Persisting from here would also fire on mount — before the stored
  // theme had been fetched — writing this device's system default over the
  // theme the user actually chose on another one.
  useEffect(() => {
    const appearance = isDarkMode ? 'dark' : 'light';
    const manifest = builtinThemeFor(appearance);

    // The overlay selector. Today both ids resolve to the base palette, so this
    // is inert until a theme carrying its own overlay is selectable; it lives
    // here because the appearance is what decides which default is current.
    document.documentElement.dataset.theme = manifest.id;

    // Hand the appearance to the UA so the parts we do not paint ourselves —
    // native `select` popups, scroll containers that carry no scrollbar utility,
    // date pickers, the canvas behind the body — follow it instead of the OS
    // preference. Unlike everything else in this effect this is a *deliberate
    // visual change*, not an inert interface: `index.css` grew a block of
    // hand-written `rgb()` compensations imitating exactly this, and re-auditing
    // which of them are still needed is a separate slice.
    document.documentElement.style.colorScheme = appearance;

    document.documentElement.classList.toggle('dark', isDarkMode);

    // The browser chrome sits outside the page, so it cannot read a token either:
    // `applyThemeChrome` resolves the theme's colour through the browser and
    // publishes it, in place of the two hex literals this effect used to carry.
    applyThemeChrome(appearance, manifest);
  }, [isDarkMode]);

  // Listen for system theme changes
  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Only update if user hasn't manually set a preference
      if (theme === 'system') {
        setIsDarkMode(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = useCallback((nextTheme: 'light' | 'dark' | 'system') => {
    localStorage.setItem('theme', nextTheme);
    setThemeState(nextTheme);
    if (nextTheme === 'system') {
      setIsDarkMode(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
      return;
    }
    setIsDarkMode(nextTheme === 'dark');
    writeUserPreference('theme', nextTheme);
  }, []);

  // The only writer: a theme is stored because the user picked it, never
  // because this device happened to start on one.
  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((previous) => {
      const next = !previous;
      const nextTheme = next ? 'dark' : 'light';
      localStorage.setItem('theme', nextTheme);
      setThemeState(nextTheme);
      writeUserPreference('theme', nextTheme);
      return next;
    });
  }, []);

  // A fresh object here would re-render every consumer in the app on any
  // render of this provider, theme change or not.
  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, isDarkMode, toggleDarkMode }),
    [theme, setTheme, isDarkMode, toggleDarkMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
