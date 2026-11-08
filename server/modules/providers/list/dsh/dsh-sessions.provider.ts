import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import { DshForkProvider } from '@/modules/providers/list/dsh/dsh-fork.provider.js';
import { dshRuntime } from '@/modules/providers/list/dsh/dsh-runtime.provider.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import { decodeSessionLogBuffer } from '@/shared/session-log.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import { AppError, createNormalizedMessage, readObjectRecord, readOptionalString, sliceTailPage } from '@/shared/utils.js';

import { getDshSessionsRoot } from './dsh-models.provider.js';
import { findDshSessionLogPath, projectKey, resolveSessionLogPath } from './dsh-session-path.js';

// Session-log decoding lives in `shared/session-log.ts` so the asset collector
// can read the same physical encoding without depending on this module.
export { decodeSessionLogBuffer, decodeZstdFrames } from '@/shared/session-log.js';

/** Concatenates the text of every text block in a DSH content-block array. */
export function extractText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => {
      const record = block as AnyRecord | null;
      return record?.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
    .join('')
    .trim();
}

/**
 * Fallback for sessions created before the runtime announced their ACP id:
 * picks the session log under the project's directory. Only reliable when the
 * project has a single DSH session — with more than one we cannot tell which
 * log belongs to this app session, so empty history is safer than
 * misattributing another session's log as this one's.
 */
