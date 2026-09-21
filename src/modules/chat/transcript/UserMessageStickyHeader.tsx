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
 * header shows the full original prompt, not a summary.
 */
export default function UserMessageStickyHeader({
  anchorTexts,
}: UserMessageStickyHeaderProps) {
  const headerRef = useRef<HTMLButtonElement | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);

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
      const resolved = bridging ? null : nextKey;
      setCurrentKey((current) => (current === resolved ? current : resolved));
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
    // the first anchor has not pinned anything.
    return <button type="button" ref={headerRef} className="sr-only" aria-hidden="true" />;
  }

  const pinClass = 'sticky -top-3 sm:-top-4 z-20';

  return (
    <button
      ref={headerRef}
      type="button"
      onClick={handleJump}
      title="回到这条提问"
      className={`mb-2 flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white/95 px-3 py-2 text-left shadow-sm backdrop-blur-sm transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/95 dark:hover:bg-gray-800 ${pinClass}`}
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