import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import { AppError, createNormalizedMessage, readObjectRecord, sliceTailPage } from '@/shared/utils.js';
import { getPiSessionsRoot } from '@/modules/providers/list/pi/pi-models.provider.js';
import { forkPiTranscriptPrefix } from '@/modules/providers/list/pi/pi-fork.provider.js';

/** Mirrors Pi's directory encoding (session-manager.js): strip leading slash, map `/\:` to `-`, wrap in `--…--`. */
function encodePiCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/**
 * Resolves the transcript path for one Pi session (header UUID). Pi names
 * files `<ISO时间戳>_<UUID>.jsonl`, so the encoded-cwd directory is scanned
 * for a matching suffix first; a full recursive search over the sessions root
 * covers cwd-encoding edge characters (spaces, unicode, dashes).
 */
export async function resolvePiTranscriptPath(
  providerSessionId: string,
  projectPath: string | undefined,
  sessionsRoot = getPiSessionsRoot(),
): Promise<string | null> {
  const suffix = `_${providerSessionId}.jsonl`;
  const encoded = projectPath ? encodePiCwd(projectPath) : '';

  const encodedDir = path.join(sessionsRoot, encoded);
  try {
    for (const name of await fsp.readdir(encodedDir)) {
      if (name.endsWith(suffix)) {
        return path.join(encodedDir, name);
      }
    }
  } catch {
    // Encoded directory may not exist yet; fall through to recursive search.
  }

  return findTranscriptBySuffix(sessionsRoot, suffix);
}

async function findTranscriptBySuffix(root: string, suffix: string): Promise<string | null> {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findTranscriptBySuffix(path.join(root, entry.name), suffix);
      if (found) {
        return found;
      }
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return path.join(root, entry.name);
    }
  }
  return null;
}

/** Parses one JSONL line defensively, returning null for blank or malformed rows. */
function parseLine(line: string): AnyRecord | null {
  if (!line.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(line) as unknown;
    return readObjectRecord(parsed);
  } catch {
    return null;
  }
}

/** Redacts credential-shaped substrings from an error payload (mirrors WorkBuddy). */
export function redactPiDiagnosticText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*Bearer\s+)[^\s,;}]+/gi, '$1[REDACTED]')
    .replace(
      /((?:authorization|cookie|x-api-key|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|password)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      '$1[REDACTED]',
    )
    .slice(0, 2000);
}

/** Reads the entry-level ISO timestamp so repeated reads stay stable. */
function readEntryTimestamp(entry: AnyRecord): string | undefined {
  if (typeof entry.timestamp === 'string' && entry.timestamp.trim()) {
    return entry.timestamp;
  }
  if (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)) {
    return new Date(entry.timestamp).toISOString();
  }
  return undefined;
}

type PiContentBlock = {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  data?: unknown;
  mimeType?: unknown;
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
};

type PiAgentMessage = {
  role?: unknown;
  content?: unknown;
  /** The model recorded on an assistant message, shown in the reply footer. */
  model?: unknown;
  timestamp?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  isError?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
  usage?: unknown;
  display?: unknown;
  customType?: unknown;
  summary?: unknown;
};

const readNonEmptyString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

/**
 * Normalizes one Pi AgentMessage (history entry or live `message_end`) into
 * app messages, oldest-first, and stamps every row with the entry id that owns
 * it.
 *
 * The stamp is what the chat UI wires to its "fork from here" and "edit this
 * message" actions: Pi's fork cut is per entry, so a fork from any row of an
 * entry keeps the active branch up to and including that entry, and an edit of
 * a user row replaces that entry and everything after it. See
 * {@link buildPiAgentMessages} for the row mapping itself.
 */
