import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { BUILTIN_THEMES } from '@/shared/constants';
import type { ThemeManifest } from '@/shared/types';
import {
  applyUserThemeStyle,
  getUserThemeStyleState,
  subscribeToUserThemeStyle,
} from '@/shared/userThemeStyles';
import {
  getUserThemesState,
  isUserThemeId,
  refreshUserThemes,
  subscribeToUserThemes,
} from '@/shared/userThemes';
import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';
import { applyThemeChrome } from '@/shared/utils';

/**
 * Why the overlay the user picked is not the one in force.
 *
 * `missing` is a finding: nothing on this device declares that id, either
 * because the bundle does not ship it or because the server's listing does not
 * offer it. `loadFailed` is the other kind of failure: the id is backed by a
 * file that could not be read, or the listing that would have confirmed it
 * could not be read either. The two read differently to a user, and only the
 * first is a statement about the theme being installed.
 */
export type ThemeFallback = {
  /** The overlay id that could not be applied. */
  id: string;
  reason: 'missing' | 'loadFailed';
};

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
  /**
   * The overlay themes the server host offers from `~/.cloudcli/themes`. Empty
   * until the listing arrives; a pick can still resolve from a cached
   * stylesheet before then.
   */
  userThemes: ThemeManifest[];
  /** Set when the picked overlay is not in force; null while it is, and while it is still loading. */
  themeFallback: ThemeFallback | null;
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
 * Looks up a built-in overlay by id, or null when the bundle does not ship it.
 * A theme picked on another device arrives through the preference mirror as its
 * id alone, so the theme backing it may simply not be here — that is what
 * returns null, and the caller falls back rather than applying an id no rule
 * declares.
 */
function builtinThemeById(id: string): ThemeManifest | null {
  return BUILTIN_THEMES.find((candidate) => candidate.id === id) ?? null;
}

/**
 * Presents a theme from the host's themes folder as a manifest. `coverage` is
 * deliberately absent: §5.8 records that a file-derived theme declares no
 * reach, so the picker's badge stays off rather than claiming one nobody
 * checked.
 */
