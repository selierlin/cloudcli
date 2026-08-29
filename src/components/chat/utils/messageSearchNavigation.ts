import type { ChatMessage } from '../types/types';

export type MessageSearchTarget = {
  timestamp?: string;
  snippet?: string;
};

export type MessageSearchResolution = {
  message: ChatMessage | null;
  shouldLoadHistory: boolean;
};

type MessageSearchHistoryLoad = {
  status: string;
};

type MessageSearchScrollElement = {
  isConnected: boolean;
  getBoundingClientRect: () => { top: number; height: number };
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

type KeepMessageSearchTargetCenteredOptions = {
  container: Pick<MessageSearchScrollElement, 'getBoundingClientRect'> & { scrollTop: number };
  target: MessageSearchScrollElement;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (frameId: number) => void;
  onSettled?: () => void;
};

const SEARCH_LAYOUT_STABLE_FRAMES = 3;
const SEARCH_SCROLL_STABLE_FRAMES = 3;
const SEARCH_SCROLL_MAX_FRAMES = 60;
const SEARCH_SCROLL_MAX_ATTEMPTS = 3;
const SEARCH_SCROLL_TOLERANCE_PX = 2;

/**
 * Accepts a completed full-history request only when it belongs to the session
 * still being viewed and the session store did not convert a request failure
 * into an error-state slot.
 */
export function canApplyMessageSearchHistoryLoad<T extends MessageSearchHistoryLoad>(
  slot: T | null,
  requestedSessionId: string,
  activeSessionId: string | null,
): slot is T {
  return Boolean(
    slot
    && slot.status !== 'error'
    && activeSessionId === requestedSessionId
  );
}

/**
 * Waits for a newly mounted history target to stabilize, then scrolls to it
 * smoothly. If hydration moves the target while that animation is running,
 * the smooth scroll is restarted against its new layout position.
 */
export function keepMessageSearchTargetCentered({
  container,
  target,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  onSettled,
}: KeepMessageSearchTargetCenteredOptions): () => void {
  let cancelled = false;
  let frameId: number | null = null;
  let phase: 'layout' | 'scrolling' = 'layout';
  let phaseFrames = 0;
  let stableFrames = 0;
  let scrollAttempts = 0;
  let lastLayoutPosition: number | null = null;

  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    onSettled?.();
  };

  const beginSmoothScroll = (layoutPosition: number) => {
    phase = 'scrolling';
    phaseFrames = 0;
    stableFrames = 0;
    scrollAttempts += 1;
    lastLayoutPosition = layoutPosition;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const check = () => {
    if (cancelled) return;
    if (!target.isConnected) {
      finish();
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const containerCenter = containerRect.top + (containerRect.height / 2);
    const targetCenter = targetRect.top + (targetRect.height / 2);
    const layoutPosition = targetRect.top - containerRect.top + container.scrollTop;
    const isCentered = Math.abs(targetCenter - containerCenter) <= SEARCH_SCROLL_TOLERANCE_PX;

    if (phase === 'layout') {
      const layoutIsStable = lastLayoutPosition !== null
        && Math.abs(layoutPosition - lastLayoutPosition) <= SEARCH_SCROLL_TOLERANCE_PX;
      stableFrames = layoutIsStable ? stableFrames + 1 : 0;
      lastLayoutPosition = layoutPosition;
      phaseFrames += 1;

      if (
        stableFrames >= SEARCH_LAYOUT_STABLE_FRAMES
        || phaseFrames >= SEARCH_SCROLL_MAX_FRAMES
      ) {
        beginSmoothScroll(layoutPosition);
      }
    } else {
      const layoutShifted = lastLayoutPosition !== null
        && Math.abs(layoutPosition - lastLayoutPosition) > SEARCH_SCROLL_TOLERANCE_PX;

      if (layoutShifted && scrollAttempts < SEARCH_SCROLL_MAX_ATTEMPTS) {
        beginSmoothScroll(layoutPosition);
      } else {
        lastLayoutPosition = layoutPosition;
        stableFrames = isCentered ? stableFrames + 1 : 0;
        phaseFrames += 1;

        if (stableFrames >= SEARCH_SCROLL_STABLE_FRAMES) {
          finish();
          return;
        }

        if (phaseFrames >= SEARCH_SCROLL_MAX_FRAMES) {
          if (scrollAttempts < SEARCH_SCROLL_MAX_ATTEMPTS) {
            beginSmoothScroll(layoutPosition);
          } else {
            finish();
            return;
          }
        }
      }
    }

    frameId = requestFrame(check);
  };

  check();

  return () => {
    cancelled = true;
    if (frameId !== null) {
      cancelFrame(frameId);
    }
  };
}

function messageTimestamp(value: ChatMessage['timestamp']): number | null {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function normalizedSnippet(value: string | undefined): string {
  return (value ?? '')
    .replace(/^\.{3}/, '')
    .replace(/\.{3}$/, '')
    .trim()
    .slice(0, 80)
    .toLowerCase();
}

/**
 * Resolves an outline/search target against the messages already held by the
 * chat session. Callers use `shouldLoadHistory` to avoid an unbounded history
 * request whenever the target is already available in the session store.
 */
export function resolveMessageSearchTarget(
  messages: ChatMessage[],
  target: MessageSearchTarget,
): MessageSearchResolution {
  const targetTimestamp = target.timestamp ? new Date(target.timestamp).getTime() : null;
  const usableTimestamp = targetTimestamp !== null && !Number.isNaN(targetTimestamp)
    ? targetTimestamp
    : null;
  const snippet = normalizedSnippet(target.snippet);
  const userMessages = messages.filter((message) => message.type === 'user');

  if (usableTimestamp !== null) {
    const timestampMatches = userMessages.filter(
      (message) => messageTimestamp(message.timestamp) === usableTimestamp,
    );
    const timestampAndSnippetMatch = snippet
      ? timestampMatches.find((message) => String(message.content ?? '').toLowerCase().includes(snippet))
      : timestampMatches[0];

    if (timestampAndSnippetMatch) {
      return { message: timestampAndSnippetMatch, shouldLoadHistory: false };
    }

    // An outline item with an empty snippet intentionally relies on its
    // timestamp alone. Prefer that exact match over loading the full history.
    if (timestampMatches[0]) {
      return { message: timestampMatches[0], shouldLoadHistory: false };
    }

    // The same prompt can occur more than once in a long conversation. When
    // the outline supplies a timestamp, a snippet-only match would jump to a
    // different turn and incorrectly suppress the history request.
    return { message: null, shouldLoadHistory: true };
  }

  if (snippet.length >= 10) {
    const snippetMatch = userMessages.find(
      (message) => String(message.content ?? '').toLowerCase().includes(snippet),
    );
    if (snippetMatch) {
      return { message: snippetMatch, shouldLoadHistory: false };
    }
  }

  return { message: null, shouldLoadHistory: true };
}
