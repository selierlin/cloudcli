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
  /** How many times the user-message section header changed shown/hidden state. */
  headerFlips: number;
  /** "Load earlier" pages that landed during the recording. */
  prependPages: number;
  /**
   * Frames where `scrollTop` moved a long way and no writer in the app asked
   * for it. On a phone these are the platform's own moves — a rubber band
   * springing back, a native animation finishing — and they are the reason a
   * compensation can disappear moments after it was written.
   */
  nativeScrollJumps: number;
  /**
   * Frames where the content moved relative to the viewport by more than a few
   * pixels *after* the finger's own scrolling is accounted for. This is the
   * direct measurement of "the page jumped": the reader's drag cancels out, and
   * what is left is layout moving under them.
   */
  visualJumps: number;
  largestVisualJumpPx: number;
  /**
   * The same measurement, but in frames where the app wrote `scrollTop`. Those
   * numbers cannot be read as "the reader saw this much movement": an insert and
   * its compensation can share one frame, so a 7700px layout change shows up as
   * a 7700px residual that was never painted. Kept separate so the headline
   * count stays honest.
   */
  writeFrameJumps: number;
  /** Height changes on the row the reader is looking at — the insert arriving. */
  rowHeightChanges: number;
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
  version: 8;
  createdAt: string;
  userAgent: string;
  /**
   * Which shell produced the sample. The defect being chased is specific to the
   * iOS WebView, so a report that cannot say whether it came from Safari, from
   * the app's WebView, or from a desktop browser cannot be compared with one
   * that did.
   */
  runtime: 'ios-webview' | 'ios-safari' | 'desktop' | 'other';
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
/**
 * One-frame `scrollTop` move large enough that a finger cannot explain it away
 * as ordinary dragging. Used to flag moves the app never asked for.
 */
const NATIVE_SCROLL_JUMP_MIN_PX = 300;
/**
 * Net content-vs-viewport displacement worth reporting. The reader's own drag
 * and the platform's inertia both move `scrollTop` and the anchor together, so
 * they cancel in the residual; anything left over is layout moving on its own.
 * Three pixels clears the integer quantisation of `scrollTop` on WebKit.
 */
const VISUAL_JUMP_MIN_PX = 3;
/** A row growing or shrinking by this much is a real layout change, not rounding. */
const ROW_HEIGHT_CHANGE_MIN_PX = 2;
/** Mutations are batched into this window so the log stays readable. */
const MUTATION_FLUSH_MS = 100;
/** Nodes per flush whose viewport position is resolved (each costs a rect read). */
const MUTATION_SAMPLE_LIMIT = 6;

type PendingMutations = {
  added: number;
  removed: number;
  rows: Map<string, number>;
  /** A few added elements kept so a flush can say *where* the insert landed. */
  samples: Element[];
};

/**
 * One transcript row, pinned by identity. `height` is the value read on the
 * previous frame, so this frame's read can be diffed against it; its screen
 * position is kept in `DiagnosticsState.lastTrackedTop`, not here.
 */
type TrackedRow = {
  el: HTMLElement;
  id: string;
  height: number;
};

/**
 * Which shell the page is running in. `Version/… Safari/…` is Safari proper;
 * the same UA without `Version/` is a WKWebView, which is what the iOS app
 * embeds and where the reported defect lives.
 */
