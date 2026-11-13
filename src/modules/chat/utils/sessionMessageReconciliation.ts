import type { NormalizedMessage } from '@/shared/types';

const LOCAL_USER_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const LOCAL_USER_DEDUPE_CLOCK_SKEW_MS = 10_000;
const LOCAL_ATTACHMENT_ONLY_DEDUPE_WINDOW_MS = 30_000;

// ─── Temporary merge diagnostics ─────────────────────────────────────────────
// Reports why an optimistic `local_` user row failed to retire, and whether the
// persisted list itself carries duplicate ids. Entries are mirrored into
// sessionStorage so a page refresh does not destroy the only copy — the orphan
// row disappears on reload, which is exactly when it is still worth reading.
const MERGE_DEBUG_STORAGE_KEY = 'cloudcli:message-merge-debug';
const MERGE_DEBUG_LIMIT = 40;
const reportedDiagnostics = new Set<string>();

function recordMergeDebug(entry: Record<string, unknown>): void {
  console.warn('[message-merge]', entry);
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(MERGE_DEBUG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const log: unknown[] = Array.isArray(parsed) ? parsed : [];
    log.push({ at: new Date().toISOString(), ...entry });
    window.sessionStorage.setItem(
      MERGE_DEBUG_STORAGE_KEY,
      JSON.stringify(log.slice(-MERGE_DEBUG_LIMIT)),
    );
  } catch {
    // Diagnostics must never break the merge.
  }
}

function recordOnce(signature: string, entry: Record<string, unknown>): void {
  if (reportedDiagnostics.has(signature)) return;
  reportedDiagnostics.add(signature);
  recordMergeDebug(entry);
}

function previewText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

function normalizeEchoText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function reportDuplicateServerIds(serverMessages: NormalizedMessage[]): void {
  if (serverMessages.length < 2) return;

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const message of serverMessages) {
    if (seen.has(message.id)) {
      duplicates.push(message.id);
    } else {
      seen.add(message.id);
    }
  }
  if (duplicates.length === 0) return;

  recordOnce(`duplicate-server-ids|${serverMessages.length}|${duplicates.join(',')}`, {
    event: 'duplicate-server-ids',
    serverCount: serverMessages.length,
    duplicateCount: duplicates.length,
    duplicateIds: duplicates.slice(0, 10),
    firstTime: serverMessages[0]?.timestamp ?? null,
    lastTime: serverMessages[serverMessages.length - 1]?.timestamp ?? null,
  });
}

function describeUserEchoMiss(
  localMessage: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  claimedServerIds: Set<string>,
): Record<string, unknown> {
  const localFingerprint = userTurnFingerprint(localMessage);
  const localTime = readMessageTime(localMessage);
  const firstEligibleIndex = localMessage.replacesAfterRowCount ?? 0;
  const looseLocalText = normalizeEchoText(localFingerprint?.text ?? '');
  const candidates: Record<string, unknown>[] = [];

  for (let index = 0; index < serverMessages.length; index++) {
    const serverMessage = serverMessages[index];
    const serverFingerprint = userTurnFingerprint(serverMessage);
    if (!serverFingerprint) continue;

    const exactText = serverFingerprint.text === (localFingerprint?.text ?? '');
    const looseText = normalizeEchoText(serverFingerprint.text) === looseLocalText;
    if (!exactText && !looseText) continue;

    const serverTime = readMessageTime(serverMessage);
    candidates.push({
      index,
      id: serverMessage.id,
      time: serverMessage.timestamp,
      deltaMs: serverTime !== null && localTime !== null ? serverTime - localTime : null,
      textMatch: exactText ? 'exact' : 'whitespace-only',
      imageCount: serverFingerprint.imageCount,
      fileCount: serverFingerprint.fileCount,
      claimed: claimedServerIds.has(serverMessage.id),
      belowReplacesFloor: index < firstEligibleIndex,
    });
  }

  return {
    event: 'optimistic-user-orphan',
    sessionId: localMessage.sessionId,
    local: {
      id: localMessage.id,
      time: localMessage.timestamp,
      timeMs: localTime,
      text: previewText(localFingerprint?.text ?? localMessage.content ?? ''),
      textLength: (localMessage.content ?? '').length,
      imageCount: localMessage.images?.length ?? 0,
      fileCount: localMessage.files?.length ?? 0,
      replacesAnchorId: localMessage.replacesAnchorId ?? null,
      replacesAfterRowCount: localMessage.replacesAfterRowCount ?? null,
      matchable: Boolean(localFingerprint) && localTime !== null,
    },
    serverWindow: {
      count: serverMessages.length,
      firstId: serverMessages[0]?.id ?? null,
      firstTime: serverMessages[0]?.timestamp ?? null,
      lastId: serverMessages[serverMessages.length - 1]?.id ?? null,
      lastTime: serverMessages[serverMessages.length - 1]?.timestamp ?? null,
    },
    sameTextRowCount: candidates.length,
    candidates,
  };
}

