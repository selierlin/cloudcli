import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

/**
 * Whether the Browser Use workspace tab is usable, which is exactly whether the
 * Playwright/Chromium runtime is available. The old on/off toggle is gone: there
 * is nothing else to enable, so availability tracks the runtime install state.
 */
export function useBrowserUseEnabled() {
  const [browserUseEnabled, setBrowserUseEnabled] = useState(false);

  const loadBrowserUseStatus = useCallback(async () => {
    try {
      const response = await api.browserUse.status();
      const data = await response.json();
      setBrowserUseEnabled(Boolean(
        response.ok
        && data?.success !== false
        && data?.data?.available,
      ));
    } catch {
      setBrowserUseEnabled(false);
    }
  }, []);

  useEffect(() => {
    void loadBrowserUseStatus();
    // The runtime can be installed from the settings page or the panel; that is
    // the only way availability changes, so reload when it is reported. If the
    // workspace is already mounted with the tab hidden, this brings the tab in
    // without requiring a remount.
    window.addEventListener('browserRuntimeChanged', loadBrowserUseStatus);
    return () => window.removeEventListener('browserRuntimeChanged', loadBrowserUseStatus);
  }, [loadBrowserUseStatus]);

  return browserUseEnabled;
}
