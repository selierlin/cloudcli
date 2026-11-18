import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';

/**
 * Roughly ten lines of the question bubble's prose-sm body (14px type at a
 * 24px line box). Anything shorter keeps its full height: folding it would cost
 * a click and save nothing.
 */
const FOLD_THRESHOLD_PX = 244;

/**
 * Roughly eight lines stay visible while folded — the opening of the question
 * is recognisable, but a pasted log or stack trace no longer pushes the answer
 * off the screen.
 */
const FOLDED_VISIBLE_HEIGHT_PX = 196;

/** Slack for sub-pixel line boxes deciding whether a question crosses the threshold. */
const MEASURE_EPSILON_PX = 1;

type CollapsibleUserMessageProps = {
  /** The rendered question body, folded as a block. */
  children: ReactNode;
  /**
   * False while the transcript is turned into an exported document, which has
   * no reader to expand it and must therefore carry the whole question.
   */
  enabled?: boolean;
};

/**
 * Used by MessageComponent to keep a long question from taking over the
 * transcript: questions taller than the threshold start folded and the reader
 * unfolds them in place.
 *
 * The folded state is intentionally not persisted. A reload, a session switch
 * or a remount starts folded again, which is the state the feature exists for.
 *
 * The disabled branch deliberately calls no hooks. The export document is
 * produced in the browser through `renderToStaticMarkup`, which renders this
 * component with `enabled={false}`; a layout effect there would make React warn
 * once per question and could not measure anything anyway.
 */
export function CollapsibleUserMessage({ children, enabled = true }: CollapsibleUserMessageProps) {
  if (!enabled) {
    return <>{children}</>;
  }

  return <FoldableUserMessageBody>{children}</FoldableUserMessageBody>;
}

/**
 * The live-transcript half of CollapsibleUserMessage. Client-only, which is
 * what makes its layout effect safe: the fold state has to be decided before
 * the browser paints, or every short question would flash its "show full
 * message" toggle and fade for one frame.
 */
function FoldableUserMessageBody({ children }: { children: ReactNode }) {
  const { t } = useTranslation('chat');
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Starts false so the first paint is already folded: measuring first would
  // paint a pasted log at full height and snap it shut a frame later. A short
  // question is released by the layout effect below, before the browser paints,
  // so it never shows the folded toggle and fade at all.
  const [fitsWithoutFold, setFitsWithoutFold] = useState(false);
  // The reader's own expansion. A transient UI state, not a preference: see
  // the note above about reloads.
  const [isExpanded, setIsExpanded] = useState(false);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return undefined;
    }
    const measure = () => {
      // scrollHeight still reports the whole question while max-height clips
      // it, so the value is the same folded or unfolded.
      setFitsWithoutFold(element.scrollHeight <= FOLD_THRESHOLD_PX + MEASURE_EPSILON_PX);
    };
    measure();
    // A wider window reflows the text and can drop it below the threshold
    // without any React render; observing the box catches that.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  const isFolded = !isExpanded && !fitsWithoutFold;
  const foldedStyle: CSSProperties | undefined = isFolded
    ? {
        maxHeight: `${FOLDED_VISIBLE_HEIGHT_PX}px`,
        // Fade the cut instead of slicing a line in half. A mask, unlike a
        // gradient overlay, leaves the bubble's translucent background intact.
        maskImage: 'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)',
      }
    : undefined;

  return (
    <>
      <div
        ref={contentRef}
        data-user-message-body=""
        style={foldedStyle}
        className={isFolded ? 'overflow-hidden' : undefined}
      >
        {children}
      </div>
      {!fitsWithoutFold && (
        <button
          type="button"
          onClick={() => setIsExpanded((previous) => !previous)}
          aria-expanded={isExpanded}
          className="mt-1 flex w-full select-none items-center justify-center gap-1 rounded-md py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronUpIcon className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {isExpanded ? t('message.collapseLongMessage') : t('message.expandLongMessage')}
        </button>
      )}
    </>
  );
}
