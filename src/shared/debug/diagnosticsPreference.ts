/**
 * Device-local switch for the on-device diagnostics recorder.
 *
 * The recorder exists because some of this app's defects only show up inside the
 * iOS WebView, where there is no console: sampling the transcript while the
 * reader reproduces the symptom by hand is the only way to see them. It is
 * therefore kept permanently, but off by default and toggled from Settings →
 * Diagnostics, because it is a debugging surface and not a feature.
 *
 * Stored per device rather than per account: the slow WebView is the device's
 * problem, and the reader who turns it on is the one holding that device.
 */

const STORAGE_KEY = 'cloudcli:diagnostics';
const CHANGE_EVENT = 'cloudcli:diagnostics-changed';

/// `readSnapshot` is polled by `useSyncExternalStore` on every render and must
/// return a stable value, so the raw localStorage read is cached until the
/// switch is flipped through this module.
let cached: boolean | null = null;

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private mode or a blocked storage partition: diagnostics off is right.
    return false;
  }
}

export function isDiagnosticsEnabled(): boolean {
  if (cached === null) cached = readStored();
  return cached;
}

export function setDiagnosticsEnabled(enabled: boolean): void {
  cached = enabled;
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory value still applies for this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Lets a mounted reader react to the switch being flipped in Settings. */
export function subscribeDiagnosticsEnabled(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
