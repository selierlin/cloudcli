import fsSync from 'node:fs';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import { getZcodeDatabasePath } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { parseFilesInputTag, parseImagesInputTag } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  normalizeProviderTimestamp,
  readJsonRecord,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
  unwrapJsonStringLiteral,
} from '@/shared/utils.js';

const PROVIDER = 'zcode' as const;

type ZcodeHistoryRow = {
  message_id: string;
  message_time_created: number | null;
  message_data: string | null;
  part_id: string | null;
  part_time_created: number | null;
  part_data: string | null;
};

type ZcodeTokenTotals = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Opens the ZCode SQLite store read-only, or returns null when it does not exist. */
const openZcodeDatabase = (): Database.Database | null => {
  const dbPath = getZcodeDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    return null;
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  // The CLI writes through WAL while a run is in flight; a short busy timeout
  // keeps a concurrent read from failing with SQLITE_BUSY.
  db.pragma('busy_timeout = 2000');
  return db;
};

const formatToolContent = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const extractText = (value: unknown): string => {
  if (typeof value === 'string') {
    return unwrapJsonStringLiteral(value);
  }

  const record = readObjectRecord(value);
  const text = readOptionalString(record?.text)
    ?? readOptionalString(record?.content)
    ?? '';
  return unwrapJsonStringLiteral(text);
};

const buildTokenUsage = (totals: ZcodeTokenTotals | undefined): AnyRecord | undefined => {
  if (!totals) {
    return undefined;
  }

  const inputTokens = totals.inputTokens;
  const displayInputTokens = inputTokens + totals.cacheReadTokens;
  const outputTokens = totals.outputTokens;
  const used = inputTokens
    + outputTokens
    + totals.reasoningTokens
    + totals.cacheReadTokens
    + totals.cacheWriteTokens;

  if (used <= 0) {
    return undefined;
  }

  return {
    used,
    inputTokens: displayInputTokens,
    outputTokens,
    breakdown: {
      input: displayInputTokens,
      output: outputTokens,
    },
  };
};

/**
 * Aggregates the session's historical token total from assistant message rows.
 *
 * ZCode stores a per-turn prompt snapshot on each assistant `message.data.tokens`
 * (there are no session-level counters, unlike OpenCode). Summing turns is the
 * history-total reading; the token-usage endpoint deliberately reports only the
 * newest row as current context occupancy.
 */
const aggregateZcodeSessionTokenUsage = (
  db: Database.Database,
  sessionId: string,
): AnyRecord | undefined => {
  const rows = db.prepare('SELECT data FROM message WHERE session_id = ?').all(sessionId) as { data: string }[];

  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  for (const row of rows) {
    const info = readJsonRecord(row.data);
    if (readOptionalString(info?.role) !== 'assistant') {
      continue;
    }

    const tokens = readObjectRecord(info?.tokens);
    if (!tokens) {
      continue;
    }

    inputTokens += Number(tokens.input ?? 0);
    outputTokens += Number(tokens.output ?? 0);
    reasoningTokens += Number(tokens.reasoning ?? 0);
    const cache = readObjectRecord(tokens.cache);
    cacheReadTokens += Number(cache?.read ?? 0);
    cacheWriteTokens += Number(cache?.write ?? 0);
  }

  return buildTokenUsage({
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });
};

/**
 * Session/history adapter for ZCode's OpenCode-derived SQLite store.
 *
 * The `message`/`part` JSON shapes are byte-compatible with OpenCode's, so the
 * history reader is a direct port; the live stream-json normalizer is filled in
 * with the runtime (phase 3).
 */
