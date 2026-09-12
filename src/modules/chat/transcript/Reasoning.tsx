import * as React from 'react';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';

import type { ReasoningDisclosureState } from '@/shared/types';
import { cn } from '@/shared/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Shimmer } from '@/shared/ui';

/* ─── Context ────────────────────────────────────────────────────── */

type ReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
};

const ReasoningContext = React.createContext<ReasoningContextValue | null>(null);

const useReasoning = () => {
  const context = React.useContext(ReasoningContext);
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning');
  }
  return context;
};

/* ─── Reasoning (root) ───────────────────────────────────────────── */

const AUTO_CLOSE_DELAY_MS = 2500;
const DESKTOP_HANDOFF_SETTLE_MS = 350;
const DESKTOP_MINIMUM_VISIBLE_MS = 900;
const TOUCH_HANDOFF_SETTLE_MS = 450;
const TOUCH_MINIMUM_VISIBLE_MS = 1200;
const TOUCH_POINTER_QUERY = '(hover: none) and (pointer: coarse)';

function useReasoningHandoffProfile(): { settleMs: number; minimumVisibleMs: number } {
  const readIsTouchPrimary = React.useCallback(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(TOUCH_POINTER_QUERY).matches
  ), []);
  // Tracks primary input capability so handoff pacing adapts when a tablet gains or loses a pointer.
  const [isTouchPrimary, setIsTouchPrimary] = React.useState(readIsTouchPrimary);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(TOUCH_POINTER_QUERY);
    const update = () => setIsTouchPrimary(mediaQuery.matches);
    mediaQuery.addEventListener?.('change', update);
    return () => mediaQuery.removeEventListener?.('change', update);
  }, []);

  return isTouchPrimary
    ? { settleMs: TOUCH_HANDOFF_SETTLE_MS, minimumVisibleMs: TOUCH_MINIMUM_VISIBLE_MS }
    : { settleMs: DESKTOP_HANDOFF_SETTLE_MS, minimumVisibleMs: DESKTOP_MINIMUM_VISIBLE_MS };
}

function selectionIntersects(element: HTMLElement | null): boolean {
  const selection = window.getSelection();
  if (!element || !selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    try {
      if (selection.getRangeAt(index).intersectsNode(element)) return true;
    } catch {
      // A selection can detach between selectionchange and this frame.
    }
  }
  return false;
}

export type ReasoningProps = {
  isStreaming?: boolean;
  handoffSequence?: number;
  finalAnswerStarted?: boolean;
  isAutoCollapseCandidate?: boolean;
  isSupersededThinking?: boolean;
  toolActivityStarted?: boolean;
  suppressAutoCollapse?: boolean;
  disclosureState?: ReasoningDisclosureState;
  onUserOpenChange?: (open: boolean) => void;
  onProgramOpen?: () => void;
  onProgramCollapse?: () => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
} & React.HTMLAttributes<HTMLDivElement>;

