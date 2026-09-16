import type { ChatMessage, TranscriptSegment } from '@/shared/types';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';
import {
  isAssistantTextFocusCandidate,
  isVisibleUserTurnStart,
  projectTranscriptTurns,
} from '@/modules/chat/utils/transcriptProjection';

export type ExecutionTailClosure = 'closed_live' | 'deferred_live';

export type ExecutionProcessGroup = {
  /** The user-message anchor, absent while the visible window starts mid-turn. */
  turnKey?: string;
  /** Stable UI identity: user key for a full turn, focus key for a truncated one. */
  disclosureKey: string;
  /** Temporary truncated identities this full turn absorbs after pagination. */
  disclosureAliases: string[];
  isWindowTruncated: boolean;
  memberKeys: Set<string>;
  firstMemberKey: string;
  hasAttention: boolean;
  hasActiveSegments: boolean;
  /** Reasoning-only stages use a quieter label; every other process stage is execution. */
  labelKind: 'reasoning' | 'execution';
  toolCount: number;
  /** Program default only; a user-owned disclosure always overrides it. */
  defaultCollapsed: boolean;
};

export type ExecutionProcessProjection = {
  groups: Map<string, ExecutionProcessGroup>;
  memberDisclosureKeys: Map<string, string>;
};

export type ExecutionProcessOptions = {
  isProcessing: boolean;
  /** True for the render between a live run ending and its closure decision committing. */
  isLiveCompletionPending: boolean;
  tailClosures: Record<string, ExecutionTailClosure>;
};

export { isAssistantTextFocusCandidate, isVisibleUserTurnStart };

/** Finds the user anchor for the only turn that may still be live at the tail. */
export function getRightmostVisibleTurnKey(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isVisibleUserTurnStart(message)) {
      return getIntrinsicMessageKey(message);
    }
  }
  return null;
}

function isProcessSegment(segment: TranscriptSegment): boolean {
  return segment.kind !== 'answer';
}

function registerGroup(
  groups: Map<string, ExecutionProcessGroup>,
  memberDisclosureKeys: Map<string, string>,
  group: ExecutionProcessGroup,
): void {
  groups.set(group.disclosureKey, group);
  group.memberKeys.forEach((memberKey) => memberDisclosureKeys.set(memberKey, group.disclosureKey));
}

/**
 * Projects visible transcript rows without requiring the page to include the
 * user anchor for a completed turn. Existing rows remain in their original
 * order; callers only use this result to control visibility and summaries.
 */
export function deriveExecutionProcessProjection(
  messages: ChatMessage[],
  getMessageKey: (message: ChatMessage) => string,
  options: ExecutionProcessOptions,
): ExecutionProcessProjection {
  const groups = new Map<string, ExecutionProcessGroup>();
  const memberDisclosureKeys = new Map<string, string>();
  const turns = projectTranscriptTurns(messages, getMessageKey).turns;

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex];
    let stageMembers: TranscriptSegment[] = [];
    let stageStartOffset = 0;

    const registerStage = (
      members: TranscriptSegment[],
      disclosureKey: string,
      aliases: string[],
      isWindowTruncated: boolean,
      boundaryClosed: boolean,
    ) => {
      if (members.length === 0) return;
      const hasAttention = members.some((segment) => segment.lifecycle === 'attention');
      const hasActiveSegments = members.some((segment) => segment.lifecycle === 'active');
      const toolCount = members.filter((segment) => segment.kind === 'tool').length;
      registerGroup(groups, memberDisclosureKeys, {
        disclosureKey,
        disclosureAliases: aliases,
        isWindowTruncated,
        memberKeys: new Set(members.map((segment) => segment.id)),
        firstMemberKey: members[0].id,
        hasAttention,
        hasActiveSegments,
        labelKind: members.every((segment) => segment.kind === 'reasoning')
          ? 'reasoning'
          : 'execution',
        toolCount,
        defaultCollapsed: boundaryClosed && !hasAttention && !hasActiveSegments,
      });
    };

    for (const [segmentOffset, segment] of turn.segments.entries()) {
      if (segment.kind !== 'answer') {
        if (stageMembers.length === 0) stageStartOffset = segmentOffset;
        stageMembers.push(segment);
        continue;
      }

      const members = stageMembers.filter(isProcessSegment);
      if (members.length > 0) {
        const disclosureKey = `process:before:${segment.id}`;
        registerStage(
          members,
          disclosureKey,
          [`process:tail:${members[0].id}`],
          turn.boundary === 'partial' && stageStartOffset === 0,
          segment.lifecycle === 'complete',
        );
      }
      stageMembers = [];
      stageStartOffset = segmentOffset + 1;
    }

    const trailingMembers = stageMembers.filter(isProcessSegment);
    if (trailingMembers.length === 0) continue;

    const turnKey = turn.userMessage ? getIntrinsicMessageKey(turn.userMessage) : null;
    const isRightmostTurn = turnIndex === turns.length - 1;
    const disclosureKey = `process:tail:${trailingMembers[0].id}`;
    const tailClosure = options.tailClosures[disclosureKey]
      ?? (turnKey ? options.tailClosures[turnKey] : undefined);
    const isLiveTail = isRightmostTurn && (
      options.isProcessing || options.isLiveCompletionPending || tailClosure !== undefined
    );
    const mayCloseTail = tailClosure !== 'deferred_live' && (
      !isLiveTail
      || tailClosure === 'closed_live'
      || (!options.isProcessing && !options.isLiveCompletionPending && tailClosure === undefined)
    );
    registerStage(
      trailingMembers,
      disclosureKey,
      turnKey ? [turnKey] : [],
      turn.boundary === 'partial' && stageStartOffset === 0,
      mayCloseTail,
    );
  }

  return { groups, memberDisclosureKeys };
}