export class ZcodeSessionsProvider implements IProviderSessions {
  /**
   * Normalizes live ZCode `--output-format stream-json` events.
   *
   * Every event carries a top-level envelope (`type`, `sessionId`, `payload`);
   * the terminal `result` event puts its fields at the top level instead. The
   * runtime owns process lifecycle, session-id extraction and tool-call
   * idempotency; this method only maps one event to app messages.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const event = readObjectRecord(rawMessage);
    if (!event) {
      return [];
    }

    const type = readOptionalString(event.type);
    const payload = readObjectRecord(event.payload) ?? {};
    const eventSessionId = readOptionalString(event.sessionId)
      ?? readOptionalString(payload.sessionId)
      ?? sessionId;
    const timestamp = normalizeProviderTimestamp(event.timestamp ?? payload.timestamp);
    const base = { sessionId: eventSessionId, timestamp, provider: PROVIDER };

    if (type === 'model.streaming') {
      const kind = readOptionalString(payload.kind);
      const assistantMessageId = readOptionalString(payload.assistantMessageId);

      if (kind === 'text_delta' || kind === 'reasoning_delta') {
        const content = readOptionalString(payload.delta) ?? '';
        if (!content) {
          return [];
        }
        return [createNormalizedMessage({
          ...base,
          id: assistantMessageId ? `${assistantMessageId}_${kind}` : undefined,
          kind: 'stream_delta',
          streamChannel: kind === 'reasoning_delta' ? 'thinking' : 'text',
          content,
        })];
      }

      if (kind === 'tool_call') {
        const toolId = readOptionalString(payload.toolCallId) ?? assistantMessageId;
        return [createNormalizedMessage({
          ...base,
          id: toolId,
          kind: 'tool_use',
          role: 'assistant',
          toolName: readOptionalString(payload.toolName) ?? 'Tool',
          toolInput: payload.input ?? {},
          toolId,
        })];
      }

      // start / *_end / tool_input_* / finish carry no renderable state: the
      // tool_call event already includes the complete input.
      return [];
    }

    if (type === 'tool.updated') {
      const kind = readOptionalString(payload.kind);
      const toolId = readOptionalString(payload.toolCallId);

      if (kind === 'result') {
        const result = readObjectRecord(payload.result) ?? {};
        const failed = result.success === false;
        return [createNormalizedMessage({
          ...base,
          id: toolId ? `${toolId}_result` : undefined,
          kind: 'tool_result',
          role: 'user',
          toolId,
          content: formatToolContent(result.content),
          isError: failed,
          status: failed ? 'error' : 'completed',
        })];
      }

      if (kind === 'error') {
        const error = readObjectRecord(payload.error);
        return [createNormalizedMessage({
          ...base,
          id: toolId ? `${toolId}_error` : undefined,
          kind: 'tool_result',
          role: 'user',
          toolId,
          content: formatToolContent(error?.message ?? payload.error),
          isError: true,
          status: 'error',
        })];
      }

      if (kind === 'batch') {
        // A deny produces no `kind=error`; the batch is the only closure for
        // the denied calls. Successful calls were already closed by `result`,
        // and the runtime drops ids it has closed, so marking every id here is
        // safe. A batch with no errors is a pure success notification.
        if (Number(payload.errorCount ?? 0) <= 0) {
          return [];
        }
        const toolCallIds = Array.isArray(payload.toolCallIds) ? payload.toolCallIds : [];
        return toolCallIds.flatMap((rawId): NormalizedMessage[] => {
          const id = readOptionalString(rawId);
          if (!id) {
            return [];
          }
          return [createNormalizedMessage({
            ...base,
            id: `${id}_batch`,
            kind: 'tool_result',
            role: 'user',
            toolId: id,
            content: 'Tool call was denied because headless ZCode has no approval channel.',
            isError: true,
            status: 'denied',
          })];
        });
      }

      // scheduled / started add no information beyond the tool_call event.
      return [];
    }

    if (type === 'permission.resolved') {
      if (readOptionalString(payload.decision) !== 'deny') {
        return [];
      }
      const toolCallId = readOptionalString(payload.toolCallId);
      const toolName = readOptionalString(payload.toolName) ?? 'Tool';
      return [createNormalizedMessage({
        ...base,
        id: toolCallId ? `${toolCallId}_denied` : undefined,
        kind: 'tool_result',
        role: 'user',
        toolId: toolCallId,
        content: readOptionalString(payload.reason) ?? `${toolName} was denied.`,
        isError: true,
        status: 'denied',
      })];
    }

    if (type === 'turn.completed') {
      return [createNormalizedMessage({ ...base, kind: 'stream_end' })];
    }

    // permission.requested (headless always denies immediately — the resolved
    // event carries the outcome), session.titleUpdated, turn.started,
    // session.updated, streamRecovery.updated and result have no render
    // semantics; the runtime handles the terminal `result` itself.
    return [];
  }

  /** Loads ZCode history from the shared SQLite session database. */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    // ZCode keys messages by its provider-native id (`sess_...`), which differs
    // from the app-facing id for sessions started inside CloudCLI.
    const providerSessionId = options.providerSessionId ?? sessionId;
    const db = openZcodeDatabase();
    if (!db) {
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    try {
      const rows = db.prepare(`
        SELECT
          m.id AS message_id,
          m.time_created AS message_time_created,
          m.data AS message_data,
          p.id AS part_id,
          p.time_created AS part_time_created,
          p.data AS part_data
        FROM message m
        LEFT JOIN part p
          ON p.session_id = m.session_id
         AND p.message_id = m.id
        WHERE m.session_id = ?
        ORDER BY
          COALESCE(m.time_created, 0),
          COALESCE(m.sequence, 0),
          m.id,
          COALESCE(p.time_created, 0),
          COALESCE(p.sequence, 0),
          p.id
      `).all(providerSessionId) as ZcodeHistoryRow[];

      const normalized = this.normalizeHistoryRows(rows, sessionId);
      const tokenUsage = aggregateZcodeSessionTokenUsage(db, providerSessionId);

      const normalizedOffset = Math.max(0, offset);
      const normalizedLimit = limit === null ? null : Math.max(0, limit);
      const total = normalized.length;
      const { page, hasMore } = sliceTailPage(normalized, normalizedLimit, normalizedOffset);

      return {
        messages: page,
        total,
        hasMore,
        offset: normalizedOffset,
        limit: normalizedLimit,
        tokenUsage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ZcodeProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    } finally {
      db.close();
    }
  }

  private normalizeHistoryRows(rows: ZcodeHistoryRow[], sessionId: string): NormalizedMessage[] {
    const normalized: NormalizedMessage[] = [];
    const emittedMessageErrors = new Set<string>();

    for (const row of rows) {
      const timestamp = normalizeProviderTimestamp(row.part_time_created ?? row.message_time_created);
      const baseId = `${row.message_id}_${row.part_id ?? normalized.length}`;
      const messageInfo = readJsonRecord(row.message_data);
      const messageRole = readOptionalString(messageInfo?.role);

      if (
        messageInfo
        && messageRole === 'assistant'
        && messageInfo.error != null
        && !emittedMessageErrors.has(row.message_id)
      ) {
        emittedMessageErrors.add(row.message_id);
        normalized.push(createNormalizedMessage({
          id: `${baseId}_error`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'error',
          content: formatToolContent(messageInfo.error),
        }));
      }

      if (!row.part_id) {
        continue;
      }

      const partData = readJsonRecord(row.part_data);
      const partType = readOptionalString(partData?.type);
      if (!partData || !partType) {
        continue;
      }

      if (partType === 'text') {
        const rawContent = extractText(partData);
        // User prompts sent with attachments carry an <images_input> path
        // list; strip it for display and surface the paths as attachments.
        const parsedImages = messageRole === 'user'
          ? parseImagesInputTag(rawContent)
          : { text: rawContent, attachments: [] };
        const parsedFiles = messageRole === 'user'
          ? parseFilesInputTag(parsedImages.text)
          : { text: rawContent, attachments: [] };
        if (
          parsedFiles.text.trim()
          || parsedImages.attachments.length > 0
          || parsedFiles.attachments.length > 0
        ) {
          normalized.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'text',
            role: messageRole === 'user' ? 'user' : 'assistant',
            content: parsedFiles.text,
            images: parsedImages.attachments.length > 0 ? parsedImages.attachments : undefined,
            files: parsedFiles.attachments.length > 0 ? parsedFiles.attachments : undefined,
          }));
        }
        continue;
      }

