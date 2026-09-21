import type {
  ChatMessage,
  TranscriptSegment,
  TranscriptSegmentKind,
  TranscriptSegmentLifecycle,
  TranscriptTurn,
  TranscriptTurnProjection,
} from '@/shared/types';

/** True only for user messages that start a visible conversational turn. */
export function isVisibleUserTurnStart(message: ChatMessage): boolean {
  return message.type === 'user' && !message.isLocalCommand;
}

/** True for assistant prose that can take focus from a preceding process segment. */
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

function classifySegment(message: ChatMessage): TranscriptSegmentKind {
  if (message.isThinking) return 'reasoning';
  if (message.isToolUse) return 'tool';
  if (message.isCompactSummary) return 'summary';
  if (message.type === 'error') return 'error';
  if (
    message.isTaskNotification
    || message.isTaskNotificationResult
    || message.isLocalCommand
    || message.isLocalCommandStdout
  ) {
    return 'progress';
  }
  return 'answer';
}

function classifyLifecycle(message: ChatMessage): TranscriptSegmentLifecycle {
  if (
    message.type === 'error'
    || message.toolResult?.isError === true
    || ['error', 'denied', 'stopped'].includes(String(message.toolStatus || ''))
    || message.subagent?.status === 'failed'
    || ['AskUserQuestion', 'exit_plan_mode', 'ExitPlanMode'].includes(message.toolName || '')
  ) {
    return 'attention';
  }
  if (
    message.isStreaming
    || message.toolStatus === 'running'
    || message.subagent?.status === 'running'
  ) {
    return 'active';
  }
  return 'complete';
}

/** Projects the chat module's visible rows into provider-agnostic conversational turns. */
export function projectTranscriptTurns(
  messages: ChatMessage[],
  getMessageKey: (message: ChatMessage) => string,
): TranscriptTurnProjection {
  const turns: TranscriptTurn[] = [];
  let currentTurn: TranscriptTurn | null = null;

  const ensurePartialTurn = (message: ChatMessage): TranscriptTurn => {
    if (currentTurn) return currentTurn;
    currentTurn = {
      id: `partial:${getMessageKey(message)}`,
      boundary: 'partial',
      segments: [],
      hasActiveSegments: false,
      hasAttention: false,
    };
    return currentTurn;
  };

  for (const message of messages) {
    if (isVisibleUserTurnStart(message)) {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = {
        id: `turn:${getMessageKey(message)}`,
        boundary: 'synthetic',
        userMessage: message,
        segments: [],
        hasActiveSegments: false,
        hasAttention: false,
      };
      continue;
    }

    const turn = ensurePartialTurn(message);
    // A local command echo that a real user message already anchors stays folded
    // into that turn's process run. But a command that opens the turn (e.g. the
    // session's very first row is `/deploy-cloudcli`) has nothing to attach to;
    // leaving it as a process member hides the user's own input behind the
    // collapsed run. Promote it to the visible turn anchor so the command stays
    // on screen.
    if (
      message.type === 'user'
      && message.isLocalCommand
      && !turn.userMessage
      && turn.segments.length === 0
    ) {
      turn.userMessage = message;
      turn.boundary = 'synthetic';
      continue;
    }
    const segment: TranscriptSegment = {
      id: getMessageKey(message),
      kind: classifySegment(message),
      lifecycle: classifyLifecycle(message),
      message,
    };
    turn.segments.push(segment);
    turn.hasActiveSegments ||= segment.lifecycle === 'active';
    turn.hasAttention ||= segment.lifecycle === 'attention';
    if (turn.boundary === 'partial' && segment.kind === 'answer') {
      turn.id = `partial:${segment.id}`;
    }
  }

  if (currentTurn) turns.push(currentTurn);
  return { turns };
}
