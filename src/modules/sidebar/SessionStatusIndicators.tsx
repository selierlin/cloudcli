import { AlertTriangle, Bell, Circle, Loader2, Pencil } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { SessionAttentionLevel } from '@/shared/types';
import type { ProjectAggregate } from '@/modules/sidebar/utils/projectAggregate';

/**
 * The independent state channels a session row draws, split into slots so every
 * host layout — the Projects desktop row, its compact card and the Conversations
 * row — composes one implementation instead of forking it.
 *
 * `ActivitySlot` owns the left edge and only ever answers "is it doing
 * something?" (transient, disappears on its own). `AttentionSlot` owns the
 * right edge and only ever answers "is something waiting on me?" (sticky,
 * survives until the user opens or resolves it). `DraftSlot` sits beside it and
 * only answers "did I leave something unsent here?" (sticky, survives until the
 * draft is sent or cleared). Each is orthogonal: a row can carry any of them at
 * once, which is the whole reason they are separate slots — and why the draft
 * marker is a pen, not another dot.
 */

type ActivitySlotProps = {
  /** A foreground turn is in flight. Wins over background work when both hold. */
  isProcessing: boolean;
  /** Only background agents, workflows or commands are still running. */
  hasBackgroundWork: boolean;
  /** The horizontal inset of the hanging dot; hosts differ only in their left padding. */
  className?: string;
  t: TFunction;
};

/**
 * The sidebar's left-edge activity indicator, drawn by the Projects and
 * Conversations session rows and their compact/mobile variants. It stays lit
 * on the selected row too: the chat view's own ActivityIndicator sits inside
 * the composer, so without this the open-but-working session reads as idle.
 */
export function ActivitySlot({ isProcessing, hasBackgroundWork, className, t }: ActivitySlotProps) {
  if (!isProcessing && !hasBackgroundWork) {
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

type DraftSlotProps = {
  /** True when the scope holds unsent input (composer text or a queued message). */
  hasDraft: boolean;
  /** The row's session is open, where the composer itself shows the draft. */
  isSelected: boolean;
  t: TFunction;
};

/**
 * The sidebar's "you left something half written here" marker, drawn on the
 * right edge just inside the unread indicator.
 *
 * It is a pen rather than a dot because it answers a different question than the
 * blue dot does: the dot means "something new arrived for you" and clears the
 * instant you open the session, whereas this means "there is an unsent draft"
 * and stays exactly as long as the draft does — opening the session does not
 * consume it, since the composer is where you would finish it.
 */
export function DraftSlot({ hasDraft, isSelected, t }: DraftSlotProps) {
  if (!hasDraft || isSelected) {
    return null;
  }

  const label = t('tooltips.draftIndicator', { defaultValue: 'Unsent draft in this session' });
  return (
    <Tooltip content={label} position="top">
      <span
        role="status"
        aria-label={label}
        className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground"
      >
        <Pencil className="h-3 w-3" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

/** Caps the amber capsule's count so a large project never stretches the row. */
const AGGREGATE_COUNT_CAP = 9;

type ProjectAggregateSlotProps = {
  aggregate: ProjectAggregate | null;
  t: TFunction;
};

/**
 * The project row's aggregate indicator.
 *
 * Every state carries a distinct *shape* — capsule, bell, ring, spinner — not
 * only a colour, because the row has no bold-title dimension to fall back on
 * when colour is unavailable (§3 原则 6 / §12.5). The amber capsule reuses the
 * session row's action shape and adds the count the row's own capsule must
 * not show (D7).
 */
export function ProjectAggregateSlot({ aggregate, t }: ProjectAggregateSlotProps) {
  if (!aggregate) {
    return null;
  }

  if (aggregate.kind === 'action') {
    const label = t('tooltips.projectAggregateAction', {
      count: aggregate.count,
      defaultValue: '{{count}} session(s) in this project need your action',
    });
    return (
      <Tooltip content={label} position="top">
        <span
          role="status"
          aria-label={label}
          className="flex h-4 flex-shrink-0 animate-pulse items-center justify-center gap-0.5 rounded-full bg-amber-500 px-1.5 text-amber-950 motion-reduce:animate-none"
        >
          <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
          <span className="text-[10px] font-semibold tabular-nums">
            {aggregate.count > AGGREGATE_COUNT_CAP ? `${AGGREGATE_COUNT_CAP}+` : aggregate.count}
          </span>
        </span>
      </Tooltip>
    );
  }

  if (aggregate.kind === 'notice') {
    const label = t('tooltips.projectAggregateNotice', { defaultValue: 'New activity in this project' });
    return (
      <Tooltip content={label} position="top">
        <span role="status" aria-label={label} className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <Bell className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" aria-hidden="true" />
        </span>
      </Tooltip>
    );
  }

  if (aggregate.kind === 'foreground') {
    const label = t('tooltips.projectAggregateProcessing', { defaultValue: 'A session in this project is processing' });
    return (
      <Tooltip content={label} position="top">
        <span role="status" aria-label={label} className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
        </span>
      </Tooltip>
    );
  }

  const backgroundLabel = t('tooltips.projectAggregateBackground', { defaultValue: 'Background work running in this project' });
  return (
    <Tooltip content={backgroundLabel} position="top">
      <span role="status" aria-label={backgroundLabel} className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
        <Circle
          className="h-2.5 w-2.5 animate-pulse text-purple-500 motion-reduce:animate-none dark:text-purple-400"
          strokeWidth={3}
          aria-hidden="true"
        />
      </span>
    </Tooltip>
  );
}
