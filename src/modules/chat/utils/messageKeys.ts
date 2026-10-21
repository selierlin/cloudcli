import type { ChatMessage } from '@/shared/types';

const toMessageKeyPart = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const getIntrinsicMessageKey = (message: ChatMessage): string | null => {
  const candidates = [
    message.id,
    message.messageId,
    message.toolId,
    message.toolCallId,
    message.blobId,
    message.rowid,
    message.sequence,
  ];

  for (const candidate of candidates) {
    const keyPart = toMessageKeyPart(candidate);
    if (keyPart) {
      return `message-${message.type}-${keyPart}`;
    }
  }

  const timestamp = new Date(message.timestamp).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const contentPreview = typeof message.content === 'string' ? message.content.slice(0, 48) : '';
  const toolName = typeof message.toolName === 'string' ? message.toolName : '';
  return `message-${message.type}-${timestamp}-${toolName}-${contentPreview}`;
};

/** Key for transcript projection; falls back to the timestamp when a row has no id. */
export const getTranscriptMessageKey = (message: ChatMessage): string =>
  getIntrinsicMessageKey(message) ?? String(message.timestamp);

/**
 * Keys that stay unique when two rows share an intrinsic key (a provider that
 * stamps several rows with one timestamp, or a fixture without ids). The chat
 * pane disambiguates the same way; without it, two distinct rows look like one
 * process member and can be pulled into the wrong fold.
 */
export function buildTranscriptMessageKeys(messages: ChatMessage[]): Map<ChatMessage, string> {
  const occurrences = new Map<string, number>();
  const keys = new Map<ChatMessage, string>();

  for (const message of messages) {
    const intrinsic = getIntrinsicMessageKey(message) ?? 'message-generated';
    const seen = occurrences.get(intrinsic) ?? 0;
    occurrences.set(intrinsic, seen + 1);
    keys.set(message, seen === 0 ? intrinsic : `${intrinsic}__${seen}`);
  }

  return keys;
}

/**
 * Message keys numbered from the tail instead of the head.
 *
 * The chat pane renders only a tail window of the transcript, and older pages
 * are prepended. Numbering duplicates from the tail keeps every already
 * visible row's key stable across that prepend, so a selection or a React row
 * state cannot jump to a different message. Used by the chat pane and by the
 * transcript selection that exports a subset of the same rows.
 *
 * The guarantee is one-directional, and two cases fall outside it. Appending a
 * row that repeats an existing intrinsic key renumbers every duplicate above
 * it, so a key held from before the append now lands on a different row. A row
 * with no id folds its first 48 characters of content into the key, so a
 * streaming row changes key as it grows and a selection on it lapses. Both
 * require a row without an id — every provider that supplies one gets a key
 * that no neighbour can claim — so the edge is documented rather than paid for
 * with state that outlives the render.
 */
export function buildTailAnchoredMessageKeys(messages: ChatMessage[]): Map<ChatMessage, string> {
  const occurrences = new Map<string, number>();
  const keys = new Map<ChatMessage, string>();

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const intrinsic = getIntrinsicMessageKey(message) ?? 'message-generated';
    const seen = occurrences.get(intrinsic) ?? 0;
    occurrences.set(intrinsic, seen + 1);
    keys.set(message, seen === 0 ? intrinsic : `${intrinsic}__${seen}`);
  }

  return keys;
}