function findNewestSessionLog(cwd: string): string | null {
  const projectDir = path.join(getDshSessionsRoot(), projectKey(cwd));
  let entries: string[];
  try {
    entries = readdirSync(projectDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return null;
  }

  if (entries.length !== 1) {
    return null;
  }

  return findDshSessionLogPath(path.join(projectDir, entries[0]));
}

/**
 * Converts one decoded session log into app messages, oldest first
 * (chronological), stamping each conversation row with the `turn/end` it
 * belongs to.
 *
 * The stamp is what the chat wires to "fork from here" and "edit this message".
 * DSH has no per-message cut — a resumable seed always ends on a turn boundary —
 * so the anchor is the seq of the `turn/end` that closes the row's turn. A row
 * in a turn that has not closed yet falls back to the previous closed boundary
 * (copying a half turn would hand the child an unanswered prompt), and a row
 * with no closed boundary before it gets no anchor at all.
 */
/**
 * Parses a tool call's arguments, which DSH stores as the raw JSON string the
 * model emitted. Anything that does not parse is kept verbatim so the UI can
 * still show what the model tried to send instead of dropping the call.
 */
function parseToolArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw ?? '';
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function decodeSessionLog(text: string, appSessionId: string): NormalizedMessage[] {
  const entries: Array<{ event: AnyRecord; data: AnyRecord }> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let event: AnyRecord;
    try {
      event = JSON.parse(line) as AnyRecord;
    } catch {
      continue;
    }
    const data = event.data as AnyRecord | null;
    if (!data) {
      continue;
    }
    entries.push({ event, data });
  }

  const turnEnds = entries
    .filter(({ event }) => event.type === 'turn/end' && typeof event.seq === 'number')
    .map(({ event }) => event.seq as number)
    .sort((left, right) => left - right);

  // A compaction `replace` retracts an earlier span: those rows are still in
  // the file but are no longer part of the conversation the harness sees, so
  // they must not offer an edit or fork entry point.
  const replacedRanges: Array<[number, number]> = [];
  for (const { event } of entries) {
    const operation = readObjectRecord(event.surfaceOp);
    if (operation?.op === 'replace'
      && typeof operation.startSeq === 'number'
      && typeof operation.endSeq === 'number') {
      replacedRanges.push([operation.startSeq, operation.endSeq]);
    }
  }

  /**
   * Index of the first turn end at or after `seq`, or `turnEnds.length` when
   * every turn end precedes it.
   *
   * `turnEnds` is ascending, so this replaces the linear scan the anchor used to
   * run per message — with a `[...turnEnds].reverse()` copy on top of it, which
   * made a long transcript quadratic.
   */
  const firstTurnEndAtOrAfter = (seq: number): number => {
    let low = 0;
    let high = turnEnds.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (turnEnds[middle] < seq) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  };

  const anchorFor = (seq: number): string | undefined => {
    if (replacedRanges.some(([start, end]) => seq >= start && seq <= end)) {
      return undefined;
    }
    const index = firstTurnEndAtOrAfter(seq);
    if (index < turnEnds.length) {
      return String(turnEnds[index]);
    }
    // Past the last turn end: anchor to the closest earlier one, which is the
    // slot before the insertion point. An empty list has none.
    return index === 0 ? undefined : String(turnEnds[index - 1]);
  };

  const messages: NormalizedMessage[] = [];
  for (const { event, data } of entries) {
    const timestamp = typeof event.time === 'number'
      ? new Date(event.time).toISOString()
      : undefined;
    const anchor = typeof event.seq === 'number' ? anchorFor(event.seq) : undefined;

    if (event.type === 'user/message') {
      // The harness interleaves injected context (workspace instructions,
      // runtime snapshots, skill catalogs) as additional user/message events
      // whose `source.kind` differs from 'user'. Only the real prompt should
      // surface in history.
      const source = data.source as AnyRecord | null;
      if (source?.kind && source.kind !== 'user') {
        continue;
      }
      const content = extractText(data.content);
      if (content) {
        const message = createNormalizedMessage({
          kind: 'text',
          role: 'user',
          content,
          sessionId: appSessionId,
          provider: 'dsh',
          ...(timestamp ? { timestamp } : {}),
        });
        if (anchor) {
          message.forkAnchorId = anchor;
          // Only a user's own prompt is editable; injected context never
          // reaches this branch, so the text kind alone is enough.
          message.transcriptAnchorId = String(event.seq);
        }
        messages.push(message);
      }
    } else if (event.type === 'assistant/message') {
      const message = (data.message as AnyRecord | null);
      const blocks = Array.isArray(message?.content) ? message.content : [];
      // `AssistantMessage.source` is always a model source (`kind: 'model'`) whose
      // `model` is the provider model id that produced this reply — the same
      // answer-model provenance the footer shows for Claude.
      const source = message?.source as AnyRecord | null;
      const model = readOptionalString(source?.model);
      // Reasoning blocks precede the reply in the content array; the live
      // path surfaces them as thinking rows, so history must too — otherwise
      // the post-turn reconcile would drop what was just streamed.
      const reasoningText = blocks
        .map((block) => {
          const record = block as AnyRecord | null;
          return record?.type === 'reasoning' && typeof record.text === 'string' ? record.text : '';
        })
        .join('');
      if (reasoningText) {
        // Reasoning has no entry point of its own; the reply row carries it.
        messages.push(createNormalizedMessage({
          kind: 'thinking',
          content: reasoningText,
          sessionId: appSessionId,
          provider: 'dsh',
          ...(timestamp ? { timestamp } : {}),
        }));
      }
      const content = extractText(blocks);
      if (content) {
        const reply = createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content,
          sessionId: appSessionId,
          provider: 'dsh',
          model,
          ...(timestamp ? { timestamp } : {}),
        });
        if (anchor) {
          // Every reply inside one turn shares the same anchor: the turn is
          // the smallest unit DSH can copy, so they all fork to the same point.
          reply.forkAnchorId = anchor;
        }
        messages.push(reply);
      }
    } else if (event.type === 'tool/call') {
      // A tool call is the only record that the run did anything between two
      // prose rows: the harness emits no assistant message for it. Without
      // this branch a turn that only runs tools decodes to nothing at all, so
      // the transcript reads as if the agent never started working.
      const toolId = readOptionalString(data.callId);
      const toolName = readOptionalString(data.name);
      if (toolId && toolName) {
        messages.push(createNormalizedMessage({
          kind: 'tool_use',
          // Keyed by the provider's call id: a reload must produce the same
          // row identity, and the client pairs the result by `toolId`.
          id: `tool_use_${toolId}`,
          content: '',
          sessionId: appSessionId,
          provider: 'dsh',
          toolName,
          toolInput: parseToolArguments(data.arguments),
          toolId,
          ...(timestamp ? { timestamp } : {}),
        }));
      }
    } else if (event.type === 'tool/result') {
      const result = readObjectRecord(data.message);
      const toolId = readOptionalString(result?.toolCallId);
      if (toolId) {
        messages.push(createNormalizedMessage({
          kind: 'tool_result',
          id: `tool_result_${toolId}`,
          content: extractText(result?.content),
          isError: result?.isError === true,
          sessionId: appSessionId,
          provider: 'dsh',
          toolId,
          ...(timestamp ? { timestamp } : {}),
        }));
      }
    }
  }
  return messages;
}

