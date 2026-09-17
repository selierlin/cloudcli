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
  /** Stable assistant prose rows absorbed after later activity proves they were intermediate. */
  narrationKeys: Set<string>;
  /** Latest intermediate prose used as the live run's compact activity label. */
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
 * Projects each visible Turn into at most one ordinary Process Run. The final
 * rightmost prose remains outside as the Answer; every earlier segment keeps
 * its original order inside the run instead of becoming a separate stage.
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
    const finalAnswer = turn.segments.at(-1)?.kind === 'answer'
      ? turn.segments.at(-1)
      : undefined;
    const members = finalAnswer ? turn.segments.slice(0, -1) : turn.segments;
    if (members.length === 0) return;

    const turnKey = turn.userMessage
      ? getIntrinsicMessageKey(turn.userMessage) ?? undefined
      : undefined;
    const firstMemberKey = members[0].id;
    const partialKey = finalAnswer
      ? `process:before:${finalAnswer.id}`
      : `process:tail:${firstMemberKey}`;
    const disclosureKey = turnKey ? `process:turn:${turnKey}` : partialKey;
    const narrationSegments = members.filter((segment) => segment.kind === 'answer');
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
        finalAnswer ? `process:before:${finalAnswer.id}` : undefined,
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
      activityLabel: narrationSegments.at(-1)?.message.content
        ? String(narrationSegments.at(-1)?.message.content)
        : undefined,
      toolCount,
      defaultCollapsed: true,
    });
  });

  return { groups, memberDisclosureKeys };
}