type UserTurnFingerprint = {
  text: string;
  imageCount: number;
  fileCount: number;
};

function userTurnFingerprint(message: NormalizedMessage): UserTurnFingerprint | null {
  if (message.kind !== 'text' || message.role !== 'user') return null;

  const text = (message.content || '').trim();
  const imageCount = Array.isArray(message.images) ? message.images.length : 0;
  const fileCount = Array.isArray(message.files) ? message.files.length : 0;
  if (!text && imageCount === 0 && fileCount === 0) return null;

  return { text, imageCount, fileCount };
}

function userTurnFingerprintsMatch(
  local: UserTurnFingerprint,
  server: UserTurnFingerprint,
): boolean {
  return (
    local.text === server.text
    && local.imageCount === server.imageCount
    && local.fileCount === server.fileCount
  );
}

function readMessageTime(message: NormalizedMessage): number | null {
  const time = Date.parse(message.timestamp);
  return Number.isFinite(time) ? time : null;
}

function findServerEchoForLocalUser(
  localMessage: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  claimedServerIds: Set<string>,
): NormalizedMessage | null {
  const localFingerprint = userTurnFingerprint(localMessage);
  const localTime = readMessageTime(localMessage);
  if (!localFingerprint || localTime === null) {
    return null;
  }

  // The echo of an edited message may only be retired by a row that was not
  // in the transcript when the cut was made. Text and a time window are not
  // enough for it: a rewind that branches re-stamps every surviving turn to
  // the moment of the copy, so an earlier turn with the same words — "yes",
  // "continue", the typo being corrected — lands inside the window and would
  // retire the message the user just sent.
  const firstEligibleIndex = localMessage.replacesAfterRowCount ?? 0;

  const dedupeWindow = localFingerprint.text
    ? LOCAL_USER_DEDUPE_WINDOW_MS
    : LOCAL_ATTACHMENT_ONLY_DEDUPE_WINDOW_MS;
  let closestMatch: NormalizedMessage | null = null;
  let closestTimeDifference = Number.POSITIVE_INFINITY;

  for (let index = firstEligibleIndex; index < serverMessages.length; index++) {
    const serverMessage = serverMessages[index];
    if (claimedServerIds.has(serverMessage.id)) {
      continue;
    }

    const serverFingerprint = userTurnFingerprint(serverMessage);
    if (!serverFingerprint || !userTurnFingerprintsMatch(localFingerprint, serverFingerprint)) {
      continue;
    }

    const serverTime = readMessageTime(serverMessage);
    if (
      serverTime === null
      || serverTime < localTime - LOCAL_USER_DEDUPE_CLOCK_SKEW_MS
      || serverTime - localTime > dedupeWindow
    ) {
      continue;
    }

    const timeDifference = Math.abs(serverTime - localTime);
    if (timeDifference < closestTimeDifference) {
      closestMatch = serverMessage;
      closestTimeDifference = timeDifference;
    }
  }

  return closestMatch;
}

/**
 * Removes local optimistic user rows once a corresponding persisted turn is
 * available. Matches are one-to-one so repeated sends cannot claim one row.
 */
export function removeOptimisticUserEchoes(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  const claimedServerIds = new Set<string>();

  return realtimeMessages.filter((message) => {
    if (!message.id.startsWith('local_')) {
      return true;
    }

    const serverEcho = findServerEchoForLocalUser(message, serverMessages, claimedServerIds);
    if (!serverEcho) {
      if (serverMessages.length > 0) {
        const lastId = serverMessages[serverMessages.length - 1]?.id ?? '';
        recordOnce(`${message.id}|${serverMessages.length}|${lastId}`, describeUserEchoMiss(
          message,
          serverMessages,
          claimedServerIds,
        ));
      }
      return true;
    }

    claimedServerIds.add(serverEcho.id);
    return false;
  });
}

/**
 * Provider item updates reuse the same native item/tool id. Replace the
 * previous realtime snapshot instead of rendering each lifecycle update as a
 * separate row, so a tool that streams running → completed keeps one row.
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
