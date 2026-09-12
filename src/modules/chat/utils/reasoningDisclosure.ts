import type { ChatMessage, ReasoningPresentation } from '@/shared/types';

function isFinalAnswerCandidate(message: ChatMessage): boolean {
  return message.type === 'assistant'
    && !message.isThinking
    && !message.isToolUse
    && !message.isTaskNotification
    && !message.isTaskNotificationResult
    && String(message.content || '').trim().length > 0;
}

function createDisclosureKey(
  sessionId: string,
  message: ChatMessage,
  fallbackIndex: number,
): string {
  const timestamp = message.timestamp instanceof Date
    ? message.timestamp.toISOString()
    : String(message.timestamp || '');
  return timestamp
    ? `${sessionId}:thinking:${timestamp}`
    : `${sessionId}:thinking-window:${fallbackIndex}`;
}

/**
 * Derives transient thinking-disclosure inputs from the loaded transcript.
 * The result is keyed by message object because ChatMessagesPane consumes it
 * in the same render pass; durable disclosure identity lives in disclosureKey.
 */
export function deriveReasoningPresentations(
  messages: ChatMessage[],
  sessionId: string,
  isProcessing: boolean,
): Map<ChatMessage, ReasoningPresentation> {
  const result = new Map<ChatMessage, ReasoningPresentation>();
  let turnStart = 0;

  const processTurn = (start: number, end: number) => {
    const thinkingIndexes: number[] = [];
    for (let index = start; index < end; index += 1) {
      if (messages[index]?.isThinking) thinkingIndexes.push(index);
    }
    if (thinkingIndexes.length === 0) return;

    const latestThinkingIndex = thinkingIndexes[thinkingIndexes.length - 1];
    const answerCandidates: number[] = [];
    for (let index = latestThinkingIndex + 1; index < end; index += 1) {
      if (isFinalAnswerCandidate(messages[index])) answerCandidates.push(index);
    }
    const lastCandidateIndex = answerCandidates.at(-1);
    const hasToolAfterCandidate = lastCandidateIndex !== undefined
      && messages.slice(lastCandidateIndex + 1, end).some((message) => message.isToolUse);
    const candidate = lastCandidateIndex === undefined ? undefined : messages[lastCandidateIndex];
    const finalAnswerStarted = Boolean(
      candidate
      && !hasToolAfterCandidate
      && (candidate.isStreaming || !isProcessing),
    );

    for (const [ordinal, thinkingIndex] of thinkingIndexes.entries()) {
      const message = messages[thinkingIndex];
      const isLatest = thinkingIndex === latestThinkingIndex;
      result.set(message, {
        disclosureKey: `${createDisclosureKey(sessionId, message, thinkingIndex)}:${ordinal}`,
        handoffSequence: end - thinkingIndex - 1,
        finalAnswerStarted: isLatest && finalAnswerStarted,
        isAutoCollapseCandidate: isLatest && finalAnswerStarted,
        isSupersededThinking: !isLatest,
        toolActivityStarted: messages
          .slice(thinkingIndex + 1, end)
          .some((laterMessage) => laterMessage.isToolUse),
      });
    }
  };

  for (let index = 0; index <= messages.length; index += 1) {
    if (index === messages.length || messages[index]?.type === 'user') {
      processTurn(turnStart, index);
      turnStart = index + 1;
    }
  }

  return result;
}
