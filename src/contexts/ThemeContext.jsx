import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const THEME_STORAGE_KEY = 'theme';

const getStoredTheme = () => {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
    return savedTheme;
  }
  // Default to following the system preference
  return 'system';
};

const getSystemPrefersDark = () => {
  if (window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
};

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  // User preference: 'light' | 'dark' | 'system' (default: 'system')
  const [theme, setTheme] = useState(getStoredTheme);
  // Current system preference (kept in sync via matchMedia listener)
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark);

  // Resolved dark state: explicit choice wins; 'system' follows the OS setting
  const isDarkMode = theme === 'dark' || (theme === 'system' && systemPrefersDark);

  // Keep tracking the system preference so 'system' mode reacts to OS changes
  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => setSystemPrefersDark(e.matches);

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Update document class and localStorage when the resolved theme changes
  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    if (isDarkMode) {
      document.documentElement.classList.add('dark');

      // Update iOS status bar style and theme color for dark mode
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'black-translucent');
      }

      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#141414'); // Dark background color (hsl(0 0% 8%))
      }
    } else {
      document.documentElement.classList.remove('dark');

      // Update iOS status bar style and theme color for light mode
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'default');
      }

      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#f6f4ef'); // Light background color (warm cream)
      }
    }
  }, [theme, isDarkMode]);

  const setThemeMode = (mode) => {
    if (mode === 'light' || mode === 'dark' || mode === 'system') {
      setTheme(mode);
    }
  };

  // Flip between light/dark based on the currently resolved state
  const toggleDarkMode = () => {
    setTheme(isDarkMode ? 'light' : 'dark');
  };

  const value = useMemo(
    () => ({
      theme,
      setTheme: setThemeMode,
      isDarkMode,
      toggleDarkMode,
    }),
    [theme, isDarkMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
