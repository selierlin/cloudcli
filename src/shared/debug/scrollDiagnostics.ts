/**
 * On-device recorder for the transcript's scroll behaviour, kept for the class
 * of defect that only reproduces inside the iOS WebView: glyphs that flicker
 * while scrolling a long session, a drag that stops moving, a jump nobody asked
 * for. Without a console the only way to tell those apart is to sample the frame
 * and the DOM while the reader reproduces the symptom by hand, then read the
 * sample back on the machine that served it.
 *
 * Everything here is observation only: one `requestAnimationFrame` sampler, one
 * `MutationObserver` over the scroll container, passive touch/scroll listeners,
 * a `PerformanceObserver` for long tasks, and wrappers around the scroll APIs so
 * a jump can be attributed to its caller. Nothing writes back to the DOM.
 *
 * Mounted only while Settings → Diagnostics is on; see `diagnosticsPreference`.
 */

export type ScrollDiagnosticsEvent = [number, string, ...(number | string)[]];

export type ScrollDiagnosticsSummary = {
  durationMs: number;
  samples: number;
  /** Frame gaps above ~2 vsync intervals; the sampler runs once per frame. */
  jankyFrames: number;
  maxFrameMs: number;
  p95FrameMs: number;
  scrollEvents: number;
  touchedSamples: number;
  /** Samples where the pane jumped toward the tail while a finger was down. */
  jumpWhileTouching: number;
  largestJumpPx: number;
  /** Samples where that jump landed exactly on the bottom edge. */
  snappedToBottomWhileTouching: number;
  mutations: number;
  addedNodes: number;
  removedNodes: number;
  rowMounts: number;
  rowUnmounts: number;
  longTasks: number;
  maxLongTaskMs: number;
  truncated: boolean;
};

export type ScrollDiagnosticsReport = {
  version: 5;
  createdAt: string;
  userAgent: string;
  viewport: { width: number; height: number; dpr: number };
  session: {
    messageRows: number;
    bodyScrollHeight: number;
    fontsStatus: string;
    fontFamilies: string[];
  };
  summary: ScrollDiagnosticsSummary;
  events: ScrollDiagnosticsEvent[];
};

const MAX_EVENTS = 12000;
/** Mutations are batched into this window so the log stays readable. */
const MUTATION_FLUSH_MS = 100;

type PendingMutations = {
  added: number;
  removed: number;
  rows: Map<string, number>;
};

type DiagnosticsState = {
  container: HTMLElement;
  startedAt: number;
  lastSampleAt: number;
  events: ScrollDiagnosticsEvent[];
  frameId: number | null;
  observer: MutationObserver | null;
  longTaskObserver: PerformanceObserver | null;
  cleanup: Array<() => void>;
  pending: PendingMutations;
  pendingSince: number;
  /// Row wrappers stay in the DOM for the life of the window, so their
  /// content-relative offsets are a cheap signature of layout above/below.
  firstRow: HTMLElement | null;
  lastRow: HTMLElement | null;
  lastActiveElement: string;
  lastSelectionLength: number;
  counters: {
    samples: number;
    jankyFrames: number;
    maxFrameMs: number;
    frameGaps: number[];
    scrollEvents: number;
    touchedSamples: number;
    jumpWhileTouching: number;
    largestJumpPx: number;
    snappedToBottomWhileTouching: number;
    mutations: number;
    addedNodes: number;
    removedNodes: number;
    rowMounts: number;
    rowUnmounts: number;
    longTasks: number;
    maxLongTaskMs: number;
    lastScrollTop: number;
    touchActive: boolean;
  };
  truncated: boolean;
};

let activeState: DiagnosticsState | null = null;
/// Kept after a stop so the reader can report a run they already finished.
let lastReport: ScrollDiagnosticsReport | null = null;

/**
 * Records one programmatic `scrollTop` write, so a report can attribute every
 * move to the code that made it. Browser-side scroll anchoring has no tag; a
 * move with no `W` event next to it is the browser's own compensation.
 */
export function noteScrollWrite(source: string, container: HTMLElement | null): void {
  const state = activeState;
  if (!state || !container) return;
  pushEvent(state, [nowOffset(state), 'W', source, Math.round(container.scrollTop)]);
}

function pushEvent(state: DiagnosticsState, event: ScrollDiagnosticsEvent): void {
  if (state.events.length >= MAX_EVENTS) {
    state.truncated = true;
    return;
  }
  state.events.push(event);
}

function nowOffset(state: DiagnosticsState): number {
  return Math.round(performance.now() - state.startedAt);
}

