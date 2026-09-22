import type { ChatMessage } from '@/shared/types';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';
import {
  isAssistantTextFocusCandidate,
  isVisibleUserTurnStart,
  projectTranscriptTurns,
} from '@/modules/chat/utils/transcriptProjection';

export type ExecutionProcessGroup = {
  /** The user-message anchor, absent while the visible window starts mid-turn. */
  turnKey?: string;
  /** Stable UI identity for the turn's one ordinary process run. */
  disclosureKey: string;
  /** Earlier partial identities absorbed when pagination reveals more of the turn. */
  disclosureAliases: string[];
  isWindowTruncated: boolean;
  memberKeys: Set<string>;
  attentionKeys: Set<string>;
  firstMemberKey: string;
  hasAttention: boolean;
  hasActiveSegments: boolean;
  isActiveRun: boolean;
  /** The summary distinguishes thinking, tool-backed execution and prose-only process records. */
  labelKind: 'reasoning' | 'execution' | 'narration';
  /** Stable assistant prose rows absorbed once a newer answer supersedes them. */
  narrationKeys: Set<string>;
  /** Streaming reasoning after the visible vanguard prose, shown as the live run's compact activity label. */
  activityLabel?: string;
  toolCount: number;
  /** Ordinary process runs start folded; user and search ownership may reveal them. */
  defaultCollapsed: boolean;
};

export type ExecutionProcessProjection = {
  groups: Map<string, ExecutionProcessGroup>;
  memberDisclosureKeys: Map<string, string>;
};

export type ExecutionProcessOptions = {
  isProcessing: boolean;
};

export { isAssistantTextFocusCandidate, isVisibleUserTurnStart };

function uniqueAliases(disclosureKey: string, aliases: Array<string | undefined>): string[] {
  return [...new Set(aliases.filter((alias): alias is string => Boolean(alias && alias !== disclosureKey)))];
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
 * Projects each visible Turn into at most one ordinary Process Run. The
 * vanguard — the newest answer segment, found by scanning from the tail —
 * remains outside as the visible prose, even while tool activity streams
 * after it; earlier segments keep their original order inside the run
 * instead of becoming a separate stage. Only a newer answer absorbs the
 * vanguard into the run as narration.
 */
export function deriveExecutionProcessProjection(
  messages: ChatMessage[],
  getMessageKey: (message: ChatMessage) => string,
  options: ExecutionProcessOptions,
): ExecutionProcessProjection {
  const groups = new Map<string, ExecutionProcessGroup>();
  const memberDisclosureKeys = new Map<string, string>();
  const turns = projectTranscriptTurns(messages, getMessageKey).turns;

  turns.forEach((turn, turnIndex) => {
    let vanguardIndex = -1;
    for (let index = turn.segments.length - 1; index >= 0; index -= 1) {
      if (turn.segments[index]!.kind === 'answer') {
        vanguardIndex = index;
        break;
      }
    }
    const vanguard = vanguardIndex >= 0 ? turn.segments[vanguardIndex] : undefined;
    const members = vanguard
      ? turn.segments.filter((_, index) => index !== vanguardIndex)
      : turn.segments;
    if (members.length === 0) return;

    const turnKey = turn.userMessage
      ? getIntrinsicMessageKey(turn.userMessage) ?? undefined
      : undefined;
    const firstMemberKey = members[0].id;
    const lastAnswerMember = [...members].reverse().find((segment) => segment.kind === 'answer');
    const partialKey = vanguard
      ? `process:before:${vanguard.id}`
      : `process:tail:${firstMemberKey}`;
    const disclosureKey = turnKey ? `process:turn:${turnKey}` : partialKey;
    const narrationSegments = members.filter((segment) => segment.kind === 'answer');
    // The live label tracks the tail: reasoning that still streams after the
    // visible vanguard prose. The vanguard renders in the transcript, so the
    // summary must not repeat it, and absorbed narration is stale and stays
    // hidden.
    const liveActivitySegment = [...members].reverse().find((segment) => (
      segment.kind === 'reasoning' && Boolean(segment.message.isStreaming)
    ));
    const attentionKeys = new Set(
      members.filter((segment) => segment.lifecycle === 'attention').map((segment) => segment.id),
    );
    const toolCount = members.filter((segment) => segment.kind === 'tool').length;

    registerGroup(groups, memberDisclosureKeys, {
      turnKey,
      disclosureKey,
      disclosureAliases: uniqueAliases(disclosureKey, [
        partialKey,
        `process:tail:${firstMemberKey}`,
        vanguard ? `process:before:${vanguard.id}` : undefined,
        // The superseded vanguard's key survives pagination-style re-keys so a
        // disclosure made while it was visible is not lost.
        lastAnswerMember ? `process:before:${lastAnswerMember.id}` : undefined,
      ]),
      isWindowTruncated: turn.boundary === 'partial',
      memberKeys: new Set(members.map((segment) => segment.id)),
      attentionKeys,
      firstMemberKey,
      hasAttention: attentionKeys.size > 0,
      hasActiveSegments: members.some((segment) => segment.lifecycle === 'active'),
      isActiveRun: turnIndex === turns.length - 1 && options.isProcessing,
      labelKind: toolCount > 0
        ? 'execution'
        : members.every((segment) => segment.kind === 'reasoning')
          ? 'reasoning'
          : members.every((segment) => segment.kind === 'answer')
            ? 'narration'
            : 'execution',
      narrationKeys: new Set(narrationSegments.map((segment) => segment.id)),
      activityLabel: liveActivitySegment?.message.content
        ? String(liveActivitySegment.message.content)
        : undefined,
      toolCount,
      defaultCollapsed: true,
    });
  });

  return { groups, memberDisclosureKeys };
}