function detectRuntime(): ScrollDiagnosticsReport['runtime'] {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) {
    return /Version\/[\d.]+.*Safari\//.test(ua) ? 'ios-safari' : 'ios-webview';
  }
  if (/Macintosh|Windows|Linux/.test(ua)) return 'desktop';
  return 'other';
}

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
  /**
   * A row kept together with the pane's top edge, so every frame can report how
   * far the content moved *on screen* — not just how far `scrollTop` moved. A
   * page inserted above the viewport can rewrite the layout without touching
   * `scrollTop` at all, and that is exactly the "the transcript put me somewhere
   * else" jump this recorder has to show.
   *
   * The row is tracked until it leaves the DOM rather than re-picked each frame:
   * its screen position is only comparable across frames while it is the same
   * row, and a re-pick would read as a jump of its own.
   */
  trackedRow: TrackedRow | null;
  /** Previous frame's tracked-row top; `null` right after a re-pick. */
  lastTrackedTop: number | null;
  /** Previous frame's document height, for attributing a jump to a re-layout. */
  lastScrollHeight: number;
  lastActiveElement: string;
  lastSelectionLength: number;
  /// Previous sample's section-header state, so a flip can be timestamped with
  /// the geometry that caused it instead of only being visible in the frames.
  lastHeaderState: string;
  /**
   * Whether a writer in the app touched `scrollTop` since the last frame. A
   * large move with this false is the platform moving the viewport by itself.
   */
  wroteSinceSample: boolean;
  /** Source of the most recent programmatic write, for attributing a shift. */
  lastWriteSource: string;
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
    headerFlips: number;
    prependPages: number;
    nativeScrollJumps: number;
    visualJumps: number;
    largestVisualJumpPx: number;
    /** Layout shifts inside a frame that also carried an app write. */
    writeFrameJumps: number;
    rowHeightChanges: number;
    lastScrollTop: number;
    touchActive: boolean;
    /**
     * Which drag the sample belongs to. The symptom is reported as "the last
     * swipe did it", so every jump carries the gesture it happened in and the
     * `T` events carry the same number.
     */
    gesture: number;
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
  state.wroteSinceSample = true;
  state.lastWriteSource = source;
  pushEvent(state, [nowOffset(state), 'W', source, Math.round(container.scrollTop)]);
}

/**
 * Records one transcript-window event. A viewport that ends up far from where
 * the finger left it is decided by exactly three moments, and the frame samples
 * alone cannot separate them: the page that lands (P0/P1), the compensation
 * written for it (RS), and the settle loop that was supposed to keep the anchor
 * pinned afterwards (AS0/AS1 — including why it stopped).
 *
 * `scrollTop`/`scrollHeight` are always the values after the caller's write, so
 * `RS` can be read as "inserted N px, landed here".
 */