function userThemeManifest(id: string, name: string): ThemeManifest {
  return { id, name, source: 'user', appearance: 'system' };
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

  // The two stores the overlay depends on: which themes the host offers, and
  // which one's stylesheet is in the document. Both are module-level, so the
  // provider subscribes rather than owning them — the boot-time restore in
  // `main.tsx` has to be able to write before this component exists.
  const [userThemeState, setUserThemeState] = useState(getUserThemesState);
  const [styleState, setStyleState] = useState(getUserThemeStyleState);

  useEffect(() => subscribeToUserThemes(() => setUserThemeState(getUserThemesState())), []);
  useEffect(() => subscribeToUserThemeStyle(() => setStyleState(getUserThemeStyleState())), []);

  // Re-attempted when the pick changes, not only on mount: the first attempt can
  // land before the client has a session token, and a pick arriving from the
  // preference mirror after sign-in is exactly when the listing is needed.
  useEffect(() => {
    void refreshUserThemes();
  }, [themeId]);

  const userThemes = useMemo(() => {
    const offered = userThemeState.entries.map((entry) =>
      userThemeManifest(entry.id, entry.name));
    // The theme in force is offered even when the listing has not accounted for
    // it: the boot-time cache can put one on screen before the listing exists,
    // and after a listing that failed there is no other record of it. Without
    // this the picker would mark the default while that theme is what the
    // document is actually wearing.
    if (styleState.appliedId && !offered.some((theme) => theme.id === styleState.appliedId)) {
      offered.push(userThemeManifest(styleState.appliedId, styleState.appliedId));
    }
    return offered;
  }, [userThemeState, styleState.appliedId]);

  // The built-in overlay the pick names, if the bundle ships one. User themes
  // are deliberately not looked up here: what puts one in force is its
  // stylesheet, not the listing that mentions it.
  const builtinOverlay = useMemo(
    () => (themeId ? builtinThemeById(themeId) : null),
    [themeId],
  );

  // The listing's entry for the pick, when it has one. This is what the
  // stylesheet is loaded from, so it is deliberately keyed on the *pick* rather
  // than on what is in force: while the file is still loading nothing is in
  // force, and the load has to keep going anyway.
  const pickedEntry = useMemo(
    () => (themeId ? userThemeState.entries.find((entry) => entry.id === themeId) ?? null : null),
    [themeId, userThemeState],
  );

  // A user theme is in force exactly while its stylesheet is in the document.
  // That is also the only evidence the first paint can have — the listing has
  // not answered yet — which is why this reads the stylesheet rather than the
  // listing.
  const userThemeInForce = Boolean(
    themeId && !builtinOverlay && styleState.appliedId === themeId,
  );

  // What the document actually gets. A user theme is only in force once its
  // stylesheet is there: until then the appearance default shows instead of a
  // `data-theme` nothing matches, and when the stylesheet cannot be loaded at
  // all the default is what stays.
  const manifest = useMemo(() => {
    if (builtinOverlay) return builtinOverlay;
    if (themeId && userThemeInForce) return userThemeManifest(themeId, pickedEntry?.name ?? themeId);
    return builtinThemeFor(appearance);
  }, [builtinOverlay, themeId, userThemeInForce, pickedEntry, appearance]);

  const resolvedThemeId = manifest.id;

  // The observable half of a fallback: why the pick the user made is not the
  // theme in force. Nothing is reported while the listing is still on its way —
  // an id can also be unresolved because the answer has not arrived, and a hint
  // the next render retracts is worse than a wait.
  const themeFallback = useMemo<ThemeFallback | null>(() => {
    if (!themeId || builtinOverlay || userThemeInForce) return null;
    // A built-in id the registry does not ship, and the listing could not have
    // been what ruled it out, so it is settled without waiting for anything.
    if (!isUserThemeId(themeId)) return { id: themeId, reason: 'missing' };
    if (styleState.failedId === themeId) return { id: themeId, reason: 'loadFailed' };

    if (userThemeState.status === 'ready') {
      // The listing answered: it either offers the theme, whose stylesheet is
      // still on its way, or it does not, and the pick is missing.
      return pickedEntry ? null : { id: themeId, reason: 'missing' };
    }
    // A failed listing means the file may well exist, but nothing this session
    // can reach it, so the pick is not going to come back either.
    if (userThemeState.status === 'error') return { id: themeId, reason: 'loadFailed' };
    return null;
  }, [themeId, builtinOverlay, userThemeInForce, pickedEntry, styleState.failedId, userThemeState.status]);

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

  // The stylesheet follows the pick. `listingComplete` distinguishes "no such
  // file" from "not answered yet": only a listing that has been read settles it.
  useEffect(() => {
    void applyUserThemeStyle(
      pickedEntry,
      userThemeState.status === 'ready' || userThemeState.status === 'error',
    );
  }, [pickedEntry, userThemeState.status]);

  // Applying the theme to the document and persisting it are deliberately
  // separate. Persisting from here would also fire on mount — before the stored
  // theme had been fetched — writing this device's system default over the
  // theme the user actually chose on another one.
  useEffect(() => {
    // The overlay selector. The appearance defaults declare no overlay of their
    // own, so this is inert until a theme carrying one is picked or loaded; it is
    // still written because it is the contract the overlay rules and the
    // contract tests key on.
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
  }, [appearance, isDarkMode, manifest]);

  // Announcing a fallback is kept apart from applying the theme so it fires on
  // the fallback changing rather than on every repaint of the effect above.
  useEffect(() => {
    if (!themeFallback) return;
    console.warn(
      themeFallback.reason === 'missing'
        ? `Theme "${themeFallback.id}" is not installed on this device; falling back to "${manifest.id}".`
        : `Theme "${themeFallback.id}" could not be loaded; falling back to "${manifest.id}".`,
    );
  }, [themeFallback, manifest.id]);

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
      userThemes,
      themeFallback,
    }),
    [
      theme,
      setTheme,
      isDarkMode,
      toggleDarkMode,
      themeId,
      resolvedThemeId,
      setThemeId,
      userThemes,
      themeFallback,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
