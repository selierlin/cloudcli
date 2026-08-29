import type { NormalizedMessage } from './useSessionStore';
import { removeOptimisticUserEchoes } from './sessionMessageReconciliation';

export function readMessageTime(message: NormalizedMessage): number | null {
  const time = Date.parse(message.timestamp);
  return Number.isFinite(time) ? time : null;
}

function compareMessagesChronologically(a: NormalizedMessage, b: NormalizedMessage): number {
  const timeA = readMessageTime(a) ?? 0;
  const timeB = readMessageTime(b) ?? 0;
  if (timeA !== timeB) {
    return timeA - timeB;
  }
  return 0;
}

/**
 * Count how many user turns precede `message` in a chronologically merged view
 * of server + realtime rows. Used to match a realtime row to the correct turn
 * on disk when several turns share identical assistant text.
 */
function getUserTurnOrdinalBefore(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): number {
  const messageTime = readMessageTime(message);
  let userCount = 0;

  for (const candidate of [...serverMessages, ...realtimeMessages].sort(compareMessagesChronologically)) {
    if (candidate.id === message.id) {
      break;
    }

    const candidateTime = readMessageTime(candidate);
    if (
      messageTime !== null
      && candidateTime !== null
      && candidateTime > messageTime
    ) {
      break;
    }

    if (candidate.kind === 'text' && candidate.role === 'user') {
      userCount++;
    }
  }

  return Math.max(0, userCount - 1);
}

function findServerTurnRangeByOrdinal(
  serverMessages: NormalizedMessage[],
  turnOrdinal: number,
): { start: number; end: number } | null {
  let userCount = -1;
  let start = -1;

  for (let index = 0; index < serverMessages.length; index++) {
    const message = serverMessages[index];
    if (message.kind === 'text' && message.role === 'user') {
      userCount++;
      if (userCount === turnOrdinal) {
        start = index;
        break;
      }
    }
  }

  if (start < 0) {
    return null;
  }

  let end = serverMessages.length;
  for (let index = start + 1; index < serverMessages.length; index++) {
    if (serverMessages[index].kind === 'text' && serverMessages[index].role === 'user') {
      end = index;
      break;
    }
  }

  return { start, end };
}

function isAssistantTextEchoedInSameTurnOnServer(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): boolean {
  const assistantText = (message.content || '').trim();
  if (!assistantText) {
    return false;
  }

  const turnOrdinal = getUserTurnOrdinalBefore(message, serverMessages, realtimeMessages);
  const turnRange = findServerTurnRangeByOrdinal(serverMessages, turnOrdinal);
  if (!turnRange) {
    return false;
  }

  return serverMessages
    .slice(turnRange.start + 1, turnRange.end)
    .some((serverMessage) =>
      serverMessage.kind === 'text'
      && serverMessage.role === 'assistant'
      && (serverMessage.content || '').trim() === assistantText,
    );
}

/**
 * After `finalizeStreaming`, the client holds a synthetic assistant `text` row
 * while the sessions API soon returns the same reply with a different id.
 * Collapse same-text assistant rows and stream_placeholder → text when content
 * matches.
 */
function dedupeAdjacentAssistantEchoes(merged: NormalizedMessage[]): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  for (const message of merged) {
    const prev = out[out.length - 1];
    if (prev) {
      if (prev.kind === 'stream_delta' && message.kind === 'text' && message.role === 'assistant') {
        const previousText = (prev.content || '').trim();
        const messageText = (message.content || '').trim();
        if (previousText.length > 0 && previousText === messageText) {
          out[out.length - 1] = message;
          continue;
        }
      }
      if (
        prev.kind === 'text'
        && message.kind === 'text'
        && prev.role === 'assistant'
        && message.role === 'assistant'
      ) {
        const messageText = (message.content || '').trim();
        if (messageText.length > 0 && messageText === (prev.content || '').trim()) {
          continue;
        }
      }
    }
    out.push(message);
  }
  return out;
}

/**
 * After a server refresh, drop only realtime rows the persisted transcript
 * already owns. Rows not yet on disk remain visible until a later refresh.
 */
export function pruneRealtimeSupersededByServer(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  if (realtimeMessages.length === 0) {
    return realtimeMessages;
  }

  const serverIds = new Set(serverMessages.map((message) => message.id));
  const reconciledRealtimeMessages = removeOptimisticUserEchoes(serverMessages, realtimeMessages);

  return reconciledRealtimeMessages.filter((message) => {
    if (serverIds.has(message.id)) {
      return false;
    }

    if (message.kind === 'stream_delta' || message.id === `__streaming_${message.sessionId}`) {
      if (isAssistantTextEchoedInSameTurnOnServer(message, serverMessages, realtimeMessages)) {
        return false;
      }
      return true;
    }

    if (message.kind === 'text' && message.role === 'assistant') {
      if (isAssistantTextEchoedInSameTurnOnServer(message, serverMessages, realtimeMessages)) {
        return false;
      }
      return true;
    }

    if (message.kind === 'text' && message.role === 'user') {
      return true;
    }

    if (message.kind === 'tool_use' && message.toolId) {
      if (serverMessages.some((serverMessage) => serverMessage.kind === 'tool_use' && serverMessage.toolId === message.toolId)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Compute server + realtime messages while overlaying newer realtime snapshots
 * onto the persisted row with the same stable id.
 */
export function computeMerged(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  if (realtimeMessages.length === 0) {
    return dedupeAdjacentAssistantEchoes(serverMessages);
  }
  if (serverMessages.length === 0) {
    return dedupeAdjacentAssistantEchoes(realtimeMessages);
  }

  const serverIds = new Set(serverMessages.map((message) => message.id));
  const reconciledRealtime = removeOptimisticUserEchoes(serverMessages, realtimeMessages);
  const realtimeById = new Map(reconciledRealtime.map((message) => [message.id, message]));
  const mergedServer = serverMessages.map((message) => {
    const realtimeMessage = realtimeById.get(message.id);
    if (!realtimeMessage) {
      return message;
    }
    realtimeById.delete(message.id);
    return { ...message, ...realtimeMessage };
  });
  const extra = reconciledRealtime.filter((message) => !serverIds.has(message.id));

  if (extra.length === 0) {
    return dedupeAdjacentAssistantEchoes(mergedServer);
  }

  return dedupeAdjacentAssistantEchoes(
    [...mergedServer, ...extra].sort(compareMessagesChronologically),
  );
}

/**
 * Provider item updates reuse the same native item/tool id. Replace the
 * previous realtime snapshot instead of rendering each lifecycle update as a
 * separate row.
 */
export function upsertRealtimeMessages(
  existing: NormalizedMessage[],
  incoming: NormalizedMessage[],
): NormalizedMessage[] {
  const updated = [...existing];

  for (const message of incoming) {
    const index = updated.findIndex((candidate) => (
      candidate.id === message.id
      || (
        message.kind === 'tool_use'
        && candidate.kind === 'tool_use'
        && message.toolId
        && candidate.toolId === message.toolId
      )
    ));

    if (index === -1) {
      updated.push(message);
    } else {
      updated[index] = { ...updated[index], ...message };
    }
  }

  return updated;
}
