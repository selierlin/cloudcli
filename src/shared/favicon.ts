/**
 * The tab icon is the only attention channel a favicon-only tab has: pinned tabs and
 * narrow tab bars never render the title. This module owns the three marks that can be
 * raised there, their priority, and the clock each one clears on.
 *
 * Priority is `approval > failure > completion`. Only one mark is ever published; a
 * lower one keeps its pending clock and shows again once the higher one is lowered.
 *
 * The mark blinks by swapping `href` between the state render and the appearance
 * render. That is the only animation a favicon reliably gets across browsers — neither
 * animated GIF nor SVG animation is honoured by Chrome's tab strip — and it costs one
 * image swap per phase.
 */

export type TabAttentionState = 'none' | 'completion' | 'failure' | 'approval';

/** Exposed on `<html>` so a republish can tell which mark is currently raised. */
const ATTENTION_ATTRIBUTE = 'data-tab-attention';

const ATTENTION_HREFS = {
  completion: '/icons/favicon-complete-32.png',
  failure: '/icons/favicon-failed-32.png',
  approval: '/icons/favicon-approval-32.png',
} as const satisfies Record<Exclude<TabAttentionState, 'none'>, string>;

/**
 * One phase per state. Completion blinks at 600ms, which reads as "done" without
 * flicker. Approval blinks at half that pace to read as "waiting on you" rather than an
 * alarm. A failure is steady: it is not time-critical, and a second blinking mark would
 * make it indistinguishable from approval at tab size. Every blinking state stays well
 * below the 3 Hz flash threshold.
 */
const BLINK_PHASE_MS = {
  completion: 600,
  failure: 0,
  approval: 1200,
} as const satisfies Record<Exclude<TabAttentionState, 'none'>, number>;

const CLEAR_DELAY_MS = 2000;

type TimedState = 'completion' | 'failure';

let currentState: TabAttentionState = 'none';
let blinkTimer: number | null = null;
let blinkVisible = true;

/** Sticky until the approval list empties; never on a timer. */
let approvalActive = false;

/** Timed marks still waiting out their clear clock, whether or not they are on screen. */
const pendingTimed = new Set<TimedState>();
const clearTimers = new Map<TimedState, number>();

let returnListenersAttached = false;
let pageInactiveListenerAttached = false;

const appearanceHref = (appearance: 'light' | 'dark'): string => `/icons/favicon-${appearance}-32.png`;

const faviconLink = (): HTMLLinkElement | null => (
  typeof document === 'undefined' ? null : document.querySelector('link[rel="icon"]')
);

/** The appearance the page is currently wearing; `.dark` is the runtime truth after mount. */
const currentAppearance = (): 'light' | 'dark' => (
  document.documentElement.classList.contains('dark') ? 'dark' : 'light'
);

/** Repaints the raised mark's current blink phase, or the appearance icon when none is raised. */
const paint = (): void => {
  const href = currentState !== 'none' && blinkVisible
    ? ATTENTION_HREFS[currentState]
    : appearanceHref(currentAppearance());
  faviconLink()?.setAttribute('href', href);
};

/**
 * Publishes the favicon for an appearance, unless a mark is raised — an appearance
 * switch must not erase a raised mark, and must respect the blink's current phase
 * rather than pinning the mark on.
 */
export function applyFavicon(appearance: 'light' | 'dark'): void {
  if (typeof document === 'undefined') {
    return;
  }

  const href = currentState !== 'none' && blinkVisible
    ? ATTENTION_HREFS[currentState]
    : appearanceHref(appearance);
  faviconLink()?.setAttribute('href', href);
}

const restartBlink = (): void => {
  if (blinkTimer !== null) {
    window.clearInterval(blinkTimer);
    blinkTimer = null;
  }

  if (currentState === 'none') {
    return;
  }

  const period = BLINK_PHASE_MS[currentState];
  if (period === 0) {
    return;
  }

  blinkTimer = window.setInterval(() => {
    blinkVisible = !blinkVisible;
    paint();
  }, period);
};

/** Recomputes which mark wins and republishes it. */
const render = (restartPhase: boolean): void => {
  const next: TabAttentionState = approvalActive
    ? 'approval'
    : pendingTimed.has('failure')
      ? 'failure'
      : pendingTimed.has('completion')
        ? 'completion'
        : 'none';

  // A repeat raise restarts the blink from the visible phase, so a fresh event is
  // never hidden behind the previous blink's off-phase.
  if (restartPhase || next !== currentState) {
    blinkVisible = true;
  }
  currentState = next;

  if (next === 'none') {
    document.documentElement.removeAttribute(ATTENTION_ATTRIBUTE);
  } else {
    document.documentElement.setAttribute(ATTENTION_ATTRIBUTE, next);
  }

  restartBlink();
  paint();
};

