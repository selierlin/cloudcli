import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { CornerDownLeft, CornerDownRight } from 'lucide-react';

/**
 * Extra overlap a row must clear before the band comes back, once it has given
 * way. A phone hands back scroll offsets that wander by a pixel or two, and
 * without a dead band the row's top edge sits exactly on the threshold through
 * that wander: the band then flips shown/hidden/shown within 30 ms, which reads
 * as a flicker rather than as the message arriving.
 */
const BRIDGING_HYSTERESIS_PX = 4;

type UserMessageStickyHeaderProps = {
  /** Full text of every anchorable user message, keyed by message key. */
  anchorTexts: Map<string, string>;
};

/**
 * Sticky section header for long conversations: while reading a turn's
 * assistant reply, the user message that started the turn is pinned so the
 * reader always knows which prompt the long text belongs to. It swaps to the
 * next user message once that reply is scrolled past, stays hidden before the
 * first anchor, and (being a button) scrolls straight back to the underlying
 * user message when clicked.
 *
 * Which user message is "current" is decided with JS: the last anchor row whose
 * bottom has crossed the panel top edge owns the pinned header (mirroring the
 * proven execution-process sticky mechanism, consistent on WebKit too). The
 * header shows the full original prompt, not a summary.
 *
 * The band lives in a zero-height sticky layer, so it is pure overlay: showing
 * or hiding it can never change the height of the transcript it measures. An
 * in-flow slot (the earlier design) did exactly that — every swap moved every
 * row by the slot height, which re-crossed the threshold that had just decided
 * the swap — and it also parked a permanent 46px gap under the band.
 *
 * Because it now covers the first ~22px of whatever scrolls beneath it, the
 * band also steps aside while a real question row overlaps that strip: the
 * arriving message must speak for itself rather than be covered by the
 * stand-in for the section above it. That is what makes the band disappear as
 * soon as the reader scrolls back to a prompt, instead of re-appearing on top
 * of it.
 */
export default function UserMessageStickyHeader({
  anchorTexts,
}: UserMessageStickyHeaderProps) {
  const headerRef = useRef<HTMLButtonElement | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  // True while a question row sits under the band's covered strip. The button
  // then hides but stays mounted: the scroll listener resolves its container
  // through this node, so unmounting would end the measurement.
  const [isBridging, setIsBridging] = useState(false);
  // Mirrors `isBridging` for the scroll listener: comparing against the current
  // state is what makes the threshold asymmetric.
  const bridgingRef = useRef(false);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const container = header?.closest<HTMLElement>('.chat-messages-pane');
    if (!header || !container) {
      return;
    }

    const updateCurrent = () => {
      const paneTop = container.getBoundingClientRect().top;
      // The strip the band covers, read from its own box rather than a
      // hard-coded height so a style change cannot desync the two. This is
      // safe to derive from the band: the band no longer takes part in layout,
      // so hiding it cannot move any row and cannot feed back into this read.
      const coverBottom = Math.max(header.getBoundingClientRect().bottom, paneTop);
      // Once the band has stepped aside, the row has to clear the strip by a
      // few pixels before the band may come back — otherwise the row's edge
      // sitting on the threshold makes the two states trade places every frame.
      const revealBelow = bridgingRef.current
        ? coverBottom + BRIDGING_HYSTERESIS_PX
        : coverBottom;
      let coveringKey: string | null = null;
      let nextKey: string | null = null;
      let closestBottom = Number.NEGATIVE_INFINITY;
      container.querySelectorAll<HTMLElement>('[data-user-anchor]').forEach((row) => {
        const key = row.dataset.userAnchor;
        if (!key) return;
        const rect = row.getBoundingClientRect();
        if (rect.bottom <= paneTop) {
          // Fully scrolled off: this is the prompt the band names.
          if (rect.bottom > closestBottom) {
            closestBottom = rect.bottom;
            nextKey = key;
          }
        } else if (rect.top < revealBelow) {
          // The row itself is arriving under the band: hand the section back to
          // the real message instead of covering its top edge.
          coveringKey = key;
        }
      });
      bridgingRef.current = coveringKey !== null;
      setIsBridging(coveringKey !== null);
      setCurrentKey(coveringKey ?? nextKey);
    };

    container.addEventListener('scroll', updateCurrent, { passive: true });
    window.addEventListener('resize', updateCurrent);
    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(updateCurrent);
    observer?.observe(container);
    updateCurrent();

    return () => {
      container.removeEventListener('scroll', updateCurrent);
      window.removeEventListener('resize', updateCurrent);
      observer?.disconnect();
    };
  }, []);

  const handleJump = useCallback(() => {
    const header = headerRef.current;
    const container = header?.closest<HTMLElement>('.chat-messages-pane');
    if (!container || !currentKey) {
      return;
    }
    const target = container.querySelector<HTMLElement>(
      `[data-user-anchor="${currentKey.replace(/"/g, '\\"')}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('search-highlight-flash');
    window.setTimeout(() => target.classList.remove('search-highlight-flash'), 4000);
  }, [currentKey]);

  const text = currentKey ? anchorTexts.get(currentKey) : undefined;
  const isVisible = Boolean(text) && !isBridging;
  // Read by the scroll diagnostics recorder: the band's three states are
  // otherwise only visible in the class list, and a recording that cannot say
  // shown/hidden/absent per frame cannot explain an oscillation.
  const state = !text ? 'absent' : isBridging ? 'bridging' : 'pinned';

  return (
    // Zero-height sticky layer. `sticky` still pins it (a zero-height box has a
    // well-defined sticky edge), while `h-0` keeps it out of the flow; the
    // negative top offset cancels the pane's own `pt-3`/`pt-4` so the band sits
    // flush on the edge, and the negative margins cancel the parent's
    // `space-y` step, so the layer occupies nothing at all.
    <div className="sticky -top-3 z-20 !-mt-3 h-0 sm:-top-4 sm:!-mt-4">
      <button
        ref={headerRef}
        type="button"
        onClick={isVisible ? handleJump : undefined}
        title={isVisible ? '回到这条提问' : undefined}
        tabIndex={isVisible ? undefined : -1}
        aria-hidden={isVisible ? undefined : true}
        // Band markers for ExecutionProcessSummary: while visibly pinned, this
        // header is a band the process title must stack below. `data-pinned`
        // drops while bridging (the real row is taking over) so the title
        // returns to the panel top for the arriving message.
        data-user-sticky-header={text ? 'true' : undefined}
        data-pinned={isVisible ? 'true' : undefined}
        data-sticky-state={state}
        className={`absolute inset-x-0 top-0 flex w-full items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-left shadow-sm backdrop-blur-[20px] backdrop-saturate-150 transition-colors hover:bg-muted ${
          isVisible ? '' : 'pointer-events-none invisible'
        }`}
      >
        <CornerDownLeft aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-n-gray-400 dark:text-n-gray-500" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-n-gray-700 dark:text-n-gray-200">
          {text}
        </span>
        <CornerDownRight
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-n-gray-400 dark:text-n-gray-500"
        />
      </button>
    </div>
  );
}
