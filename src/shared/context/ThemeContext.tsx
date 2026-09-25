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
  /** The overlay theme the user picked, or null to follow the appearance default. */
  themeId: string | null;
  /** The overlay id actually applied to `<html data-theme>`, after any fallback. */
  resolvedThemeId: string;
  /** Picks an overlay theme; null returns to the appearance default. */
  setThemeId: (themeId: string | null) => void;
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

/**
 * Looks up an overlay theme by id, or null when this build does not ship it. A
 * theme picked on another device arrives through the preference mirror as its id
 * alone, so the theme backing it may simply not be installed here — that is what
 * returns null, and the caller falls back rather than applying an id no rule
 * declares.
 */
function builtinThemeById(id: string): ThemeManifest | null {
  return BUILTIN_THEMES.find((candidate) => candidate.id === id) ?? null;
}

/**
 * The theme actually in force: the picked overlay when this device has it and
 * otherwise the built-in theme for the current appearance. Derived on every
 * render so a missing theme falls back identically for the effect and for the
 * value the context publishes.
 */
function resolveTheme(themeId: string | null, appearance: 'light' | 'dark'): ThemeManifest {
  return (themeId ? builtinThemeById(themeId) : null) ?? builtinThemeFor(appearance);
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

  // The picked overlay, read synchronously from the mirror for the same reason as
  // the appearance: so the first paint already selects the right `[data-theme]`.
  const [themeId, setThemeIdState] = useState<string | null>(() =>
    readUserPreference<string | null>('themeId', null));

  const appearance = isDarkMode ? 'dark' : 'light';
  const resolvedThemeId = resolveTheme(themeId, appearance).id;

  // The theme now lives in auth.db, so a change made on another device (or in
  // another tab) arrives through the preference store rather than a re-render.
  useEffect(() => subscribeToUserPreferences(() => {
    const savedTheme = readUserPreference<string | null>('theme', null);
    if (theme !== 'system' && (savedTheme === 'light' || savedTheme === 'dark')) {
      setThemeState(savedTheme);
      setIsDarkMode(savedTheme === 'dark');
    }

    // The overlay follows another device unconditionally: unlike the appearance it
    // has no "system" value, so there is no case where this device's own state is
    // the one that should win.
    setThemeIdState(readUserPreference<string | null>('themeId', null));
  }), [theme]);

  // Applying the theme to the document and persisting it are deliberately
  // separate. Persisting from here would also fire on mount — before the stored
  // theme had been fetched — writing this device's system default over the
  // theme the user actually chose on another one.
  useEffect(() => {
    const manifest = resolveTheme(themeId, appearance);

    // A theme synced from another device may not be installed here. Warn rather
    // than drop it silently: the picker still shows the user's own choice, so the
    // reason it is not in force has to stay findable.
    if (themeId && manifest.id !== themeId) {
      console.warn(
        `Theme "${themeId}" is not installed on this device; falling back to "${manifest.id}".`,
      );
    }

    // The overlay selector. The default themes declare no overlay of their own, so
    // this stays inert until a theme carrying one is picked; it is still written
    // because it is the contract the overlay rules and the contract tests key on.
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
  }, [appearance, isDarkMode, themeId]);

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

  // Picking an overlay is always a deliberate act, so this has no `system` branch
  // to skip persisting: `system` describes the appearance axis, and this key has
  // no counterpart to it. Saving it even while the appearance follows the OS is
  // what makes the pick follow the user to their other devices.
  const setThemeId = useCallback((nextThemeId: string | null) => {
    setThemeIdState(nextThemeId);
    writeUserPreference('themeId', nextThemeId);
  }, []);

  // The only writer of the appearance: it is stored because the user picked it,
  // never because this device happened to start on one.
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
    () => ({
      theme,
      setTheme,
      isDarkMode,
      toggleDarkMode,
      themeId,
      resolvedThemeId,
      setThemeId,
    }),
    [theme, setTheme, isDarkMode, toggleDarkMode, themeId, resolvedThemeId, setThemeId],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