const EMPTY_HISTORY: FetchHistoryResult = {
  messages: [],
  total: 0,
  hasMore: false,
  offset: 0,
  limit: null,
};

/**
 * Provider registry session adapter for DSH.
 *
 * `normalizeMessage` translates the ACP live-stream payloads emitted by the DSH
 * runtime (`agent_message_chunk` / `agent_thought_chunk`) into app messages.
 * `fetchHistory` decodes the harness's JSONL session log (located through the
 * app session row's `provider_session_id` and project path).
 */
export class DshSessionsProvider implements IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    const record = raw as {
      type?: unknown;
      content?: unknown;
      messageId?: unknown;
    } | null;
    if (
      record?.type === 'agent_message_chunk'
      && typeof record.content === 'string'
      && record.content
    ) {
      // The runtime accumulates chunks per `messageId`, so the content is the
      // message's full text so far and the stable id collapses the blocks of
      // one message into a single upserted row.
      const messageId = typeof record.messageId === 'string' ? record.messageId : undefined;
      return [createNormalizedMessage({
        kind: 'text',
        role: 'assistant',
        content: record.content,
        sessionId,
        provider: 'dsh',
        ...(messageId ? { id: messageId } : {}),
      })];
    }
    if (
      record?.type === 'agent_thought_chunk'
      && typeof record.content === 'string'
      && record.content
    ) {
      // Reasoning rides the same messageId as its message's text; the suffix
      // keeps the thinking row's upsert key from colliding with the reply's.
      const messageId = typeof record.messageId === 'string' ? record.messageId : undefined;
      return [createNormalizedMessage({
        kind: 'thinking',
        content: record.content,
        sessionId,
        provider: 'dsh',
        ...(messageId ? { id: `${messageId}#thinking` } : {}),
      })];
    }
    return [];
  }

  async fetchHistory(sessionId: string, options: FetchHistoryOptions = {}): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const row = sessionsDb.getSessionById(sessionId);
    if (!row?.project_path) {
      return EMPTY_HISTORY;
    }

    const acpSessionId = row.provider_session_id?.trim();
    let logPath = acpSessionId
      ? resolveSessionLogPath(acpSessionId, row.project_path)
      : null;
    if (!logPath) {
      logPath = findNewestSessionLog(row.project_path);
    }
    if (!logPath) {
      return EMPTY_HISTORY;
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(logPath);
    } catch {
      return EMPTY_HISTORY;
    }

    const allMessages = decodeSessionLog(decodeSessionLogBuffer(buffer, logPath), sessionId);
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const { page, hasMore } = sliceTailPage(allMessages, normalizedLimit, normalizedOffset);

    return {
      messages: page,
      total: allMessages.length,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
    };
  }

  /**
   * Resolves where a cleared DSH conversation must resume from so that the
   * message identified by `anchorId`, and everything after it, is replaced.
   *
   * DSH cannot resume into the middle of a session: a resumable seed always
   * ends on a `turn/end`. Editing therefore rides the fork path — the answer is
   * the previous turn's `turn/end`, which is the last event the copy keeps.
   * `null` means the edited prompt is in the first turn, so nothing precedes
   * it and the session starts over.
   */
  async resolveEditAnchor(
    sessionId: string,
    anchorId: string,
  ): Promise<{ found: boolean; resumeThroughId: string | null }> {
    const missing = { found: false, resumeThroughId: null };
    if (!/^\d+$/.test(anchorId)) {
      return missing;
    }
    const target = Number.parseInt(anchorId, 10);
    const logText = await this.readCurrentLog(sessionId);
    if (logText === null) {
      return missing;
    }

    const events: AnyRecord[] = [];
    for (const line of logText.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = readObjectRecord(JSON.parse(line) as unknown);
        if (parsed) {
          events.push(parsed);
        }
      } catch {
        // A corrupt line ends the trustworthy part of the log; an anchor past
        // it can no longer be verified, so it is not offered.
      }
    }

    // Only a user's own prompt is editable. Injected context (`source.kind`
    // other than `user`) never carries an anchor in history, and a seq that
    // addresses anything else is not an entry point either.
    const anchor = events.find((event) => event.seq === target && event.type === 'user/message');
    if (!anchor) {
      return missing;
    }
    const data = readObjectRecord(anchor.data);
    const source = readObjectRecord(data?.source);
    if (source?.kind && source.kind !== 'user') {
      return missing;
    }

    const previousBoundary = events
      .filter((event) => event.type === 'turn/end' && typeof event.seq === 'number' && event.seq < target)
      .map((event) => event.seq as number)
      .sort((left, right) => left - right)
      .at(-1);

    return {
      found: true,
      resumeThroughId: previousBoundary === undefined ? null : String(previousBoundary),
    };
  }

  /**
   * Rewinds a DSH session so `keepThroughId` is the last event it holds.
   *
   * The harness has no truncation: a session log is append-only and resume
   * always continues at its tip. Rewinding therefore copies the kept prefix
   * into a fresh seed (the same artifact a fork writes) and moves the row onto
   * it; `null` has no prefix at all, so the row is detached and the next run
   * creates a new conversation.
   *
   * The pre-edit log stays on disk — the abandoned attempt remains recoverable
   * — and is recorded as superseded so neither the indexer nor the history
   * reader can offer it back.
   */
  async rewindSession(sessionId: string, keepThroughId: string | null): Promise<void> {
    const row = sessionsDb.getSessionById(sessionId);
    const providerSessionId = row?.provider_session_id?.trim();
    if (!row || !providerSessionId) {
      throw new AppError('This session has not produced a transcript yet.', {
        code: 'EDIT_SOURCE_NOT_READY',
        statusCode: 409,
      });
    }
    const sourceJsonlPath = row.jsonl_path ?? null;

    if (keepThroughId === null) {
      sessionsDb.supersedeAndDetachSession(sessionId, {
        providerSessionId,
        provider: 'dsh',
        jsonlPath: sourceJsonlPath,
      });
      await releaseAcpSession(providerSessionId);
      return;
    }

    const forked = await this.fork.forkSession({
      providerSessionId,
      jsonlPath: sourceJsonlPath,
      projectPath: row.project_path ?? '',
      upToAnchorId: keepThroughId,
    });
    sessionsDb.repointSessionToProviderSession(sessionId, {
      providerSessionId: forked.providerSessionId,
      jsonlPath: forked.jsonlPath,
      supersededProviderSessionId: providerSessionId,
      supersededJsonlPath: sourceJsonlPath,
    });
    await releaseAcpSession(providerSessionId);
  }

  /** Reads the log the row currently points at, or `null` when it is unreadable. */
  private async readCurrentLog(sessionId: string): Promise<string | null> {
    const row = sessionsDb.getSessionById(sessionId);
    const acpSessionId = row?.provider_session_id?.trim();
    if (!row?.project_path || !acpSessionId) {
      return null;
    }
    const logPath = resolveSessionLogPath(acpSessionId, row.project_path);
    if (!logPath) {
      return null;
    }
    try {
      return decodeSessionLogBuffer(await readFile(logPath), logPath);
    } catch {
      return null;
    }
  }

  private readonly fork = new DshForkProvider();
}

/**
 * Best-effort release of one ACP conversation whose transcript was just
 * edited away.
 *
 * The child keeps the log open for the life of the process, so a conversation
 * left behind would keep appending to a transcript the row no longer points
 * at. A close the child rejects (an id it never served, a child that already
 * exited) is not a reason to fail the edit the user already committed to.
 */
async function releaseAcpSession(acpSessionId: string): Promise<void> {
  try {
    await dshRuntime.disposeSession?.(acpSessionId);
  } catch (error) {
    console.warn(
      `[dsh] Could not release the edited-away session ${acpSessionId}: `
      + (error instanceof Error ? error.message : String(error)),
    );
  }
}