const pageIsActive = (): boolean => (
  document.visibilityState === 'visible' && document.hasFocus()
);

const detachReturnListeners = (): void => {
  if (!returnListenersAttached || typeof window === 'undefined') {
    return;
  }

  document.removeEventListener('visibilitychange', handleUserReturn);
  window.removeEventListener('focus', handleUserReturn, true);
  window.removeEventListener('click', handleUserReturn, true);
  returnListenersAttached = false;
};

/**
 * The countdown-hold listener exists only while a clear timer is running, so it
 * is attached on the first timer and detached with the last one. A repeated
 * raise must not stack another copy: a listener per completion would outlive
 * the mark and later attach a set of return listeners nobody detaches.
 */
const detachPageInactiveListener = (): void => {
  if (!pageInactiveListenerAttached || typeof document === 'undefined') {
    return;
  }

  document.removeEventListener('visibilitychange', handlePageInactive);
  pageInactiveListenerAttached = false;
};

const attachPageInactiveListener = (): void => {
  if (pageInactiveListenerAttached || typeof document === 'undefined') {
    return;
  }

  document.addEventListener('visibilitychange', handlePageInactive);
  pageInactiveListenerAttached = true;
};

const attachReturnListeners = (): void => {
  if (returnListenersAttached || typeof window === 'undefined') {
    return;
  }

  // Background marks keep showing indefinitely. A tab click normally surfaces as
  // visibility/focus, while an in-page click is a useful fallback.
  document.addEventListener('visibilitychange', handleUserReturn);
  window.addEventListener('focus', handleUserReturn, true);
  window.addEventListener('click', handleUserReturn, true);
  returnListenersAttached = true;
};

/** Drops one timed mark and, when nothing is left pending, stops listening for a return. */
const lower = (state: TimedState): void => {
  pendingTimed.delete(state);
  const timer = clearTimers.get(state);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    clearTimers.delete(state);
  }

  if (clearTimers.size === 0) {
    detachPageInactiveListener();
  }

  if (pendingTimed.size === 0) {
    detachReturnListeners();
  }

  render(false);
};

/** Starts the two-second countdown that takes a mark down once the user is back. */
const scheduleClear = (state: TimedState): void => {
  const existing = clearTimers.get(state);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }

  clearTimers.set(state, window.setTimeout(() => {
    lower(state);
  }, CLEAR_DELAY_MS));

  // A tab that goes to the background mid-countdown must hold the mark rather than
  // clear it while nobody is looking.
  attachPageInactiveListener();
};

function handleUserReturn(): void {
  if (!pageIsActive()) {
    return;
  }

  for (const state of pendingTimed) {
    scheduleClear(state);
  }
}

function handlePageInactive(): void {
  if (document.visibilityState !== 'hidden') {
    return;
  }

  for (const [state, timer] of clearTimers) {
    window.clearTimeout(timer);
    clearTimers.delete(state);
  }

  detachPageInactiveListener();
  attachReturnListeners();
}

const raiseTimed = (state: TimedState): void => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  pendingTimed.add(state);
  const existing = clearTimers.get(state);
  if (existing !== undefined) {
    window.clearTimeout(existing);
    clearTimers.delete(state);
  }

  render(true);

  if (pageIsActive()) {
    scheduleClear(state);
    return;
  }

  attachReturnListeners();
};

/**
 * Raises the green check for a finished run. Held until the user returns when the tab
 * is in the background; clears itself two seconds after being raised when the tab is
 * being watched.
 */
export const showCompletionIndicator = (): void => {
  raiseTimed('completion');
};

/** Raises the red cross for a run that ended with `success: false`. */
export const showFailureIndicator = (): void => {
  raiseTimed('failure');
};

/**
 * Raises or lowers the amber "waiting on your approval" mark. It is sticky by design:
 * a blocked run does not resolve by the user glancing at the tab, so it stays until
 * the running-sessions poll reports no pending approvals.
 */
export const setApprovalIndicator = (active: boolean): void => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  if (approvalActive === active) {
    return;
  }

  approvalActive = active;
  render(true);
};
