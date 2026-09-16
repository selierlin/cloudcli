import { createHash } from 'node:crypto';

import type { FetchHistoryResult, HistorySeekTarget, NormalizedMessage } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type TurnHistoryCursor = {
  version: 1;
  sessionId: string;
  snapshotTotal: number;
  snapshotVersion: string;
  direction: 'older' | 'newer';
  boundary: number;
};

type PaginateHistoryByTurnInput = {
  sessionId: string;
  history: FetchHistoryResult;
  byteBudget: number;
  cursor?: string;
  seek?: HistorySeekTarget;
};

function isVisibleUserTurnStart(message: NormalizedMessage): boolean {
  return message.kind === 'text' && message.role === 'user' && !message.isLocalCommand;
}

function createSnapshotVersion(messages: NormalizedMessage[]): string {
  const hash = createHash('sha256');
  for (const message of messages) {
    // Some adapters synthesize fresh transport ids on every read. Snapshot
    // continuity follows semantic transcript facts, not those volatile ids.
    const stableMessage: Record<string, unknown> = { ...message };
    delete stableMessage.id;
    delete stableMessage.sessionId;
    delete stableMessage.segmentId;
    hash.update(JSON.stringify(stableMessage));
    hash.update('\n');
  }
  return hash.digest('base64url').slice(0, 22);
}

function encodeCursor(cursor: TurnHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string, sessionId: string): TurnHistoryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<TurnHistoryCursor>;
    if (
      parsed.version !== 1
      || parsed.sessionId !== sessionId
      || !Number.isInteger(parsed.snapshotTotal)
      || (parsed.direction !== 'older' && parsed.direction !== 'newer')
      || !Number.isInteger(parsed.boundary)
      || typeof parsed.snapshotVersion !== 'string'
      || parsed.snapshotTotal! < 0
      || parsed.boundary! < 0
      || parsed.boundary! > parsed.snapshotTotal!
      // The server only issues a newer cursor strictly inside the snapshot;
      // a tail boundary is a fabricated shape that would page past the end.
      || (parsed.direction === 'newer' && parsed.boundary === parsed.snapshotTotal)
    ) {
      throw new Error('invalid cursor shape');
    }
    return parsed as TurnHistoryCursor;
  } catch {
    throw new AppError('History cursor is invalid.', {
      code: 'INVALID_HISTORY_CURSOR',
      statusCode: 400,
    });
  }
}

function findTurnStartBefore(messages: NormalizedMessage[], endExclusive: number): number {
  for (let index = endExclusive - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isVisibleUserTurnStart(message)) return index;
  }
  return 0;
}

function findTurnEndAfter(messages: NormalizedMessage[], startInclusive: number): number {
  for (let index = startInclusive + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message && isVisibleUserTurnStart(message)) return index;
  }
  return messages.length;
}

function normalizeSeekSnippet(value: string): string {
  return value.replace(/^\.{3}/, '').replace(/\.{3}$/, '').trim().slice(0, 80).toLowerCase();
}

