import { useEffect, useRef } from 'react';
import { ArrowDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Per-dot animation offsets. The stagger is what reads as motion rather than a row of dots. */
const THINKING_DOT_DELAYS = ['0ms', '150ms', '300ms'];

/**
 * How long after a touch press the button treats any further event as part of
 * that same press. WebKit delivers a resting tap's `click` a few hundred
 * milliseconds after the touch, and delivers `pointerdown` and `touchstart` for
 * the same finger a moment apart; without a window both would double-fire.
 */
const TOUCH_PRESS_WINDOW_MS = 700;

type ScrollToBottomAffordanceProps = {
  /**
   * True while the turn is visibly running and not blocked on a permission
   * prompt. ChatInterface feeds it `hasActivityIndicator`, which is the same
   * condition that shows the composer's activity bar — there is deliberately no
   * `isThinking` state anywhere, the name is local to this prop.
   */
  isThinking: boolean;
  onScrollToBottom: () => void;
};

/**
 * Rendered by chat's ChatInterface above the composer. It is the sole way back to
 * the bottom once the user has scrolled away, so its accessible name describes the
 * action and never changes; the glyph only reports whether the turn is still running.
 *
 * A press that lands while the transcript is still coasting is answered from the
 * touch itself rather than from `click`: WebKit spends that touch on stopping the
 * scroll view — "brake first" — and never synthesizes the click, which left the
 * button inert until the pane came to rest.
 */
export default function ScrollToBottomAffordance({ isThinking, onScrollToBottom }: ScrollToBottomAffordanceProps) {
  const { t } = useTranslation('chat');
  const label = t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' });
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Timestamp of the last touch that already asked for the tail, so the rest of
  // that one press (`touchstart` after `pointerdown`, then the click) is folded
  // into a single request instead of repeating it.
  const lastTouchPressAtRef = useRef(0);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;

    const requestTail = (): void => {
      const now = Date.now();
      if (now - lastTouchPressAtRef.current < TOUCH_PRESS_WINDOW_MS) return;
      lastTouchPressAtRef.current = now;
      onScrollToBottom();
    };
    // Bound twice because which of the two survives deceleration differs between
    // WebKit releases; the window above makes the pair harmless.
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') requestTail();
    };

    button.addEventListener('pointerdown', handlePointerDown);
    button.addEventListener('touchstart', requestTail, { passive: true });
    return () => {
      button.removeEventListener('pointerdown', handlePointerDown);
      button.removeEventListener('touchstart', requestTail);
    };
  }, [onScrollToBottom]);

  const handleClick = (): void => {
    // Touch input never reaches here on the tail request: either the press was
    // already served above, or iOS swallowed the click while scrolling.
    if (Date.now() - lastTouchPressAtRef.current < TOUCH_PRESS_WINDOW_MS) return;
    onScrollToBottom();
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={label}
      data-state={isThinking ? 'thinking' : 'idle'}
      className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground"
    >
      {/* Both glyphs stay mounted and share one grid cell so the swap cross-fades
          instead of flashing, and the button never changes size. */}
      <span className="grid place-items-center" aria-hidden>
        <ArrowDownIcon
          className={`col-start-1 row-start-1 h-4 w-4 transition-opacity duration-200 ${
            isThinking ? 'opacity-0' : 'opacity-100'
          }`}
        />
        <span
          className={`col-start-1 row-start-1 flex items-center gap-1 transition-opacity duration-200 ${
            isThinking ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* The animation class is conditional: `opacity-0` does not stop a CSS
              animation, so an always-on row would keep three infinite transforms
              running while idle. The cross-fade is a separate transition and is
              unaffected. */}
          {THINKING_DOT_DELAYS.map(delay => (
            <span
              key={delay}
              style={{ animationDelay: delay }}
              className={`h-1 w-1 rounded-full bg-current ${isThinking ? 'animate-dot-bounce' : ''}`}
            />
          ))}
        </span>
      </span>
    </button>
  );
}
