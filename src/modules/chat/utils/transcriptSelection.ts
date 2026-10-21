import type { ChatMessage } from '@/shared/types';
import {
  isAssistantTextFocusCandidate,
  isVisibleUserTurnStart,
} from '@/modules/chat/utils/transcriptProjection';

/**
 * A conversational turn offered to the transcript selection: the user's
 * message plus every row up to the next user turn.
 */
export type SelectableTranscriptTurn = {
  /** Key of the user message that starts the turn. */
  key: string;
  startIndex: number;
  endIndex: number;
};

/**
 * Whether this row can be picked on its own.
 *
 * The reader picks questions and answers — the rows a conversation is made of.
 * Reasoning, tool calls and tool results are not pickable individually: the
 * export folds them into the turn's Process Run, so a lone tool row would be a
 * fragment with neither question nor answer. A row inside a run is therefore
 * skipped too; the run's visible answer is the one that represents it.
 */
export function isSelectableExportRow(
  message: ChatMessage,
  isProcessRunMember: boolean,
): boolean {
  if (isVisibleUserTurnStart(message)) return true;
  return isAssistantTextFocusCandidate(message) && !isProcessRunMember;
}

/**
 * Finds the turns a reader can select in the loaded transcript.
 *
 * Rows before the first user message (a window that begins mid-turn) are not
 * selectable: they have no user row to hang the checkbox on.
 */
export function projectSelectableTurns(
  messages: ChatMessage[],
  getMessageKey: (message: ChatMessage) => string,
): SelectableTranscriptTurn[] {
  const turns: SelectableTranscriptTurn[] = [];
  let current: SelectableTranscriptTurn | null = null;

  messages.forEach((message, index) => {
    if (isVisibleUserTurnStart(message)) {
      if (current) current.endIndex = index - 1;
      current = {
        key: getMessageKey(message),
        startIndex: index,
        endIndex: messages.length - 1,
      };
      turns.push(current);
      return;
    }

    if (current) current.endIndex = index;
  });

  return turns;
}

/**
 * Keys picked when the reader selects a whole turn from that turn's entry.
 *
 * The question and the answers outside the run: a turn's tool record is
 * detail of the answer, not a row of its own, so it is never counted or
 * marked, and the reader is never shown a half-selected turn after it.
 */
export function collectTurnSelectionKeys(
  messages: ChatMessage[],
  turnKey: string,
  getMessageKey: (message: ChatMessage) => string,
  isProcessRunMember: (messageKey: string) => boolean,
): string[] {
  const turn = projectSelectableTurns(messages, getMessageKey).find((item) => item.key === turnKey);
  if (!turn) return [turnKey];

  const keys = [turnKey];
  for (let index = turn.startIndex + 1; index <= turn.endIndex; index += 1) {
    const message = messages[index];
    if (!message) continue;
    const key = getMessageKey(message);
    if (isSelectableExportRow(message, isProcessRunMember(key))) keys.push(key);
  }

  return keys;
}

/**
 * The rows a selection exports, in transcript order.
 *
 * Used by ChatInterface when the reader exports a subset: the exporter itself
 * still receives an ordinary message list, so it needs no selection-aware
 * branch.
 */
export function collectSelectedMessages(
  messages: ChatMessage[],
  selectedKeys: Set<string>,
  getMessageKey: (message: ChatMessage) => string,
): ChatMessage[] {
  if (selectedKeys.size === 0) return [];
  return messages.filter((message) => selectedKeys.has(getMessageKey(message)));
}