/** Finds the transcript row that owns a mutated node, keyed by its timestamp. */
function resolveRowTimestamp(node: Node | null): string | null {
  let element: Element | null = node instanceof Element ? node : node?.parentElement ?? null;
  while (element) {
    const timestamp = element.getAttribute('data-message-timestamp');
    if (timestamp) return timestamp;
    element = element.parentElement;
  }
  return null;
}

/** Compact identity for an element, so a report can name a node without DOM refs. */
function describeElement(node: Element | null): string {
  if (!node) return 'none';
  const tag = node.tagName.toLowerCase();
  const className = typeof node.className === 'string' ? node.className.split(/\s+/)[0] : '';
  const marker = node.getAttribute('data-message-timestamp')
    ? `@${node.getAttribute('data-message-timestamp')}`
    : node.getAttribute('data-user-sticky-header') !== null
      ? '@stickyHeader'
      : '';
  return `${tag}${className ? `.${className}` : ''}${marker}`;
}

/**
 * Wraps every public API that can move a scroll offset, so a jump can be
 * attributed to the caller instead of guessed at. `scrollTop` is an accessor on
 * `Element.prototype`, so it is redefined around the original setter; the
 * originals are restored when the recording stops.
 */
function installScrollApiPatches(state: DiagnosticsState): void {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  for (const name of ['scrollIntoView', 'scrollTo', 'scrollBy', 'scroll']) {
    const original = proto[name];
    if (typeof original !== 'function') continue;
    const patched = function patchedScrollApi(this: Element, ...args: unknown[]) {
      const stack = new Error().stack?.split('\n').slice(2, 5).join(' <- ') ?? '';
      pushEvent(state, [
        nowOffset(state), 'A', name, describeElement(this), String(args[0] ?? ''), stack.slice(0, 260),
      ]);
      return (original as (...rest: unknown[]) => unknown).apply(this, args);
    };
    proto[name] = patched;
    state.cleanup.push(() => { proto[name] = original; });
  }

  const descriptor = Object.getOwnPropertyDescriptor(proto, 'scrollTop');
  if (descriptor?.set && descriptor.configurable) {
    const originalSet = descriptor.set;
    Object.defineProperty(proto, 'scrollTop', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(this: Element, value: number) {
        const stack = new Error().stack?.split('\n').slice(2, 5).join(' <- ') ?? '';
        pushEvent(state, [
          nowOffset(state), 'A', 'scrollTop=', describeElement(this), String(value), stack.slice(0, 260),
        ]);
        originalSet.call(this, value);
      },
    });
    state.cleanup.push(() => { Object.defineProperty(proto, 'scrollTop', descriptor); });
  }
}

function flushMutations(state: DiagnosticsState): void {
  const { added, removed, rows } = state.pending;
  if (added === 0 && removed === 0 && rows.size === 0) return;

  const at = nowOffset(state);
  pushEvent(state, [at, 'M', added, removed, rows.size]);
  state.counters.mutations += 1;
  state.counters.addedNodes += added;
  state.counters.removedNodes += removed;

  for (const timestamp of rows.keys()) {
    const row = state.container.querySelector(
      `[data-message-timestamp="${CSS.escape(timestamp)}"]`,
    );
    if (!row) continue;
    const children = row.childElementCount;
    const rect = row.getBoundingClientRect();
    const offsetTop = Math.round(
      rect.top - state.container.getBoundingClientRect().top,
    );
    pushEvent(state, [at, 'R', timestamp, children, Math.round(rect.height), offsetTop]);
    // A row that alternates between 0 and N children is the lazy observer
    // re-mounting it; the mount/unmount counters make that visible in summary.
    if (children > 0) state.counters.rowMounts += 1;
    else state.counters.rowUnmounts += 1;
  }

  state.pending = { added: 0, removed: 0, rows: new Map() };
  state.pendingSince = at;
}

