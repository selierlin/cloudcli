import type { ChatMessage } from '@/shared/types';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';

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

/** True only for user messages that start a visible conversational turn. */
export function isVisibleUserTurnStart(message: ChatMessage): boolean {
  return message.type === 'user' && !message.isLocalCommand;
}

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

/** Shared answer predicate for reasoning handoff and execution-process focus. */
export function isAssistantTextFocusCandidate(message: ChatMessage): boolean {
  return message.type === 'assistant'
    && !message.isThinking
    && !message.isToolUse
    && !message.isTaskNotification
    && !message.isTaskNotificationResult
    && !message.isCompactSummary
    && !message.isLocalCommandStdout
    && String(message.content || '').trim().length > 0;
}

function requiresAttention(message: ChatMessage): boolean {
  if (message.isSubagentContainer && ['running', 'failed'].includes(message.subagent?.status || '')) {
    return true;
  }
  if (['AskUserQuestion', 'exit_plan_mode', 'ExitPlanMode'].includes(message.toolName || '')) {
    return true;
  }
  return message.toolResult?.isError === true
    || ['running', 'error', 'denied', 'stopped'].includes(String(message.toolStatus || ''));
}

function canBecomeProcessMember(message: ChatMessage): boolean {
  return !isVisibleUserTurnStart(message) && !requiresAttention(message);
}

function findFocusOffset(messages: ChatMessage[]): number | undefined {
  return messages.reduce<number | undefined>((latest, message, index) => (
    isAssistantTextFocusCandidate(message) ? index : latest
  ), undefined);
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
  let turnStartIndex: number | null = null;

  const processFullTurn = (start: number, end: number) => {
    const userMessage = messages[start];
    const turnKey = userMessage ? getIntrinsicMessageKey(userMessage) : null;
    if (!turnKey) return;

    const turnMessages = messages.slice(start + 1, end);
    const focusOffset = findFocusOffset(turnMessages);
    if (focusOffset === undefined) return;

    const focus = turnMessages[focusOffset];
    const disclosureKey = turnKey;
    const isRightmostTurn = end === messages.length;
    const tailClosure = options.tailClosures[disclosureKey];
    const isLiveTail = isRightmostTurn && (
      options.isProcessing || options.isLiveCompletionPending || tailClosure !== undefined
    );
    const mayCloseTail = tailClosure !== 'deferred_live' && (
      !isLiveTail
      || tailClosure === 'closed_live'
      || (!options.isProcessing && !options.isLiveCompletionPending && tailClosure === undefined)
    );
    const members = turnMessages.slice(0, focusOffset).filter(canBecomeProcessMember);
    if (mayCloseTail) members.push(...turnMessages.slice(focusOffset + 1).filter(canBecomeProcessMember));
    if (members.length === 0) return;

    registerGroup(groups, memberDisclosureKeys, {
      turnKey,
      disclosureKey,
      disclosureAliases: [`truncated:${getMessageKey(focus)}`],
      isWindowTruncated: false,
      memberKeys: new Set(members.map(getMessageKey)),
      firstMemberKey: getMessageKey(members[0]),
      hasAttention: turnMessages.some(requiresAttention),
    });
  };

  const firstVisibleUserIndex = messages.findIndex(isVisibleUserTurnStart);
  if (firstVisibleUserIndex === 0) {
    turnStartIndex = 0;
  } else if (firstVisibleUserIndex > 0) {
    const truncatedMessages = messages.slice(0, firstVisibleUserIndex);
    const focusOffset = findFocusOffset(truncatedMessages);
    // A prefix before a later user is an older completed turn even while the
    // provider works on that later turn. A right-edge prefix is safe only when
    // this view is a completed historical snapshot.
    const isCompletedPrefix = !options.isProcessing || firstVisibleUserIndex < messages.length;
    if (focusOffset !== undefined && isCompletedPrefix) {
      const focus = truncatedMessages[focusOffset];
      const members = [...truncatedMessages.slice(0, focusOffset), ...truncatedMessages.slice(focusOffset + 1)]
        .filter(canBecomeProcessMember);
      if (members.length > 0) {
        const disclosureKey = `truncated:${getMessageKey(focus)}`;
        registerGroup(groups, memberDisclosureKeys, {
          disclosureKey,
          disclosureAliases: [],
          isWindowTruncated: true,
          memberKeys: new Set(members.map(getMessageKey)),
          firstMemberKey: getMessageKey(members[0]),
          hasAttention: truncatedMessages.some(requiresAttention),
        });
      }
    }
    turnStartIndex = firstVisibleUserIndex;
  } else if (firstVisibleUserIndex === -1 && !options.isProcessing) {
    const focusOffset = findFocusOffset(messages);
    if (focusOffset !== undefined) {
      const focus = messages[focusOffset];
      const members = [...messages.slice(0, focusOffset), ...messages.slice(focusOffset + 1)]
        .filter(canBecomeProcessMember);
      if (members.length > 0) {
        const disclosureKey = `truncated:${getMessageKey(focus)}`;
        registerGroup(groups, memberDisclosureKeys, {
          disclosureKey,
          disclosureAliases: [],
          isWindowTruncated: true,
          memberKeys: new Set(members.map(getMessageKey)),
          firstMemberKey: getMessageKey(members[0]),
          hasAttention: messages.some(requiresAttention),
        });
      }
    }
  }

  for (let index = turnStartIndex ?? messages.length; index <= messages.length; index += 1) {
    if (index === messages.length || isVisibleUserTurnStart(messages[index])) {
      if (turnStartIndex !== null && index > turnStartIndex) processFullTurn(turnStartIndex, index);
      turnStartIndex = index === messages.length ? null : index;
    }
  }

  return { groups, memberDisclosureKeys };
}
