import { AlertTriangle, Loader2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { SessionAttentionLevel } from '@/shared/types';

/**
 * The two independent state channels a session row draws, split into slots so
 * every host layout — the Projects desktop row, its compact card and the
 * Conversations row — composes one implementation instead of forking it.
 *
 * `ActivitySlot` owns the left edge and only ever answers "is it doing
 * something?" (transient, disappears on its own). `AttentionSlot` owns the
 * right edge and only ever answers "is something waiting on me?" (sticky,
 * survives until the user opens or resolves it). The two are orthogonal: a row
 * can carry both at once, which is the whole reason they are separate slots.
 */

type ActivitySlotProps = {
  /** A foreground turn is in flight. Wins over background work when both hold. */
  isProcessing: boolean;
  /** Only background agents, workflows or commands are still running. */
  hasBackgroundWork: boolean;
  /** The row's session is open in the chat view, whose content already shows the activity. */
  isSelected: boolean;
  /** The horizontal inset of the hanging dot; hosts differ only in their left padding. */
  className?: string;
  t: TFunction;
};

/**
 * The sidebar's left-edge activity indicator, drawn by the Projects and
 * Conversations session rows and their compact/mobile variants.
 */
export function ActivitySlot({ isProcessing, hasBackgroundWork, isSelected, className, t }: ActivitySlotProps) {
  if (isSelected || (!isProcessing && !hasBackgroundWork)) {
    return null;
  }

  const label = isProcessing
    ? t('tooltips.processingSessionIndicator', { defaultValue: 'Processing session' })
    : t('tooltips.backgroundWorkIndicator', { defaultValue: 'Background work running' });

  return (
    <div className={cn('absolute top-1/2 -translate-y-1/2 transform', className)}>
      <Tooltip content={label} position="right">
        {isProcessing ? (
          <span role="status" aria-label={label} className="flex h-2.5 w-2.5 items-center justify-center">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground motion-reduce:animate-none" />
          </span>
        ) : (
          <span
            role="status"
            aria-label={label}
            className="block h-2 w-2 animate-pulse rounded-full bg-purple-500 motion-reduce:animate-none dark:bg-purple-400"
          />
        )}
      </Tooltip>
    </div>
  );
}

type AttentionSlotProps = {
  /** How strongly to flag the unread event, or undefined when nothing awaits the user. */
  level?: SessionAttentionLevel;
  /** The row's session is open in the chat view, which clears its attention. */
  isSelected: boolean;
  t: TFunction;
};

/**
 * The sidebar's right-edge unread indicator, drawn by the Projects and
 * Conversations session rows and their compact/mobile variants. The amber
 * capsule (needs you) and the blue dot (new activity) differ in shape, not
 * only in colour, so they stay apart without relying on the palette.
 */
export function AttentionSlot({ level, isSelected, t }: AttentionSlotProps) {
  if (!level || isSelected) {
    return null;
  }

  if (level === 'notice') {
    const noticeLabel = t('tooltips.attentionNoticeIndicator', { defaultValue: 'New activity in this session' });
    return (
      <Tooltip content={noticeLabel} position="top">
        <span
          role="status"
          aria-label={noticeLabel}
          // `block` is load-bearing: Tooltip wraps this in an inline-block div
          // that does not blockify it, so a bare inline span would ignore
          // `h-2 w-2` and collapse to nothing.
          className="block h-2 w-2 flex-shrink-0 rounded-full bg-blue-500 dark:bg-blue-400"
        />
      </Tooltip>
    );
  }

  const actionLabel = t('tooltips.attentionActionIndicator', { defaultValue: 'Session needs your action' });
  return (
    <Tooltip content={actionLabel} position="top">
      <span
        role="status"
        aria-label={actionLabel}
        className="flex h-4 flex-shrink-0 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 text-amber-950 motion-reduce:animate-none"
      >
        <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