export function normalizePiAgentMessage(
  message: PiAgentMessage,
  entryId: string | undefined,
  sessionId: string | null,
  timestamp?: string,
): NormalizedMessage[] {
  const messages = buildPiAgentMessages(message, entryId, sessionId, timestamp);
  if (entryId) {
    for (const normalized of messages) {
      normalized.forkAnchorId = entryId;
      // Only a user's own prompt is editable; a tool result is a `user`-role
      // row too, so the anchor is gated on the text kind rather than the role.
      if (normalized.kind === 'text' && normalized.role === 'user') {
        normalized.transcriptAnchorId = entryId;
      }
    }
  }
  return messages;
}

/**
 * Normalizes one Pi AgentMessage (history entry or live `message_end`) into
 * app messages, oldest-first. Content blocks map one-to-one (thinking/text/tool
 * call), image blocks become inline data URLs (Pi stores base64 in the
 * transcript), tool results stay visible as tool events, and a terminal error
 * appends a redacted error row.
 *
 * Message ids are derived from the entry id so history reads stay stable:
 * `pi-<entryId>` with a `-<blockIndex>` discriminator when one entry produces
 * multiple rows.
 */
function buildPiAgentMessages(
  message: PiAgentMessage,
  entryId: string | undefined,
  sessionId: string | null,
  timestamp?: string,
): NormalizedMessage[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const baseId = entryId ? `pi-${entryId}` : undefined;
  const role = message.role;
  const content = message.content;
  const blocks: PiContentBlock[] = Array.isArray(content) ? content : [];

  // Terminal errors are surfaced as a separate row after the assistant turn.
  const isErrorTurn = role === 'assistant' && message.stopReason === 'error';
  const errorText = readNonEmptyString(message.errorMessage);

  const messages: NormalizedMessage[] = [];

  if (role === 'toolResult') {
    const textParts: string[] = [];
    const images: Array<{ data: string; name?: string }> = [];
    for (const block of blocks) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text);
      } else if (block?.type === 'image' && typeof block.data === 'string') {
        images.push({ data: dataUrlFromPiImage(block) });
      }
    }
    messages.push(createNormalizedMessage({
      kind: 'tool_result',
      role: 'user',
      content: textParts.join('\n'),
      images: images.length > 0 ? images : undefined,
      toolId: readNonEmptyString(message.toolCallId) ?? undefined,
      toolName: readNonEmptyString(message.toolName) ?? undefined,
      isError: message.isError === true,
      id: baseId,
      sessionId,
      provider: 'pi',
      timestamp,
    }));
    return messages;
  }

  if (role === 'user') {
    if (typeof content === 'string') {
      if (content.trim()) {
        messages.push(createNormalizedMessage({
          kind: 'text',
          role: 'user',
          content: content.trim(),
          id: baseId,
          sessionId,
          provider: 'pi',
          timestamp,
        }));
      }
    } else {
      const textParts: string[] = [];
      const images: Array<{ data: string; name?: string }> = [];
      for (const block of blocks) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          textParts.push(block.text);
        } else if (block?.type === 'image' && typeof block.data === 'string') {
          images.push({ data: dataUrlFromPiImage(block) });
        }
      }
      if (textParts.length > 0 || images.length > 0) {
        messages.push(createNormalizedMessage({
          kind: 'text',
          role: 'user',
          content: textParts.join('\n'),
          images: images.length > 0 ? images : undefined,
          id: baseId,
          sessionId,
          provider: 'pi',
          timestamp,
        }));
      }
    }
    return messages;
  }

  if (role === 'compactionSummary' || role === 'branchSummary') {
    const summary = readNonEmptyString(message.summary, message.content);
    if (summary) {
      messages.push(createNormalizedMessage({
        kind: 'text',
        role: 'user',
        content: summary,
        isCompactSummary: true,
        id: baseId,
        sessionId,
        provider: 'pi',
        timestamp,
      }));
    }
    return messages;
  }

  if (role === 'custom') {
    const display = message.display !== false;
    if (!display) {
      return messages;
    }
    if (typeof content === 'string') {
      if (content.trim()) {
        messages.push(createNormalizedMessage({
          kind: 'text',
          role: 'user',
          content: content.trim(),
          id: baseId,
          sessionId,
          provider: 'pi',
          timestamp,
        }));
      }
    } else {
      const textParts: string[] = [];
      for (const block of blocks) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          textParts.push(block.text);
        }
      }
      if (textParts.length > 0) {
        messages.push(createNormalizedMessage({
          kind: 'text',
          role: 'user',
          content: textParts.join('\n'),
          id: baseId,
          sessionId,
          provider: 'pi',
          timestamp,
        }));
      }
    }
    return messages;
  }

  // Assistant: one row per content block so thinking precedes the answer.
  for (const [blockIndex, block] of blocks.entries()) {
    if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
      messages.push(createNormalizedMessage({
        kind: 'thinking',
        role: 'assistant',
        content: block.thinking,
        id: blockId(baseId, blockIndex, messages.length),
        sessionId,
        provider: 'pi',
        timestamp,
      }));
    } else if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      messages.push(createNormalizedMessage({
        kind: 'text',
        role: 'assistant',
        content: block.text,
        // Pi records the answering model on the assistant message itself, so
        // the reply footer names it without consulting `model_change`.
        model: readNonEmptyString(message.model),
        id: blockId(baseId, blockIndex, messages.length),
        sessionId,
        provider: 'pi',
        timestamp,
      }));
    } else if (block?.type === 'toolCall' && readNonEmptyString(block.name)) {
      messages.push(createNormalizedMessage({
        kind: 'tool_use',
        role: 'assistant',
        toolName: readNonEmptyString(block.name) ?? '',
        toolInput: block.arguments,
        toolId: readNonEmptyString(block.id) ?? undefined,
        id: blockId(baseId, blockIndex, messages.length),
        sessionId,
        provider: 'pi',
        timestamp,
      }));
    }
  }

  if (typeof content === 'string' && content.trim() && messages.length === 0) {
    messages.push(createNormalizedMessage({
      kind: 'text',
      role: 'assistant',
      content: content.trim(),
      id: baseId,
      sessionId,
      provider: 'pi',
      timestamp,
    }));
  }

  if (isErrorTurn && errorText) {
    messages.push(createNormalizedMessage({
      kind: 'error',
      role: 'assistant',
      content: redactPiDiagnosticText(errorText),
      id: baseId ? `${baseId}-error` : undefined,
      sessionId,
      provider: 'pi',
      timestamp,
    }));
  }

  return messages;
}

