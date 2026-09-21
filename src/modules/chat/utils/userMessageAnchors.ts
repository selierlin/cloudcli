import type { ChatMessage } from '@/shared/types';
import { projectTranscriptTurns } from '@/modules/chat/utils/transcriptProjection';

/**
 * Identifies which loaded user messages carry a following assistant reply and
 * therefore act as the anchor of a conversational section while that reply is
 * being read. Maps the user message key to its full original text so the
 * sticky section header can show the exact prompt (no abstraction).
 */
export function deriveUserMessageAnchors(
  messages: ChatMessage[],
  getMessageKey: (message: ChatMessage) => string,
): Map<string, string> {
  const anchors = new Map<string, string>();
  const turns = projectTranscriptTurns(messages, getMessageKey).turns;

  turns.forEach((turn) => {
    // A window that starts mid-turn has no visible prompt to anchor on, so the
    // sticky section header degrades instead of inventing one.
    if (!turn.userMessage) return;
    const hasReply = turn.segments.some((segment) => segment.kind === 'answer');
    if (!hasReply) return;
    anchors.set(getMessageKey(turn.userMessage), String(turn.userMessage.content ?? ''));
  });

  return anchors;
}