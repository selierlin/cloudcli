import { Preferences } from '@capacitor/preferences';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { CLOUDCLI_SERVERS_KEY } from '@/shared/constants';
import { isCapacitorNativeShell } from '@/shared/utils';

/** Only this module writes the restore target, so the key stays module-local. */
const RESTORE_TARGET_KEY = 'cloudcli.restoreTarget';

/**
 * Persists the current absolute URL to native storage so a cold start can restore
 * the session. Rendered by App inside <Router> (useLocation requires it).
 * No-op outside the native shell, while hidden, or when the current origin is not a saved server.
 */
export function RestoreTargetTracker() {
  const location = useLocation();

  // Re-run on every route change so the persisted target tracks the active session, and on
  // visibility changes so a WebView that becomes visible again re-asserts its own URL.
  useEffect(() => {
    void persistRestoreTarget();
    const onVisibilityChange = () => void persistRestoreTarget();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [location]);

  return null;
}

async function persistRestoreTarget() {
  // Reuse the shared native-shell check rather than inlining a CapacitorWindow cast
  // (src/shared/utils.ts:266) — one implementation, per frontend-module-standards.
  if (!isCapacitorNativeShell()) return;

  // Up to two server WebViews stay alive at once, and a hidden one is only isHidden —
  // its JS keeps running (WebCachePlugin.swift:167,236-238). Without this guard, the
  // background server could overwrite the target while the user is looking at another.
  // Verified on device (V7, 2026-09-24): a hidden sibling WKWebView does report 'hidden',
  // so this guard is the only defence needed — there is no native re-persist on switch
  // or on background (P4 was cancelled on the strength of this result).
  if (document.visibilityState !== 'visible') return;

  const { href, origin } = window.location;
  try {
    const { value } = await Preferences.get({ key: CLOUDCLI_SERVERS_KEY });
    const servers: unknown = value ? JSON.parse(value) : [];
    if (!Array.isArray(servers) || !servers.some((entry) => isSavedOrigin(entry, origin))) return;
    // Store the raw href, not useLocation().pathname: the router pathname strips a
    // deployment basename that the native loader will include, which would restore a 404.
    await Preferences.set({ key: RESTORE_TARGET_KEY, value: JSON.stringify({ url: href }) });
  } catch {
    // Restore is best-effort; a failed write must never affect the running session.
  }
}

function isSavedOrigin(entry: unknown, origin: string): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const url = (entry as { url?: unknown }).url;
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