      if (partType === 'reasoning') {
        const content = extractText(partData);
        if (content.trim()) {
          normalized.push(createNormalizedMessage({
            id: baseId,
            sessionId,
            timestamp,
            provider: PROVIDER,
            kind: 'thinking',
            content,
          }));
        }
        continue;
      }

      if (partType === 'tool') {
        const state = readObjectRecord(partData.state) ?? {};
        const status = readOptionalString(state.status);
        const toolMessage = createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: readOptionalString(partData.tool) ?? 'Tool',
          toolInput: state.input ?? partData.input ?? {},
          toolId: readOptionalString(partData.callID) ?? row.part_id,
        });

        if (status === 'completed' || status === 'error') {
          toolMessage.toolResult = {
            content: formatToolContent(state.output ?? state.error),
            isError: status === 'error',
          };
        }

        normalized.push(toolMessage);
        continue;
      }

      if (partType === 'step-finish') {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'stream_end',
        }));
        continue;
      }

      if (partType === 'patch' || partType === 'agent') {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: partType === 'patch' ? 'Patch' : 'Agent',
          toolInput: partData,
          toolId: row.part_id,
        }));
      }
    }

    return normalized;
  }
}

/**
 * Finds the provider-native session id for a run that never announced one.
 *
 * The stream-json envelope carries `sessionId` from the first event in the
 * verified 0.16.5 build, so this is only a fallback. It must not stitch a run
 * to a concurrent session in the same directory: it matches the run's `--cwd`
 * (both the raw value and its realpath) and only rows created at or after the
 * spawn time, and skips any session already bound to an app session.
 */
export function findZcodeSessionForRun(directory: string, since: Date): string | null {
  const dbPath = getZcodeDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    return null;
  }

  let realDirectory = directory;
  try {
    realDirectory = fsSync.realpathSync(directory);
  } catch {
    // The directory may already be gone; the raw value still matches.
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 2000');
    const rows = db.prepare(`
      SELECT id FROM session
      WHERE time_archived IS NULL
        AND directory IN (?, ?)
        AND COALESCE(time_created, 0) >= ?
      ORDER BY COALESCE(time_created, 0) DESC, id DESC
    `).all(directory, realDirectory, since.getTime()) as { id: string | null }[];

    for (const row of rows) {
      const id = readOptionalString(row.id);
      if (!id) {
        continue;
      }
      if (!sessionsDb.getSessionByProviderSessionId(id)) {
        return id;
      }
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[ZcodeProvider] Failed to resolve a session id from sqlite:', message);
    return null;
  } finally {
    db.close();
  }
}