const blockId = (baseId: string | undefined, blockIndex: number, emitted: number): string | undefined => {
  if (!baseId) {
    return undefined;
  }
  // Discriminate rows produced by one entry so ids never collide; the index
  // is the position among all rows already emitted for this entry.
  return emitted > 0 ? `${baseId}-${emitted}` : baseId;
};

function dataUrlFromPiImage(block: PiContentBlock): string {
  const mime = typeof block.mimeType === 'string' && block.mimeType
    ? block.mimeType
    : 'image/png';
  return `data:${mime};base64,${block.data}`;
}

/** Parses a Pi transcript into its non-header entries, in file order. */
async function readPiEntries(filePath: string): Promise<AnyRecord[]> {
  let content: string;
  try {
    content = await fsp.readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  const entries: AnyRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed && parsed.type !== 'session') {
      entries.push(parsed);
    }
  }
  return entries;
}

/**
 * Returns the active branch of a Pi transcript, oldest first: the file's last
 * entry walked up its `parentId` chain to the root. Reached this way, entries
 * from branches the conversation abandoned are left out.
 */
function piActiveBranch(entries: AnyRecord[]): AnyRecord[] {
  const byId = new Map<string, AnyRecord>();
  for (const entry of entries) {
    if (typeof entry.id === 'string') {
      byId.set(entry.id, entry);
    }
  }
  const branch: AnyRecord[] = [];
  const seen = new Set<string>();
  let cursor: unknown = entries[entries.length - 1]?.id;
  while (typeof cursor === 'string' && !seen.has(cursor)) {
    const entry = byId.get(cursor);
    if (!entry) {
      break;
    }
    seen.add(cursor);
    branch.push(entry);
    cursor = entry.parentId;
  }
  branch.reverse();
  return branch;
}

