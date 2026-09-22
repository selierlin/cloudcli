import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { CornerDownLeft, CornerDownRight } from 'lucide-react';

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
 * top has crossed the panel top edge owns the pinned header (mirroring the
 * proven execution-process sticky mechanism, consistent on WebKit too). The
 * header shows the full original prompt, not a summary. While the current
 * row itself spans the top edge the button stays mounted but invisible: its
 * flow slot must never shift the rows it measures, or the detection feeds
 * back into itself and flickers.
 */
export default function UserMessageStickyHeader({
  anchorTexts,
}: UserMessageStickyHeaderProps) {
  const headerRef = useRef<HTMLButtonElement | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  // True while the anchor's own row spans the panel top edge (it is arriving
  // back into view). The button then only turns visually invisible instead of
  // unmounting: a mount/unmount swap removes the header's ~40px flow slot and
  // shifts every row below by that height, which re-crosses the very bridging
  // threshold being measured and makes the header oscillate (visible flicker).
  // Keeping the slot makes the hide/show purely visual, so geometry cannot
  // feed back into the detection — same principle as the execution-process
  // sticky summary, which also never unmounts mid-scroll.
  const [isBridging, setIsBridging] = useState(false);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const container = header?.closest<HTMLElement>('.chat-messages-pane');
    if (!header || !container) {
      return;
    }

    const updateCurrent = () => {
      const paneTop = container.getBoundingClientRect().top;
      // The header is a stand-in for a user message that has fully scrolled off
      // the top of the viewport. As soon as that message's own row starts to
      // span the panel top edge (`top <= paneTop < bottom`) it is arriving back,
      // so the stand-in steps aside and lets the real row take over.
      let bridging = false;
      let nextKey: string | null = null;
      let closestBottom = Number.NEGATIVE_INFINITY;
      container.querySelectorAll<HTMLElement>('[data-user-anchor]').forEach((row) => {
        const key = row.dataset.userAnchor;
        if (!key) return;
        const rect = row.getBoundingClientRect();
        if (rect.top <= paneTop) {
          if (rect.bottom > paneTop) {
            bridging = true;
          } else if (rect.bottom > closestBottom) {
            closestBottom = rect.bottom;
            nextKey = key;
          }
        }
      });
      if (bridging) {
        // The arriving row takes over visually; the pinned key is retained so
        // the invisible button keeps showing this section's text and its flow
        // slot, releasing only once the row has fully arrived (key -> earlier
        // anchor) or fully rescrolled off (key -> the row itself).
        setIsBridging(true);
      } else {
        setIsBridging(false);
        setCurrentKey((current) => (current === nextKey ? current : nextKey));
      }
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
  if (!text) {
    // Nothing crossed the top edge yet: no header. It mounts at zero height so
    // the first anchor has not pinned anything. Swapping between this and the
    // visible button cannot re-flip the bridging measurement: while scrolling
    // down, the key is only claimed once every anchor is already below the
    // top edge, and the visible slot's height pushes those rows further away
    // from it. Upward, the slot is released only when no row spans the edge,
    // and the freed 40px at most nudges one onto the edge — the header is
    // already zero-height there, so nothing oscillates.
    return <button type="button" ref={headerRef} className="sr-only" aria-hidden="true" />;
  }

  const pinClass = 'sticky -top-3 sm:-top-4 z-20';
  // Visual-only hide while the real row spans the panel top edge: the slot,
  // sticky pin and full button height all stay in place so no sibling row
  // moves and the bridging measurement above stays stable.
  const bridgedClass = isBridging ? 'invisible pointer-events-none' : '';

  return (
    <button
      ref={headerRef}
      type="button"
      onClick={handleJump}
      title="回到这条提问"
      tabIndex={isBridging ? -1 : undefined}
      className={`mb-2 flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white/95 px-3 py-2 text-left shadow-sm backdrop-blur-sm transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/95 dark:hover:bg-gray-800 ${pinClass} ${bridgedClass}`}
    >
      <CornerDownLeft aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700 dark:text-gray-200">
        {text}
      </span>
      <CornerDownRight
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500"
      />
    </button>
  );
}