export function noteTranscriptEvent(
  kind: 'P0' | 'P1' | 'RS' | 'AS0' | 'AS1',
  container: HTMLElement | null,
  ...fields: (number | string)[]
): void {
  const state = activeState;
  if (!state || !container) return;
  pushEvent(state, [
    nowOffset(state), kind,
    Math.round(container.scrollTop), Math.round(container.scrollHeight),
    ...fields,
    // Whether a finger was on the glass when this was written: a compensation
    // written mid-gesture is the one the platform is allowed to discard.
    state.counters.touchActive ? 1 : 0,
  ]);
  if (kind === 'P1') state.counters.prependPages += 1;
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
 * The user-message section header's state (`absent` / `pinned` / `bridging`).
 * Read from the header's own marker because the visible/invisible difference
 * lives only in its class list, and the two states look identical in geometry.
 */
function readHeaderState(container: HTMLElement): string {
  return container.querySelector<HTMLElement>('[data-sticky-state]')?.dataset.stickyState ?? 'absent';
}

/**
 * The user-anchor row closest to the panel top edge, as
 * `[top, bottom, index]` relative to that edge. Only called when the header
 * flips, so the per-frame cost of scanning rows is not paid on every sample.
 */
function readNearestAnchor(container: HTMLElement): [number, number, number] {
  const paneTop = container.getBoundingClientRect().top;
  let nearest: [number, number, number] = [0, 0, -1];
  let nearestDistance = Number.POSITIVE_INFINITY;
  container.querySelectorAll<HTMLElement>('[data-user-anchor]').forEach((row, index) => {
    const rect = row.getBoundingClientRect();
    const top = Math.round(rect.top - paneTop);
    const bottom = Math.round(rect.bottom - paneTop);
    // Distance to the edge: rows below it are measured by their top, rows above
    // by their bottom, and a row spanning the edge is distance zero.
    const distance = bottom < 0 ? -bottom : top > 0 ? top : 0;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = [top, bottom, index];
    }
  });
  return nearest;
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
  const { added, removed, rows, samples } = state.pending;
  if (added === 0 && removed === 0 && rows.size === 0) return;

  const at = nowOffset(state);
  pushEvent(state, [at, 'M', added, removed, rows.size]);
  state.counters.mutations += 1;
  state.counters.addedNodes += added;
  state.counters.removedNodes += removed;

  // Where the insert landed relative to what the reader can see. A row that
  // mounts above the viewport is what pushes the transcript down; one that
  // mounts inside it is what makes content appear under the finger. The counts
  // alone cannot tell those apart, which is why a report of "it jumped" used to
  // have no suspect in it.
  if (added > 0 && samples.length > 0) {
    const paneRect = state.container.getBoundingClientRect();
    let above = 0;
    let inside = 0;
    let below = 0;
    let tallest = 0;
    for (const element of samples) {
      if (!element.isConnected) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const top = rect.top - paneRect.top;
      const bottom = rect.bottom - paneRect.top;
      if (bottom <= 0) above += 1;
      else if (top >= paneRect.height) below += 1;
      else inside += 1;
      if (rect.height > tallest) tallest = Math.round(rect.height);
    }
    pushEvent(state, [at, 'MX', added, above, inside, below, tallest]);
  }

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

  state.pending = { added: 0, removed: 0, rows: new Map(), samples: [] };
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

  // Keep one row pinned by identity so its screen position can be diffed frame
  // to frame. Re-picking reads as a jump of its own, so a re-pick clears the
  // baseline instead of reporting one.
  const paneTop = container.getBoundingClientRect().top;
  let row = state.trackedRow;
  if (row && !row.el.isConnected) row = null;
  if (!row) {
    for (const candidate of container.querySelectorAll<HTMLElement>('[data-message-timestamp]')) {
      if (candidate.getBoundingClientRect().bottom >= paneTop) {
        row = {
          el: candidate,
          id: candidate.getAttribute('data-message-timestamp') ?? 'none',
          height: 0,
        };
        break;
      }
    }
    state.trackedRow = row;
    state.lastTrackedTop = null;
    pushEvent(state, [at, 'VA', row?.id ?? 'none']);
  }

  const trackedRect = row ? row.el.getBoundingClientRect() : null;
  const trackedTop = trackedRect ? Math.round(trackedRect.top - paneTop) : -9999;
  const trackedHeight = trackedRect ? Math.round(trackedRect.height) : 0;

  // The strip of evidence this recorder was missing: the anchor's screen
  // movement and `scrollTop` cancel for any movement the reader made, so what
  // survives is layout moving on its own. Positive means the content was pushed
  // down. A finger drag, inertia, and the app's own compensation all cancel;
  // a page inserted above the viewport does not.
  // Whether an app write landed between the last frame and this one. When it
  // did, an insert and the compensation for it can share the frame: the residual
  // then measures the layout change, not anything that was painted. Keeping the
  // two cases apart is the difference between "the reader was moved 7700px" and
  // "7700px of rows were laid out and immediately compensated for".
  const wrote = state.wroteSinceSample;
  const writeSource = state.lastWriteSource;

  let residual = 0;
  if (row && state.lastTrackedTop !== null) {
    const visualDelta = trackedTop - state.lastTrackedTop;
    const scrollDelta = scrollTop - state.counters.lastScrollTop;
    residual = visualDelta + scrollDelta;
    if (Math.abs(residual) >= VISUAL_JUMP_MIN_PX) {
      if (wrote) {
        pushEvent(state, [
          at, 'WV', residual, visualDelta, scrollDelta,
          scrollHeight - state.lastScrollHeight, writeSource, row.id,
          state.counters.gesture,
        ]);
        state.counters.writeFrameJumps += 1;
      } else {
        pushEvent(state, [
          at, 'VJ', residual, visualDelta, scrollDelta,
          scrollHeight - state.lastScrollHeight,
          state.counters.touchActive ? 1 : 0, row.id, state.counters.gesture,
        ]);
        state.counters.visualJumps += 1;
        if (Math.abs(residual) > state.counters.largestVisualJumpPx) {
          state.counters.largestVisualJumpPx = Math.abs(residual);
        }
      }
    }
    // The row under the reader getting taller or shorter is the insert itself,
    // as opposed to a shift caused by something inserted above it.
    if (row.height > 0 && Math.abs(trackedHeight - row.height) >= ROW_HEIGHT_CHANGE_MIN_PX) {
      pushEvent(state, [
        at, 'RH', row.id, row.height, trackedHeight, trackedTop, state.counters.gesture,
      ]);
      state.counters.rowHeightChanges += 1;
    }
  }
  if (row) {
    row.height = trackedHeight;
    state.lastTrackedTop = trackedTop;
  }
  state.lastScrollHeight = scrollHeight;

  pushEvent(state, [
    at, 'F', scrollTop, scrollHeight, clientHeight, Math.round(gap), firstOffset, lastOffset,
    activeChanged ? 1 : 0, trackedTop, trackedHeight, residual,
  ]);
  if (activeChanged) pushEvent(state, [at, 'AF', active]);

  // The section header flips without any scroll write of its own, so record
  // each transition with the geometry that produced it: a flip that happens at
  // a stable scrollTop, or one paired with a row mount, is a different defect
  // from a flip caused by the reader actually crossing the row.
  const headerElement = container.querySelector<HTMLElement>('[data-sticky-state]');
  const headerState = headerElement?.dataset.stickyState ?? 'absent';
  if (headerState !== state.lastHeaderState) {
    const [anchorTop, anchorBottom, anchorIndex] = readNearestAnchor(container);
    pushEvent(state, [
      at, 'SH', state.lastHeaderState, headerState, scrollTop, scrollHeight,
      headerElement?.offsetHeight ?? 0, anchorTop, anchorBottom, anchorIndex,
    ]);
    state.lastHeaderState = headerState;
    state.counters.headerFlips += 1;
  }

  state.counters.samples += 1;
  if (gap > 0) {
    state.counters.frameGaps.push(gap);
    if (gap > state.counters.maxFrameMs) state.counters.maxFrameMs = gap;
    if (gap > 34) state.counters.jankyFrames += 1;
  }
  // A long move no writer in this app asked for, with no finger on the glass to
  // explain it. On a phone that is the platform moving the viewport itself — a
  // rubber band springing back, a native animation finishing — and it leaves no
  // trace in `W` or `A`. This is the event that names who undid a compensation
  // the restore had already reported as stable.
  if (!wrote && !state.counters.touchActive) {
    const jump = scrollTop - state.counters.lastScrollTop;
    if (Math.abs(jump) >= NATIVE_SCROLL_JUMP_MIN_PX) {
      pushEvent(state, [at, 'NX', state.counters.lastScrollTop, scrollTop, jump]);
      state.counters.nativeScrollJumps += 1;
    }
  }
  state.wroteSinceSample = false;
  state.lastWriteSource = '';

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
    pending: { added: 0, removed: 0, rows: new Map(), samples: [] },
    pendingSince: 0,
    firstRow: container.querySelector<HTMLElement>('[data-message-timestamp]'),
    lastRow: [...container.querySelectorAll<HTMLElement>('[data-message-timestamp]')].at(-1) ?? null,
    trackedRow: null,
    lastTrackedTop: null,
    lastScrollHeight: Math.round(container.scrollHeight),
    lastActiveElement: '',
    lastSelectionLength: -1,
    lastHeaderState: readHeaderState(container),
    wroteSinceSample: false,
    lastWriteSource: '',
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
      headerFlips: 0,
      prependPages: 0,
      nativeScrollJumps: 0,
      visualJumps: 0,
      largestVisualJumpPx: 0,
      writeFrameJumps: 0,
      rowHeightChanges: 0,
      lastScrollTop: Math.round(container.scrollTop),
      touchActive: false,
      gesture: 0,
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
    state.counters.gesture += 1;
    pushEvent(state, [
      nowOffset(state), 'T', 'start', Math.round(container.scrollTop), state.counters.gesture,
    ]);
  };
  const onTouchEnd = (event: TouchEvent) => {
    state.counters.touchActive = false;
    pushEvent(state, [
      nowOffset(state), 'T', event.type === 'touchcancel' ? 'cancel' : 'end',
      Math.round(container.scrollTop), state.counters.gesture,
    ]);
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
      // One element per record is enough to place the insert: a React commit
      // that mounts a subtree adds its root here, and keeping every leaf would
      // cost a rect read per node on the flush.
      if (state.pending.samples.length < MUTATION_SAMPLE_LIMIT) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            state.pending.samples.push(node);
            break;
          }
        }
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
    headerFlips: state.counters.headerFlips,
    prependPages: state.counters.prependPages,
    nativeScrollJumps: state.counters.nativeScrollJumps,
    visualJumps: state.counters.visualJumps,
    largestVisualJumpPx: Math.round(state.counters.largestVisualJumpPx),
    writeFrameJumps: state.counters.writeFrameJumps,
    rowHeightChanges: state.counters.rowHeightChanges,
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
    version: 8,
    createdAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    runtime: detectRuntime(),
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