/** Whether a Pi entry is a user's own prompt, the only kind an edit replaces. */
function isPiUserPromptEntry(entry: AnyRecord): boolean {
  return entry.type === 'message' && readObjectRecord(entry.message)?.role === 'user';
}

type StoredHistoryMessage = {
  sequence: number;
  message: NormalizedMessage;
};

type TranscriptReadResult = {
  messages: NormalizedMessage[];
  total: number;
  tokenUsage?: unknown;
};

/**
 * Tail-bounded collector: keeps the newest `maxMessages` rows (mirroring the
 * WorkBuddy reader) while `total` counts every row so pagination math stays
 * exact. Pi has no Todo/Task folding, so this stays a plain insertion map.
 */
class TranscriptMessageCollector {
  private nextSequence = 0;
  private readonly retainedMessages = new Map<number, StoredHistoryMessage>();

  constructor(private readonly maxMessages: number | null) {}

  add(message: NormalizedMessage): void {
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    if (this.maxMessages === 0) {
      return;
    }
    this.retainedMessages.set(sequence, { sequence, message });
    if (this.maxMessages === null || this.retainedMessages.size <= this.maxMessages) {
      return;
    }
    const oldestSequence = this.retainedMessages.keys().next().value;
    if (oldestSequence !== undefined) {
      this.retainedMessages.delete(oldestSequence);
    }
  }

  toResult(): TranscriptReadResult {
    return {
      messages: [...this.retainedMessages.values()].map(({ message }) => message),
      total: this.nextSequence,
    };
  }
}

/** Applies the shared tail-page contract to a retained tail window. */
function sliceRetainedTailPage<T>(
  retainedMessages: T[],
  total: number,
  limit: number | null,
  offset: number,
): { page: T[]; hasMore: boolean } {
  if (limit === null) {
    return sliceTailPage(retainedMessages, limit, offset);
  }
  const end = Math.max(0, total - offset);
  const start = Math.max(0, end - Math.max(0, limit));
  const firstRetainedIndex = Math.max(0, total - retainedMessages.length);
  return {
    page: retainedMessages.slice(
      Math.max(0, start - firstRetainedIndex),
      Math.max(0, end - firstRetainedIndex),
    ),
    hasMore: start > 0,
  };
}

const EMPTY_HISTORY: FetchHistoryResult = {
  messages: [],
  total: 0,
  hasMore: false,
  offset: 0,
  limit: null,
};

/** Summarizes the newest assistant usage on the active path for the token counter. */
function summarizePiTokenUsage(activeEntries: AnyRecord[]): unknown {
  for (let index = activeEntries.length - 1; index >= 0; index -= 1) {
    const entry = activeEntries[index];
    if (entry?.type !== 'message' || entry.message?.role !== 'assistant') {
      continue;
    }
    const usage = readObjectRecord(entry.message?.usage);
    if (!usage) {
      continue;
    }
    const readNumber = (value: unknown): number => (
      typeof value === 'number' && Number.isFinite(value) ? value : 0
    );
    const input = readNumber(usage.input);
    const output = readNumber(usage.output);
    const cacheRead = readNumber(usage.cacheRead);
    const cacheWrite = readNumber(usage.cacheWrite);
    const totalTokens = readNumber(usage.totalTokens);
    const cacheTokens = cacheRead + cacheWrite;
    return {
      used: input + output,
      total: totalTokens > 0 ? totalTokens : 160_000,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheWrite,
      cacheTokens,
      breakdown: { input: input + cacheTokens, output },
    };
  }
  return undefined;
}

/**
 * Provider registry sessions adapter for Pi.
 *
 * `normalizeMessage` translates both persisted entries and live `message_end`
 * payloads into app messages (see {@link normalizePiAgentMessage}).
 * `fetchHistory` reads a session's JSONL, walks the current branch from the
 * leaf entry back to the root (dropping abandoned branches), honors the latest
 * compaction entry per Pi's `buildContextEntries` semantics, and paginates.
 */
