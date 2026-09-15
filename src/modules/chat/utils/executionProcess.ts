import type { ChatMessage } from '@/shared/types';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';

export type ExecutionProcessGroup = {
  turnKey: string;
  memberKeys: Set<string>;
  firstMemberKey: string;
  hasAttention: boolean;
};

export type ExecutionProcessProjection = {
  groups: Map<string, ExecutionProcessGroup>;
  memberTurnKeys: Map<string, string>;
};

/** True only for user messages that start a visible conversational turn. */
export function isVisibleUserTurnStart(message: ChatMessage): boolean {
  return message.type === 'user' && !message.isLocalCommand;
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

/**
 * Projects each complete user turn into one optional execution-process group.
 * Members retain their original rows and keys; this result only controls their
 * visual visibility in ChatMessagesPane.
 */
export function deriveExecutionProcessProjection(
  messages: ChatMessage[],
  getMessageKey: (message: ChatMessage) => string,
  isProcessing: boolean,
  canCloseTail: (turnKey: string) => boolean,
): ExecutionProcessProjection {
  const groups = new Map<string, ExecutionProcessGroup>();
  const memberTurnKeys = new Map<string, string>();
  let turnStartIndex: number | null = null;

  const processTurn = (endIndex: number) => {
    if (turnStartIndex === null) return;
    const userMessage = messages[turnStartIndex];
    const intrinsicTurnKey = userMessage ? getIntrinsicMessageKey(userMessage) : null;
    if (!intrinsicTurnKey) return;

    const turnMessages = messages.slice(turnStartIndex + 1, endIndex);
    const focusOffset = turnMessages.reduce<number | undefined>((latest, message, index) => (
      isAssistantTextFocusCandidate(message) ? index : latest
    ), undefined);
    if (focusOffset === undefined) return;

    const members = turnMessages
      .slice(0, focusOffset)
      .filter(canBecomeProcessMember);
    // A completed turn may safely close its trailing activity, but never while
    // the user is reading above the tail.
    if (!isProcessing && canCloseTail(intrinsicTurnKey)) {
      members.push(...turnMessages.slice(focusOffset + 1).filter(canBecomeProcessMember));
    }
    if (members.length === 0) return;

    const memberKeys = new Set(members.map(getMessageKey));
    const firstMemberKey = getMessageKey(members[0]);
    const hasAttention = turnMessages.some(requiresAttention);
    const group: ExecutionProcessGroup = {
      turnKey: intrinsicTurnKey,
      memberKeys,
      firstMemberKey,
      hasAttention,
    };
    groups.set(intrinsicTurnKey, group);
    memberKeys.forEach((key) => memberTurnKeys.set(key, intrinsicTurnKey));
  };

  for (let index = 0; index <= messages.length; index += 1) {
    if (index === messages.length || isVisibleUserTurnStart(messages[index])) {
      processTurn(index);
      turnStartIndex = index === messages.length ? null : index;
    }
  }

  return { groups, memberTurnKeys };
}