/** Discloses an assistant turn's reasoning text; used by MessageComponent. */
export const Reasoning = React.memo<ReasoningProps>(
  ({
    className,
    isStreaming = false,
    handoffSequence = 0,
    finalAnswerStarted = false,
    isAutoCollapseCandidate = false,
    isSupersededThinking = false,
    toolActivityStarted = false,
    suppressAutoCollapse = false,
    disclosureState,
    onUserOpenChange,
    onProgramOpen,
    onProgramCollapse,
    open: controlledOpen,
    defaultOpen,
    onOpenChange,
    onPointerEnter,
    onPointerLeave,
    onFocus,
    onBlur,
    duration: durationProp,
    children,
    ...props
  }) => {
    const resolvedDefaultOpen = defaultOpen ?? isStreaming;
    const handoffProfile = useReasoningHandoffProfile();
    // Local fallback keeps embedded, non-registry reasoning disclosures usable.
    const [internalOpen, setInternalOpen] = React.useState(resolvedDefaultOpen);
    const registryOpen = disclosureState?.ownership === 'user_open'
      || (disclosureState?.ownership === 'auto'
        && (isStreaming || !disclosureState.autoCollapsed));
    const isOpen = controlledOpen ?? (disclosureState ? registryOpen : internalOpen);
    const handleUserOpenChange = React.useCallback(
      (next: boolean) => {
        if (controlledOpen === undefined && !disclosureState) setInternalOpen(next);
        onUserOpenChange?.(next);
        onOpenChange?.(next);
      },
      [controlledOpen, disclosureState, onOpenChange, onUserOpenChange],
    );

    const duration = durationProp ?? disclosureState?.visibleDurationSeconds;
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    // Hover pauses programmatic layout changes while the pointer is reading this block.
    const [isPointerInside, setIsPointerInside] = React.useState(false);
    // Focus protects keyboard users interacting with the disclosure.
    const [containsFocus, setContainsFocus] = React.useState(false);
    // Selection protects mouse and touch text selection crossing this block.
    const [hasIntersectingSelection, setHasIntersectingSelection] = React.useState(false);
    const canProgrammaticallyChange = disclosureState?.ownership === 'auto';
    const hasReadingGuard = suppressAutoCollapse
      || isPointerInside
      || containsFocus
      || hasIntersectingSelection;
    const mayProgrammaticallyCollapse = Boolean(
      isAutoCollapseCandidate || isSupersededThinking || toolActivityStarted,
    );

    // Streaming can reopen an automatically managed block, never a user-owned one.
    React.useEffect(() => {
      if (isStreaming && canProgrammaticallyChange && disclosureState?.autoCollapsed) {
        onProgramOpen?.();
      }
    }, [canProgrammaticallyChange, disclosureState?.autoCollapsed, isStreaming, onProgramOpen]);

    React.useEffect(() => {
      if (!mayProgrammaticallyCollapse || !canProgrammaticallyChange || !isOpen) return undefined;
      let animationFrame: number | null = null;
      const updateSelection = () => {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(() => {
          animationFrame = null;
          setHasIntersectingSelection(selectionIntersects(rootRef.current));
        });
      };
      document.addEventListener('selectionchange', updateSelection);
      updateSelection();
      return () => {
        document.removeEventListener('selectionchange', updateSelection);
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      };
    }, [canProgrammaticallyChange, isOpen, mayProgrammaticallyCollapse]);

    // Activity handoffs wait for a stable successor and guarantee a minimum
    // visible lifetime. A newer segment changes handoffSequence, cancelling
    // and replacing this timer instead of producing a cascade of collapses.
    React.useEffect(() => {
      if (
        (isSupersededThinking || toolActivityStarted)
        && canProgrammaticallyChange
        && isOpen
        && !hasReadingGuard
      ) {
        const visibleStartedAtMs = disclosureState?.visibleStartedAtMs;
        const visibleForMs = visibleStartedAtMs === undefined
          ? handoffProfile.minimumVisibleMs
          : Math.max(0, Date.now() - visibleStartedAtMs);
        const remainingMinimumMs = Math.max(0, handoffProfile.minimumVisibleMs - visibleForMs);
        const delayMs = Math.max(handoffProfile.settleMs, remainingMinimumMs);
        const timer = window.setTimeout(() => onProgramCollapse?.(), delayMs);
        return () => window.clearTimeout(timer);
      }
      return undefined;
    }, [
      canProgrammaticallyChange,
      disclosureState?.visibleStartedAtMs,
      handoffProfile.minimumVisibleMs,
      handoffProfile.settleMs,
      hasReadingGuard,
      handoffSequence,
      isOpen,
      isSupersededThinking,
      onProgramCollapse,
      toolActivityStarted,
    ]);

    // Final prose gets a full reading window before the thinking block yields.
    React.useEffect(() => {
      if (
        !finalAnswerStarted
        || !isAutoCollapseCandidate
        || !canProgrammaticallyChange
        || !isOpen
        || hasReadingGuard
        || toolActivityStarted
      ) return undefined;
      const timer = window.setTimeout(() => onProgramCollapse?.(), AUTO_CLOSE_DELAY_MS);
      return () => window.clearTimeout(timer);
    }, [
      canProgrammaticallyChange,
      finalAnswerStarted,
      hasReadingGuard,
      isAutoCollapseCandidate,
      isOpen,
      onProgramCollapse,
      toolActivityStarted,
    ]);

    const contextValue = React.useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen: handleUserOpenChange }),
      [duration, handleUserOpenChange, isOpen, isStreaming],
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          ref={rootRef}
          open={isOpen}
          onOpenChange={handleUserOpenChange}
          onPointerEnter={(event) => {
            setIsPointerInside(true);
            onPointerEnter?.(event);
          }}
          onPointerLeave={(event) => {
            setIsPointerInside(false);
            onPointerLeave?.(event);
          }}
          onFocus={(event) => {
            setContainsFocus(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setContainsFocus(false);
            onBlur?.(event);
          }}
          className={cn('not-prose', className)}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  }
);
Reasoning.displayName = 'Reasoning';

/* ─── ReasoningTrigger ───────────────────────────────────────────── */

export type ReasoningTriggerProps = {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number): React.ReactNode => {
  if (isStreaming || duration === 0) {
    return <Shimmer>Thinking...</Shimmer>;
  }
  if (duration === undefined) {
    return <p>Thought for a few seconds</p>;
  }
  return <p>Thought for {duration} seconds</p>;
};

/** Toggle of Reasoning, used by MessageComponent. */
export const ReasoningTrigger = React.memo<ReasoningTriggerProps>(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }) => {
    const { isStreaming, isOpen, duration } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <BrainIcon className="h-4 w-4" />
            {getThinkingMessage(isStreaming, duration)}
            <ChevronDownIcon
              className={cn(
                'h-4 w-4 transition-transform',
                isOpen ? 'rotate-180' : 'rotate-0'
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  }
);
ReasoningTrigger.displayName = 'ReasoningTrigger';

/* ─── ReasoningContent ───────────────────────────────────────────── */

export type ReasoningContentProps = {
  children: React.ReactNode;
  /** Defers expensive children until the reasoning panel is opened once. */
  lazyMount?: boolean;
} & React.HTMLAttributes<HTMLDivElement>;

/** Body of Reasoning, used by MessageComponent. */
export const ReasoningContent = React.memo<ReasoningContentProps>(
  ({ className, children, lazyMount = false, style, ...props }) => {
    const { isOpen } = useReasoning();
    const [hasOpened, setHasOpened] = React.useState(isOpen);

    React.useEffect(() => {
      if (isOpen) {
        setHasOpened(true);
      }
    }, [isOpen]);

    const shouldRenderChildren = !lazyMount || isOpen || hasOpened;

    return (
      <CollapsibleContent
        className={cn(
          'reasoning-collapse-content mt-4 text-sm text-muted-foreground',
          isOpen ? 'opacity-100' : 'opacity-0',
          className,
        )}
        style={{
          ...style,
          transitionDuration: 'var(--reasoning-collapse-duration), var(--reasoning-fade-duration)',
          transitionProperty: 'grid-template-rows, opacity',
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        {...props}
      >
        {shouldRenderChildren ? children : null}
      </CollapsibleContent>
    );
  }
);
ReasoningContent.displayName = 'ReasoningContent';
