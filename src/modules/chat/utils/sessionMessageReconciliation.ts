import { isDiagnosticsEnabled } from '@/shared/debug/diagnosticsPreference';
import type { NormalizedMessage } from '@/shared/types';

const LOCAL_USER_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const LOCAL_USER_DEDUPE_CLOCK_SKEW_MS = 10_000;
const LOCAL_ATTACHMENT_ONLY_DEDUPE_WINDOW_MS = 30_000;

// ─── Temporary merge diagnostics ─────────────────────────────────────────────
// Reports why an optimistic `local_` user row failed to retire, and whether the
// persisted list itself carries duplicate ids. Entries are mirrored into
// sessionStorage so a page refresh does not destroy the only copy — the orphan
// row disappears on reload, which is exactly when it is still worth reading.
// Nothing is recorded while Settings → Diagnostics is off.
const MERGE_DEBUG_STORAGE_KEY = 'cloudcli:message-merge-debug';
const MERGE_DEBUG_LIMIT = 40;
const MERGE_DEBUG_VERSION = 3;
// Two user rows with the same words only look like the duplicate this reports
// when they were sent close together; a prompt re-sent later is deliberate.
const DUPLICATE_USER_ROW_WINDOW_MS = 2 * 60 * 1000;
const reportedDiagnostics = new Set<string>();

// Marks the bundle that carries this instrumentation. Reading it back in the
// console answers "am I even running the new build" without guessing.
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__cloudcliMergeDebug = MERGE_DEBUG_VERSION;
}

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
  // Settings → Diagnostics is the only switch. Check it before remembering the
  // signature: claiming one while the switch is off would silence that event
  // forever, so turning diagnostics on afterwards would report nothing.
  if (!isDiagnosticsEnabled()) return;
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

function pushGroupIndex<K>(groups: Map<K, number[]>, key: K, index: number): void {
  const indexes = groups.get(key);
  if (indexes) {
    indexes.push(index);
  } else {
    groups.set(key, [index]);
  }
}

/**
 * Reports a server list that carries the same row more than once, both by id
 * and by visible content. Providers that leave rows without a stable id get a
 * fresh random one per read, so a page that was appended twice shows up as
 * duplicated *content* while the id scan only catches the rows that do have a
 * provider id — the content scan is what proves the double append.
 */
export function reportDuplicateServerIds(serverMessages: NormalizedMessage[]): void {
  if (serverMessages.length < 2) return;

  const byId = new Map<string, number[]>();
  const byContent = new Map<string, number[]>();
  for (let index = 0; index < serverMessages.length; index++) {
    const row = serverMessages[index];
    pushGroupIndex(byId, row.id, index);
    if (row.kind === 'text' && row.content) {
      pushGroupIndex(byContent, `${row.role ?? ''}|${row.timestamp}|${row.content}`, index);
    }
  }

  const idGroups = [...byId].filter(([, indexes]) => indexes.length > 1);
  const contentGroups = [...byContent].filter(([, indexes]) => indexes.length > 1);
  if (idGroups.length === 0 && contentGroups.length === 0) return;

  const describe = (indexes: number[]) => indexes.slice(0, 5).map((index) => {
    const row = serverMessages[index];
    return {
      index,
      id: row.id,
      kind: row.kind,
      role: row.role ?? null,
      time: row.timestamp,
      toolId: row.toolId ?? null,
      text: previewText(row.content ?? ''),
    };
  });

  recordOnce(
    `duplicate-server-ids|${serverMessages.length}|${idGroups.length}|${contentGroups.length}|${idGroups.map(([id]) => id).join(',')}`,
    {
      event: 'duplicate-server-ids',
      sessionId: serverMessages[0]?.sessionId ?? null,
      provider: serverMessages[0]?.provider ?? null,
      serverCount: serverMessages.length,
      duplicateCount: idGroups.reduce((sum, [, indexes]) => sum + indexes.length - 1, 0),
      duplicateIds: idGroups.slice(0, 10).map(([id]) => id),
      idGroups: idGroups.slice(0, 5).map(([id, indexes]) => ({
        id,
        indexes: indexes.slice(0, 8),
        rows: describe(indexes),
      })),
      duplicateContentCount: contentGroups.reduce((sum, [, indexes]) => sum + indexes.length - 1, 0),
      contentGroups: contentGroups.slice(0, 5).map(([, indexes]) => ({
        indexes: indexes.slice(0, 8),
        rows: describe(indexes),
      })),
      firstTime: serverMessages[0]?.timestamp ?? null,
      lastTime: serverMessages[serverMessages.length - 1]?.timestamp ?? null,
    },
  );
}