function sampleFrame(state: DiagnosticsState, frameNow: number): void {
  const gap = state.lastSampleAt === 0 ? 0 : frameNow - state.lastSampleAt;
  state.lastSampleAt = frameNow;

  const container = state.container;
  const scrollTop = Math.round(container.scrollTop);
  const scrollHeight = Math.round(container.scrollHeight);
  const clientHeight = container.clientHeight;
  const at = nowOffset(state);

  const firstOffset = state.firstRow ? Math.round(state.firstRow.offsetTop) : -1;
  const lastOffset = state.lastRow ? Math.round(state.lastRow.offsetTop) : -1;
  const selection = window.getSelection();
  const selectionText = selection ? selection.toString().length : 0;
  if (selectionText !== state.lastSelectionLength) {
    state.lastSelectionLength = selectionText;
    const anchor = selection?.anchorNode
      ? resolveRowTimestamp(selection.anchorNode)
      : null;
    pushEvent(state, [at, 'SEL', selectionText, anchor ?? 'none']);
  }
  const active = describeElement(document.activeElement);
  const activeChanged = active !== state.lastActiveElement;
  state.lastActiveElement = active;
  pushEvent(state, [
    at, 'F', scrollTop, scrollHeight, clientHeight, Math.round(gap), firstOffset, lastOffset, activeChanged ? 1 : 0,
  ]);
  if (activeChanged) pushEvent(state, [at, 'AF', active]);

  state.counters.samples += 1;
  if (gap > 0) {
    state.counters.frameGaps.push(gap);
    if (gap > state.counters.maxFrameMs) state.counters.maxFrameMs = gap;
    if (gap > 34) state.counters.jankyFrames += 1;
  }
  if (state.counters.touchActive) {
    state.counters.touchedSamples += 1;
    const delta = scrollTop - state.counters.lastScrollTop;
    // A finger drag moves the content with the finger: reading upward means
    // scrollTop shrinking. Growth on its own is ambiguous (a downward drag does
    // that too), but a large one-frame growth while the finger is down, and
    // especially one that lands on the bottom edge, is the follow writer or the
    // anchor settle loop pulling the view out from under the reader.
    if (delta > 16) {
      state.counters.jumpWhileTouching += 1;
      if (delta > state.counters.largestJumpPx) state.counters.largestJumpPx = delta;
      if (
        scrollTop + clientHeight >= scrollHeight - 8
        && state.counters.lastScrollTop + clientHeight < scrollHeight - 8
      ) {
        state.counters.snappedToBottomWhileTouching += 1;
      }
    }
  }
  state.counters.lastScrollTop = scrollTop;

  if (at - state.pendingSince >= MUTATION_FLUSH_MS) {
    flushMutations(state);
  }

  state.frameId = window.requestAnimationFrame((next) => sampleFrame(state, next));
}

export function startScrollDiagnostics(container: HTMLElement): void {
  stopScrollDiagnostics();

  const state: DiagnosticsState = {
    container,
    startedAt: performance.now(),
    lastSampleAt: 0,
    events: [],
    frameId: null,
    observer: null,
    longTaskObserver: null,
    cleanup: [],
    pending: { added: 0, removed: 0, rows: new Map() },
    pendingSince: 0,
    firstRow: container.querySelector<HTMLElement>('[data-message-timestamp]'),
    lastRow: [...container.querySelectorAll<HTMLElement>('[data-message-timestamp]')].at(-1) ?? null,
    lastActiveElement: '',
    lastSelectionLength: -1,
    counters: {
      samples: 0,
      jankyFrames: 0,
      maxFrameMs: 0,
      frameGaps: [],
      scrollEvents: 0,
      touchedSamples: 0,
      jumpWhileTouching: 0,
      largestJumpPx: 0,
      snappedToBottomWhileTouching: 0,
      mutations: 0,
      addedNodes: 0,
      removedNodes: 0,
      rowMounts: 0,
      rowUnmounts: 0,
      longTasks: 0,
      maxLongTaskMs: 0,
      lastScrollTop: Math.round(container.scrollTop),
      touchActive: false,
    },
    truncated: false,
  };

  activeState = state;
  lastReport = null;

  const onScroll = () => {
    state.counters.scrollEvents += 1;
  };
  const onTouchStart = () => {
    state.counters.touchActive = true;
    pushEvent(state, [nowOffset(state), 'T', 'start']);
  };
  const onTouchEnd = (event: TouchEvent) => {
    state.counters.touchActive = false;
    pushEvent(state, [nowOffset(state), 'T', event.type === 'touchcancel' ? 'cancel' : 'end']);
  };
  const onFontsDone = () => {
    pushEvent(state, [nowOffset(state), 'FONTS', document.fonts.status]);
  };

  container.addEventListener('scroll', onScroll, { passive: true });
  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('touchend', onTouchEnd, { passive: true });
  container.addEventListener('touchcancel', onTouchEnd, { passive: true });
  state.cleanup.push(() => {
    container.removeEventListener('scroll', onScroll);
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('touchend', onTouchEnd);
    container.removeEventListener('touchcancel', onTouchEnd);
  });

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      state.pending.added += record.addedNodes.length;
      state.pending.removed += record.removedNodes.length;
      const timestamp = resolveRowTimestamp(record.target);
      if (timestamp) {
        state.pending.rows.set(timestamp, (state.pending.rows.get(timestamp) ?? 0) + 1);
      }
    }
  });
  observer.observe(container, { subtree: true, childList: true, characterData: true });
  state.observer = observer;

  try {
    const longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = Math.round(entry.duration);
        state.counters.longTasks += 1;
        if (duration > state.counters.maxLongTaskMs) {
          state.counters.maxLongTaskMs = duration;
        }
        pushEvent(state, [nowOffset(state), 'L', duration]);
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
    state.longTaskObserver = longTaskObserver;
  } catch {
    // `longtask` is not implemented on every WebKit build; the frame sampler
    // still reports stalls, so this is optional evidence.
  }

  const onFocusChange = (event: FocusEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target === document.body) return;
    pushEvent(state, [nowOffset(state), 'FOCUS', event.type, describeElement(target)]);
  };
  document.addEventListener('focusin', onFocusChange, true);
  document.addEventListener('focusout', onFocusChange, true);
  state.cleanup.push(() => {
    document.removeEventListener('focusin', onFocusChange, true);
    document.removeEventListener('focusout', onFocusChange, true);
  });

  installScrollApiPatches(state);

  document.fonts?.addEventListener?.('loadingdone', onFontsDone);
  state.cleanup.push(() => document.fonts?.removeEventListener?.('loadingdone', onFontsDone));

  pushEvent(state, [
    0,
    'START',
    Math.round(container.scrollTop),
    Math.round(container.scrollHeight),
    container.clientHeight,
  ]);
  state.frameId = window.requestAnimationFrame((next) => sampleFrame(state, next));
}