export class PiSessionsProvider implements IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    const entry = readObjectRecord(raw);
    if (!entry) {
      return [];
    }

    // Token-level live deltas: Pi's `message_update` wraps the assistant's
    // incremental event, whose `delta` text belongs to the reply
    // (`text_delta`) or the reasoning trace (`thinking_delta`). The channel
    // travels with the frame so the client buffers them into separate rows.
    if (entry.type === 'message_update') {
      const update = readObjectRecord(entry.assistantMessageEvent);
      const updateType = typeof update?.type === 'string' ? update.type : '';
      const delta = typeof update?.delta === 'string' ? update.delta : '';
      if (updateType === 'thinking_delta' && delta) {
        return [createNormalizedMessage({
          kind: 'stream_delta',
          streamChannel: 'thinking',
          content: delta,
          sessionId,
          provider: 'pi',
        })];
      }
      if (updateType === 'text_delta' && delta) {
        return [createNormalizedMessage({
          kind: 'stream_delta',
          streamChannel: 'text',
          content: delta,
          sessionId,
          provider: 'pi',
        })];
      }
      return [];
    }

    // Accept either a message entry ({ type, id, timestamp, message }) or a
    // bare AgentMessage; the wrapper fields give stable history ids.
    const message = readObjectRecord(entry.message);
    if (message) {
      return normalizePiAgentMessage(
        message as PiAgentMessage,
        typeof entry.id === 'string' ? entry.id : undefined,
        sessionId,
        readEntryTimestamp(entry),
      );
    }
    return normalizePiAgentMessage(entry as PiAgentMessage, undefined, sessionId);
  }

  async fetchHistory(sessionId: string, options: FetchHistoryOptions = {}): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0, providerSessionId, projectPath } = options;
    const row = sessionsDb.getSessionById(sessionId);
    const engineSessionId = providerSessionId ?? row?.provider_session_id?.trim();
    if (!engineSessionId) {
      return EMPTY_HISTORY;
    }

    const filePath = row?.jsonl_path
      ? (existsSync(row.jsonl_path) ? row.jsonl_path : null)
      : await resolvePiTranscriptPath(engineSessionId, projectPath ?? row?.project_path ?? undefined);
    if (!filePath) {
      return EMPTY_HISTORY;
    }

    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const retention = normalizedLimit === null ? null : normalizedOffset + normalizedLimit;
    const { messages: retainedMessages, total, tokenUsage } = await this.readTranscript(
      filePath,
      sessionId,
      retention,
    );
    const { page, hasMore } = sliceRetainedTailPage(
      retainedMessages,
      total,
      normalizedLimit,
      normalizedOffset,
    );

    return {
      messages: page,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
      tokenUsage,
    };
  }

  /**
   * Resolves where a Pi conversation must resume from so that the message
   * identified by `anchorId`, and everything after it, is replaced.
   *
   * Pi has no "truncate at an entry" resume flag, so an edit rides the same
   * file copy a fork does: the entry right before the edited prompt is the one
   * the copy must keep through. `null` means no turn precedes it — editing the
   * first prompt starts the conversation over rather than resuming.
   */
  async resolveEditAnchor(
    sessionId: string,
    anchorId: string,
  ): Promise<{ found: boolean; resumeThroughId: string | null }> {
    const row = sessionsDb.getSessionById(sessionId);
    const engineSessionId = row?.provider_session_id?.trim();
    if (!row || !engineSessionId) {
      return { found: false, resumeThroughId: null };
    }
    const filePath = await this.resolveTranscriptFile(row, engineSessionId);
    if (!filePath) {
      return { found: false, resumeThroughId: null };
    }

    const branch = piActiveBranch(await readPiEntries(filePath));
    const index = branch.findIndex((entry) => entry.id === anchorId && isPiUserPromptEntry(entry));
    if (index < 0) {
      return { found: false, resumeThroughId: null };
    }

    // Editing the first prompt has no completed turn to resume through, so the
    // conversation starts over. Pi brackets a session with bookkeeping entries
    // (`model_change`, `thinking_level_change`), but keeping only those would
    // leave a degenerate conversation, so they do not count as a turn.
    if (!branch.slice(0, index).some(isPiUserPromptEntry)) {
      return { found: true, resumeThroughId: null };
    }

    const predecessor = branch[index - 1];
    return {
      found: true,
      resumeThroughId: typeof predecessor?.id === 'string' ? predecessor.id : null,
    };
  }

  /**
   * Rewinds a Pi session so `keepThroughId` is the last entry it holds.
   *
   * Pi transcripts are append-only — `--session` resumes one at its tip and
   * nothing shortens it — so rewinding means copying the kept prefix into a new
   * transcript file and moving the session onto it. The pre-edit file stays on
   * disk and is recorded as superseded so the indexer does not hand it back.
   */
  async rewindSession(sessionId: string, keepThroughId: string | null): Promise<void> {
    const row = sessionsDb.getSessionById(sessionId);
    const providerSessionId = row?.provider_session_id;
    if (!row || !providerSessionId) {
      throw new AppError('This session has not produced a transcript yet.', {
        code: 'EDIT_SOURCE_NOT_READY',
        statusCode: 409,
      });
    }

    if (keepThroughId === null) {
      sessionsDb.markProviderSessionSuperseded({
        providerSessionId,
        provider: 'pi',
        sessionId,
        jsonlPath: row.jsonl_path ?? null,
      });
      sessionsDb.detachProviderSession(sessionId);
      return;
    }

    const filePath = await this.resolveTranscriptFile(row, providerSessionId);
    if (!filePath) {
      throw new AppError('The Pi transcript is unavailable.', {
        code: 'EDIT_SOURCE_UNREADABLE',
        statusCode: 409,
      });
    }

    const forked = await forkPiTranscriptPrefix({
      providerSessionId,
      jsonlPath: filePath,
      projectPath: row.project_path ?? '',
      upToAnchorId: keepThroughId,
    });
    sessionsDb.markProviderSessionSuperseded({
      providerSessionId,
      provider: 'pi',
      sessionId,
      jsonlPath: filePath,
    });
    sessionsDb.repointSessionToProviderSession(sessionId, {
      ...forked,
      supersededProviderSessionId: providerSessionId,
    });
  }

  /**
   * Resolves the on-disk transcript backing one session row, preferring the
   * indexed path and falling back to a suffix scan of the sessions root when
   * the watcher has not recorded one.
   */
  private async resolveTranscriptFile(
    row: { jsonl_path?: string | null; project_path?: string | null } | undefined,
    engineSessionId: string,
  ): Promise<string | null> {
    if (row?.jsonl_path) {
      return existsSync(row.jsonl_path) ? row.jsonl_path : null;
    }
    return resolvePiTranscriptPath(engineSessionId, row?.project_path ?? undefined);
  }

  /**
   * Decodes a persisted Pi transcript into app messages, oldest first, walking
   * the active branch from the file's last entry up its `parentId` chain.
   */
  private async readTranscript(
    filePath: string,
    appSessionId: string,
    maxMessages: number | null,
  ): Promise<TranscriptReadResult> {
    const collector = new TranscriptMessageCollector(maxMessages);

    let fileContent: string;
    try {
      fileContent = await fsp.readFile(filePath, 'utf8');
    } catch {
      return collector.toResult();
    }

    const entries: AnyRecord[] = [];
    for (const line of fileContent.split(/\r?\n/)) {
      const parsed = parseLine(line);
      if (parsed && parsed.type !== 'session') {
        entries.push(parsed);
      }
    }

    if (entries.length === 0) {
      return collector.toResult();
    }

    // Active branch = the last entry, walked up via parentId to the root.
    const byId = new Map<string, AnyRecord>();
    for (const entry of entries) {
      if (typeof entry.id === 'string') {
        byId.set(entry.id, entry);
      }
    }
    const activePath: AnyRecord[] = [];
    let cursor = entries[entries.length - 1].id;
    const seen = new Set<string>();
    while (typeof cursor === 'string' && !seen.has(cursor)) {
      const entry = byId.get(cursor);
      if (!entry) {
        break;
      }
      seen.add(cursor);
      activePath.push(entry);
      cursor = entry.parentId;
    }
    activePath.reverse();

    // Latest compaction entry on the path governs the retained range.
    let compactionIndex = -1;
    for (let index = activePath.length - 1; index >= 0; index -= 1) {
      if (activePath[index].type === 'compaction') {
        compactionIndex = index;
        break;
      }
    }

    let startIndex = 0;
    let retainedTailMessages: PiAgentMessage[] | null = null;
    if (compactionIndex >= 0) {
      const compaction = activePath[compactionIndex];
      const retainedTail = compaction.retainedTail;
      if (Array.isArray(retainedTail)) {
        retainedTailMessages = retainedTail.filter(
          (message): message is PiAgentMessage => readObjectRecord(message) !== null,
        );
      } else {
        const firstKeptId = readNonEmptyString(compaction.firstKeptEntryId);
        if (firstKeptId) {
          const firstKeptIndex = activePath.findIndex((entry) => entry.id === firstKeptId);
          if (firstKeptIndex >= 0) {
            startIndex = firstKeptIndex;
          }
        }
      }
    }

    const processEntry = (entry: AnyRecord): void => {
      const entryId = typeof entry.id === 'string' ? entry.id : undefined;
      const timestamp = readEntryTimestamp(entry);

      if (entry.type === 'message') {
        for (const message of normalizePiAgentMessage(
          entry.message as PiAgentMessage,
          entryId,
          appSessionId,
          timestamp,
        )) {
          collector.add(message);
        }
        return;
      }

      if (entry.type === 'branch_summary') {
        const summary = readNonEmptyString(entry.summary);
        if (summary) {
          collector.add(createNormalizedMessage({
            kind: 'text',
            role: 'user',
            content: summary,
            isCompactSummary: true,
            id: entryId ? `pi-${entryId}` : undefined,
            sessionId: appSessionId,
            provider: 'pi',
            timestamp,
          }));
        }
      }
      // model_change, thinking_level_change, label, custom, session_info: no UI row.
    };

    if (compactionIndex < 0) {
      for (let index = startIndex; index < activePath.length; index += 1) {
        processEntry(activePath[index]);
      }
    } else {
      // Official buildContextEntries order: the compaction summary comes
      // first, then entries retained from firstKeptEntryId up to the
      // compaction, then everything after it.
      const compaction = activePath[compactionIndex];
      const summary = readNonEmptyString(compaction.summary);
      if (summary) {
        collector.add(createNormalizedMessage({
          kind: 'text',
          role: 'user',
          content: summary,
          isCompactSummary: true,
          id: `pi-${compaction.id}`,
          sessionId: appSessionId,
          provider: 'pi',
          timestamp: readEntryTimestamp(compaction),
        }));
      }
      if (retainedTailMessages) {
        // Defensive compat: newer Pi snapshots carry the kept tail inline.
        for (const message of retainedTailMessages) {
          for (const normalized of normalizePiAgentMessage(
            message,
            undefined,
            appSessionId,
            readEntryTimestamp(compaction),
          )) {
            collector.add(normalized);
          }
        }
      } else {
        for (let index = startIndex; index < compactionIndex; index += 1) {
          processEntry(activePath[index]);
        }
      }
      for (let index = compactionIndex + 1; index < activePath.length; index += 1) {
        processEntry(activePath[index]);
      }
    }

    const result = collector.toResult();
    result.tokenUsage = summarizePiTokenUsage(activePath);
    return result;
  }
}