/**
 * Reports the symptom itself: two user rows with the same words in the list the
 * transcript renders. Independent of where the duplicate came from, so it also
 * catches a copy that never passed through the optimistic-echo path.
 */
export function reportDuplicateUserRows(merged: NormalizedMessage[]): void {
  const groups = new Map<string, NormalizedMessage[]>();

  for (const row of merged) {
    if (row.kind !== 'text' || row.role !== 'user') continue;
    const text = normalizeEchoText(row.content ?? '');
    if (!text) continue;
    const group = groups.get(text);
    if (group) {
      group.push(row);
    } else {
      groups.set(text, [row]);
    }
  }

  for (const [text, rows] of groups) {
    if (rows.length < 2) continue;

    for (const cluster of groupBySendWindow(rows)) {
      const firstIndex = merged.indexOf(cluster[0]);
      const around = merged.slice(Math.max(0, firstIndex - 2), firstIndex + 4);
      recordOnce(`duplicate-user-rows|${cluster.map((row) => row.id).join(',')}`, {
        event: 'duplicate-user-rows',
        sessionId: cluster[0].sessionId,
        text: previewText(text),
        rows: cluster.map((row) => ({
          id: row.id,
          optimistic: row.id.startsWith('local_'),
          time: row.timestamp,
          index: merged.indexOf(row),
        })),
        aroundFirst: around.map((row) => ({
          id: row.id,
          role: row.role,
          kind: row.kind,
          time: row.timestamp,
          text: previewText(row.content ?? ''),
        })),
      });
    }
  }
}

/**
 * Splits one text's rows into runs sent close together, keeping only runs of two
 * or more. Rows without a usable timestamp stay in the same run: the words
 * already matched and going blind is worse than a rare false positive.
 */
function groupBySendWindow(rows: NormalizedMessage[]): NormalizedMessage[][] {
  const clusters: NormalizedMessage[][] = [];
  let current: NormalizedMessage[] = [];

  for (const row of rows) {
    const previous = current[current.length - 1];
    if (previous && withinDuplicateWindow(previous, row)) {
      current.push(row);
      continue;
    }
    if (current.length > 1) clusters.push(current);
    current = [row];
  }
  if (current.length > 1) clusters.push(current);
  return clusters;
}

function withinDuplicateWindow(left: NormalizedMessage, right: NormalizedMessage): boolean {
  const leftTime = readMessageTime(left);
  const rightTime = readMessageTime(right);
  if (leftTime === null || rightTime === null) return true;
  return Math.abs(rightTime - leftTime) <= DUPLICATE_USER_ROW_WINDOW_MS;
}

function describeUserEchoMiss(
  localMessage: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  claimedServerIds: Set<string>,
): Record<string, unknown> {
  const localFingerprint = userTurnFingerprint(localMessage);
  const localTime = readMessageTime(localMessage);
  const firstEligibleIndex = findFirstEligibleIndex(localMessage, serverMessages);
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
      replacesKeptTailId: localMessage.replacesKeptTailId ?? null,
      firstEligibleIndex,
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

/**
 * First row of `serverMessages` an edited echo may be retired by. Rows at or
 * before the last row that survived the cut cannot be the replacement, because
 * a provider that rewinds re-stamps them and one may repeat the echo's words.
 *
 * The boundary is an id rather than an index: refreshes replace the window, so
 * an index taken at cut time later points at a different row and skipped the
 * persisted echo. When the boundary row is no longer in the window, every row
 * present is newer than the cut, so nothing has to be skipped.
 */
function findFirstEligibleIndex(
  localMessage: NormalizedMessage,
  serverMessages: NormalizedMessage[],
): number {
  const keptTailId = localMessage.replacesKeptTailId;
  if (!keptTailId) return 0;

  const keptTailIndex = serverMessages.findIndex((message) => message.id === keptTailId);
  return keptTailIndex < 0 ? 0 : keptTailIndex + 1;
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
  const firstEligibleIndex = findFirstEligibleIndex(localMessage, serverMessages);

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