export function stopScrollDiagnostics(): void {
  const state = activeState;
  if (!state) return;
  // Freeze first: the report needs the state this call is about to tear down.
  buildScrollDiagnosticsReport();
  activeState = null;

  if (state.frameId !== null) window.cancelAnimationFrame(state.frameId);
  state.observer?.disconnect();
  state.longTaskObserver?.disconnect();
  for (const cleanup of state.cleanup) cleanup();
  flushMutations(state);

}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return Math.round(sorted[index]);
}

function collectFontFamilies(container: HTMLElement): string[] {
  const families = new Set<string>();
  const sample = container.querySelectorAll('.chat-message .prose, .chat-message .break-words');
  for (let index = 0; index < Math.min(sample.length, 40); index += 1) {
    const family = getComputedStyle(sample[index]).fontFamily;
    if (family) families.add(family);
  }
  return [...families];
}

function snapshotSummary(state: DiagnosticsState): ScrollDiagnosticsSummary {
  return {
    durationMs: Math.round(performance.now() - state.startedAt),
    samples: state.counters.samples,
    jankyFrames: state.counters.jankyFrames,
    maxFrameMs: Math.round(state.counters.maxFrameMs),
    p95FrameMs: percentile(state.counters.frameGaps, 0.95),
    scrollEvents: state.counters.scrollEvents,
    touchedSamples: state.counters.touchedSamples,
    jumpWhileTouching: state.counters.jumpWhileTouching,
    largestJumpPx: Math.round(state.counters.largestJumpPx),
    snappedToBottomWhileTouching: state.counters.snappedToBottomWhileTouching,
    mutations: state.counters.mutations,
    addedNodes: state.counters.addedNodes,
    removedNodes: state.counters.removedNodes,
    rowMounts: state.counters.rowMounts,
    rowUnmounts: state.counters.rowUnmounts,
    longTasks: state.counters.longTasks,
    maxLongTaskMs: Math.round(state.counters.maxLongTaskMs),
    truncated: state.truncated,
  };
}

/**
 * Freezes the recording into an uploadable report. The caller decides where it
 * goes; this function never talks to the network.
 */
export function buildScrollDiagnosticsReport(): ScrollDiagnosticsReport | null {
  const state = activeState;
  if (!state) return lastReport;
  flushMutations(state);

  lastReport = {
    version: 5,
    createdAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    session: {
      messageRows: state.container.querySelectorAll('[data-message-timestamp]').length,
      bodyScrollHeight: Math.round(state.container.scrollHeight),
      fontsStatus: document.fonts?.status ?? 'unknown',
      fontFamilies: collectFontFamilies(state.container),
    },
    summary: snapshotSummary(state),
    events: [...state.events],
  };
  return lastReport;
}

/** Raw counters for the panel's live readout; null when not recording. */
export function readScrollDiagnosticsStats(): ScrollDiagnosticsSummary | null {
  const state = activeState;
  return state ? snapshotSummary(state) : null;
}