function searchableMessageText(message: NormalizedMessage): string {
  return [message.displayText, message.content, message.toolInput, message.toolResult]
    .map((value) => typeof value === 'string' ? value : value ? JSON.stringify(value) : '')
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function findSeekIndex(messages: NormalizedMessage[], seek: HistorySeekTarget): number {
  if (seek.transcriptAnchorId) {
    const anchorIndex = messages.findIndex(
      (message) => message.transcriptAnchorId === seek.transcriptAnchorId,
    );
    if (anchorIndex >= 0) return anchorIndex;
  }

  if (seek.snippet) {
    const snippet = normalizeSeekSnippet(seek.snippet);
    if (snippet.length >= 10) {
      const snippetIndex = messages.findIndex(
        (message) => searchableMessageText(message).includes(snippet),
      );
      if (snippetIndex >= 0) return snippetIndex;
    }
  }

  if (seek.timestamp) {
    const exactTimestampIndex = messages.findIndex(
      (message) => String(message.timestamp) === seek.timestamp,
    );
    if (exactTimestampIndex >= 0) return exactTimestampIndex;
  }

  if (seek.timestamp) {
    const targetTime = Date.parse(seek.timestamp);
    if (Number.isFinite(targetTime)) {
      let closestIndex = -1;
      let closestDistance = Infinity;
      for (const [index, message] of messages.entries()) {
        const messageTime = Date.parse(String(message.timestamp));
        const distance = Math.abs(messageTime - targetTime);
        if (Number.isFinite(distance) && distance < closestDistance) {
          closestIndex = index;
          closestDistance = distance;
        }
      }
      if (closestIndex >= 0) return closestIndex;
    }
  }

  throw new AppError('The requested history position was not found.', {
    code: 'HISTORY_SEEK_TARGET_NOT_FOUND',
    statusCode: 404,
  });
}

function serializedBytes(messages: NormalizedMessage[], start: number, end: number): number {
  let bytes = 0;
  for (let index = start; index < end; index += 1) {
    bytes += Buffer.byteLength(JSON.stringify(messages[index]), 'utf8');
  }
  return bytes;
}

function findSeekWindowStart(
  messages: NormalizedMessage[],
  seekIndex: number,
  turnStart: number,
): number {
  const target = messages[seekIndex];
  if (target?.kind !== 'tool_result' || !target.toolId) return seekIndex;

  for (let index = seekIndex - 1; index >= turnStart; index -= 1) {
    const candidate = messages[index];
    if (candidate?.kind === 'tool_use' && candidate.toolId === target.toolId) {
      return index;
    }
  }
  return seekIndex;
}

/** Keeps an interior seek hit visible when its containing Turn cannot fit whole. */
function createOversizedSeekWindow(
  messages: NormalizedMessage[],
  seekIndex: number,
  turnStart: number,
  turnEnd: number,
  byteBudget: number,
): { start: number; endExclusive: number; pageBytes: number } {
  // A tool result is not independently renderable: the client attaches it to
  // its tool-use row. Keep that pair together even when it makes the byte
  // budget soft, just as one oversized normalized message is already allowed.
  let start = findSeekWindowStart(messages, seekIndex, turnStart);
  let endExclusive = seekIndex + 1;
  let pageBytes = serializedBytes(messages, start, endExclusive);

  // Prefer the context after the hit (usually the answer that follows a user
  // prompt), then spend any remaining budget on preceding context.
  while (endExclusive < turnEnd) {
    const messageBytes = serializedBytes(messages, endExclusive, endExclusive + 1);
    if (pageBytes + messageBytes > byteBudget) break;
    endExclusive += 1;
    pageBytes += messageBytes;
  }
  while (start > turnStart) {
    const messageBytes = serializedBytes(messages, start - 1, start);
    if (pageBytes + messageBytes > byteBudget) break;
    start -= 1;
    pageBytes += messageBytes;
  }

  return { start, endExclusive, pageBytes };
}

/**
 * Used by sessionsService to page a normalized transcript at Turn boundaries
 * while an opaque cursor pins later requests to the first page's append-only snapshot.
 */
export function paginateHistoryByTurn({
  sessionId,
  history,
  byteBudget,
  cursor,
  seek,
}: PaginateHistoryByTurnInput): FetchHistoryResult {
  const decoded = cursor ? decodeCursor(cursor, sessionId) : null;
  const snapshotTotal = decoded?.snapshotTotal ?? history.messages.length;
  if (history.messages.length < snapshotTotal) {
    throw new AppError('History changed while this page sequence was being read.', {
      code: 'STALE_HISTORY_CURSOR',
      statusCode: 409,
    });
  }

  const snapshotMessages = history.messages.slice(0, snapshotTotal);
  const snapshotVersion = createSnapshotVersion(snapshotMessages);
  if (decoded && decoded.snapshotVersion !== snapshotVersion) {
    throw new AppError('History changed while this page sequence was being read.', {
      code: 'STALE_HISTORY_CURSOR',
      statusCode: 409,
    });
  }

  const seekIndex = !decoded && seek ? findSeekIndex(snapshotMessages, seek) : null;
  let start: number;
  let endExclusive: number;
  let pageBytes = 0;

  const seekTurnStart = seekIndex === null
    ? null
    : findTurnStartBefore(snapshotMessages, seekIndex + 1);
  const seekTurnEnd = seekIndex === null
    ? null
    : findTurnEndAfter(snapshotMessages, seekIndex);
  const oversizedSeekWindow = seekIndex !== null
    && seekTurnStart !== null
    && seekTurnEnd !== null
    && serializedBytes(snapshotMessages, seekTurnStart, seekTurnEnd) > byteBudget
    ? createOversizedSeekWindow(
        snapshotMessages,
        seekIndex,
        seekTurnStart,
        seekTurnEnd,
        byteBudget,
      )
    : null;

  if (oversizedSeekWindow) {
    ({ start, endExclusive, pageBytes } = oversizedSeekWindow);
  } else if (decoded?.direction === 'newer') {
    start = decoded.boundary;
    endExclusive = start;
    while (endExclusive < snapshotTotal) {
      const turnEnd = findTurnEndAfter(snapshotMessages, endExclusive);
      const turnBytes = serializedBytes(snapshotMessages, endExclusive, turnEnd);
      if (endExclusive === start && turnBytes > byteBudget) {
        let chunkEnd = endExclusive;
        let chunkBytes = 0;
        while (chunkEnd < turnEnd) {
          const messageBytes = serializedBytes(snapshotMessages, chunkEnd, chunkEnd + 1);
          if (chunkEnd > start && chunkBytes + messageBytes > byteBudget) break;
          chunkEnd += 1;
          chunkBytes += messageBytes;
        }
        endExclusive = chunkEnd;
        pageBytes = chunkBytes;
        break;
      }
      if (endExclusive > start && pageBytes + turnBytes > byteBudget) break;
      endExclusive = turnEnd;
      pageBytes += turnBytes;
      if (endExclusive === snapshotTotal || pageBytes >= byteBudget) break;
    }
  } else {
    endExclusive = decoded?.boundary
      ?? (seekIndex === null ? snapshotTotal : findTurnEndAfter(snapshotMessages, seekIndex));
    start = endExclusive;
    while (start > 0) {
      const turnStart = findTurnStartBefore(snapshotMessages, start);
      const turnBytes = serializedBytes(snapshotMessages, turnStart, start);
      if (start === endExclusive && turnBytes > byteBudget) {
        let chunkStart = start;
        let chunkBytes = 0;
        while (chunkStart > turnStart) {
          const messageBytes = serializedBytes(snapshotMessages, chunkStart - 1, chunkStart);
          if (chunkStart < start && chunkBytes + messageBytes > byteBudget) break;
          chunkStart -= 1;
          chunkBytes += messageBytes;
        }
        start = chunkStart;
        pageBytes = chunkBytes;
        break;
      }
      if (start < endExclusive && pageBytes + turnBytes > byteBudget) break;
      start = turnStart;
      pageBytes += turnBytes;
      if (start === 0 || pageBytes >= byteBudget) break;
    }
  }

  const hasMore = start > 0;
  const nextCursor = hasMore
    ? encodeCursor({
        version: 1,
        sessionId,
        snapshotTotal,
        snapshotVersion,
        direction: 'older',
        boundary: start,
      })
    : null;
  const newerCursor = endExclusive < snapshotTotal
    ? encodeCursor({
        version: 1,
        sessionId,
        snapshotTotal,
        snapshotVersion,
        direction: 'newer',
        boundary: endExclusive,
      })
    : null;

  return {
    ...history,
    messages: snapshotMessages.slice(start, endExclusive),
    total: snapshotTotal,
    hasMore,
    offset: snapshotTotal - endExclusive,
    limit: null,
    pageInfo: {
      mode: 'turns',
      snapshotVersion,
      nextCursor,
      newerCursor,
      partial: {
        older: start > 0 && !isVisibleUserTurnStart(snapshotMessages[start]),
        newer: endExclusive < snapshotTotal
          && !isVisibleUserTurnStart(snapshotMessages[endExclusive]),
      },
    },
  };
}
