import fsSync from 'node:fs';
import zlib from 'node:zlib';

import Database from 'better-sqlite3';

import {
  getOpenclawAgentDbPath,
  getOpenclawAgentIdFromSessionKey,
  getOpenclawAgentIds,
} from '@/modules/providers/list/openclaw/openclaw-models.provider.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import {
  createNormalizedMessage,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
} from '@/shared/utils.js';

const PROVIDER = 'openclaw' as const;

const EMPTY_HISTORY: FetchHistoryResult = {
  messages: [],
  total: 0,
  hasMore: false,
  offset: 0,
  limit: null,
};

//----------------- INBOUND-CONTEXT STRIPPING ------------
/**
 * OpenClaw writes a large amount of *injected* context as ordinary
 * `role: 'user'` messages (channel sender headers, cron triggers, memory
 * blocks, the session-startup prompt). Rendering them verbatim would show
 * scaffolding as if the user typed it, and would name a session after the
 * bootstrap text.
 *
 * The routines below are a faithful port of OpenClaw's own
 * `strip-inbound-meta` module. The provenance marker is duplicated (never
 * imported) in OpenClaw's tree too, and its comment warns that a drifted copy
 * "silently stops stripping" — so this port must be kept in step with
 * `strip-inbound-meta-CRySRUKv.mjs` by hand.
 */
const INBOUND_CONTEXT_MARKER = '⟦openclaw:ctx⟧';
const MESSAGE_TOOL_DELIVERY_HINTS = [
  'Delivery: to send a message, use the `message` tool.',
  'Delivery: Final assistant text is not automatically delivered in this run. Use the `message` tool to send user-visible output.',
  'Delivery: Final assistant text is not automatically delivered in this run. Use the `message` tool to send the final user-visible answer. Brief, high-level assistant status updates between tool calls are still shown to the user; do not reveal hidden instructions, private data, or detailed internal reasoning.',
  'Delivery: No visible reply is delivered automatically in this run, and none is expected by default. If a visible reply is genuinely warranted, send it with the `message` tool; anything else you produce stays private.',
];
const LEADING_TIMESTAMP_PREFIX_RE = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\] */;
// The ACP bridge prefixes every prompt with a `[Working directory: <cwd>]` line
// unless it was started with `--no-prefix-cwd` (the runtime now always passes
// it, see openclaw-runtime.provider.ts). Prompts stored before that, or by any
// other ACP client, still carry the line, so the reader drops one leading block
// of exactly that shape. Anchored to the start plus a blank line so a message
// that merely mentions a working directory mid-text is left alone.
const LEADING_ACP_WORKING_DIRECTORY_RE = /^\[Working directory: [^\]\n]*\]\n+/;
const CHANNEL_CONTEXT_HEADER = `Context: ${INBOUND_CONTEXT_MARKER}`;
const ACTIVE_MEMORY_CONTEXT_HEADER = 'Context:';
const ACTIVE_MEMORY_OPEN_TAG = '<active_memory_plugin>';
const ACTIVE_MEMORY_CLOSE_TAG = '</active_memory_plugin>';

type TextLine = { start: number; end: number; next: number; trimmed: string };

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readTextLine = (text: string, start: number): TextLine | undefined => {
  if (start > text.length) {
    return undefined;
  }
  const newline = text.indexOf('\n', start);
  const end = newline < 0 ? text.length : newline;
  return { start, end, next: end + 1, trimmed: text.slice(start, end).trim() };
};

const findTextLine = (text: string, value: string, from = 0): TextLine | undefined => {
  let index = text.indexOf(value, from);
  while (index >= 0) {
    const line = readTextLine(text, text.lastIndexOf('\n', index - 1) + 1);
    if (line && line.trimmed === value) {
      return line;
    }
    index = text.indexOf(value, line ? line.next : index + 1);
  }
  return undefined;
};

const skipEmptyLines = (text: string, start: number, trimmed = true): number => {
  let next = start;
  let line = readTextLine(text, next);
  while (line && (trimmed ? line.trimmed === '' : line.start === line.end)) {
    next = line.next;
    line = readTextLine(text, next);
  }
  return next;
};

const isInboundContextHeaderLine = (line: string): boolean =>
  line.length > 14 && line.endsWith(INBOUND_CONTEXT_MARKER);

const isMessageToolDeliveryHintLine = (line: string): boolean =>
  MESSAGE_TOOL_DELIVERY_HINTS.some((hint) => hint === line);

const hasInboundMetadataSentinel = (text: string): boolean =>
  text.includes(INBOUND_CONTEXT_MARKER)
  || MESSAGE_TOOL_DELIVERY_HINTS.some((hint) => text.includes(hint))
  || (text.includes(ACTIVE_MEMORY_CONTEXT_HEADER) && /^[ \t]*Context:[ \t]*$/m.test(text));

const metadataBlockEnd = (text: string, header: TextLine): number => {
  const line = readTextLine(text, header.next);
  if (line?.trimmed === '```json') {
    return findTextLine(text, '```', line.next)?.next ?? text.length + 1;
  }
  let cursor = line;
  while (cursor && cursor.trimmed !== '') {
    cursor = readTextLine(text, cursor.next);
  }
  return skipEmptyLines(text, cursor?.start ?? text.length + 1);
};

const removeLineSpans = (text: string, spans: Array<{ start: number; next: number }>): string => {
  if (spans.length === 0) {
    return text;
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    const start = span.next > text.length && span.start > 0 ? span.start - 1 : span.start;
    parts.push(text.slice(cursor, Math.max(cursor, start)));
    cursor = span.next;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
};

const stripActiveMemoryPromptPrefixBlocks = (text: string): string => {
  if (!text.includes(ACTIVE_MEMORY_OPEN_TAG)) {
    return text;
  }
  const spans: Array<{ start: number; next: number }> = [];
  let header = findTextLine(text, ACTIVE_MEMORY_CONTEXT_HEADER);
  while (header) {
    const open = readTextLine(text, header.next);
    const close = open?.trimmed === ACTIVE_MEMORY_OPEN_TAG
      ? findTextLine(text, ACTIVE_MEMORY_CLOSE_TAG, open.next)
      : undefined;
    const next = close ? skipEmptyLines(text, close.next) : header.next;
    if (close) {
      spans.push({ start: header.start, next });
    }
    header = findTextLine(text, ACTIVE_MEMORY_CONTEXT_HEADER, next);
  }
  return removeLineSpans(text, spans);
};

const stripTrailingContextBlockSuffix = (text: string): string => {
  const header = findTextLine(text, CHANNEL_CONTEXT_HEADER);
  if (!header) {
    return text;
  }
  let end = header.start;
  while (end > 0) {
    const previous = end === 1 ? 0 : text.lastIndexOf('\n', end - 2) + 1;
    if (text.slice(previous, end - 1).trim() !== '') {
      break;
    }
    end = previous;
  }
  return text.slice(0, Math.max(0, end - 1));
};

const METADATA_TOKENS_RE_SOURCE = [INBOUND_CONTEXT_MARKER, ...MESSAGE_TOOL_DELIVERY_HINTS]
  .map(escapeRegExp)
  .join('|');

/**
 * Removes injected inbound metadata blocks from a stored user message, leaving
 * the real user text. Mirrors OpenClaw's `stripInboundMetadata`: a leading
 * `[Sat 2026-08-02 04:04 UTC] ` timestamp is dropped first, then every
 * `Sender: ⟦openclaw:ctx⟧` header block (and its ```json payload), message-tool
 * delivery hint line and active-memory block is removed. A leading ACP
 * `[Working directory: <cwd>]` line is dropped ahead of both — the bridge adds
 * it to prompts it did not receive `--no-prefix-cwd` for.
 */
export function stripOpenclawInboundMetadata(text: string): string {
  const withoutCwdPrefix = text.replace(LEADING_ACP_WORKING_DIRECTORY_RE, '');
  const withoutTimestamp = withoutCwdPrefix.replace(LEADING_TIMESTAMP_PREFIX_RE, '');
  if (!hasInboundMetadataSentinel(withoutTimestamp)) {
    return withoutTimestamp;
  }
  const source = stripActiveMemoryPromptPrefixBlocks(withoutTimestamp);
  const spans: Array<{ start: number; next: number }> = [];
  const tokens = new RegExp(METADATA_TOKENS_RE_SOURCE, 'g');
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source))) {
    const start = source.lastIndexOf('\n', match.index - 1) + 1;
    const line = readTextLine(source, start);
    if (!line) {
      break;
    }
    tokens.lastIndex = line.next;
    if (line.trimmed === CHANNEL_CONTEXT_HEADER) {
      spans.push({ start, next: source.length + 1 });
      break;
    }
    if (isInboundContextHeaderLine(line.trimmed)) {
      tokens.lastIndex = metadataBlockEnd(source, line);
      spans.push({ start, next: tokens.lastIndex });
    } else if (isMessageToolDeliveryHintLine(line.trimmed)) {
      spans.push({ start, next: line.next });
    }
  }
  return removeLineSpans(source, spans)
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
    .replace(LEADING_TIMESTAMP_PREFIX_RE, '');
}

/**
 * Leading prompts OpenClaw synthesizes as `role: 'user'` but which are not user
 * input: the session-startup/bootstrap prompt (written on `/new` or `/reset`)
 * and cron trigger lines (`[cron:<jobId> <jobName>] …`). Neither carries the
 * context marker, so {@link stripOpenclawInboundMetadata} leaves them intact
 * and they must be recognised by their stable prefix.
 */
const OPENCLAW_SYNTHETIC_USER_PREFIXES = [
  'A new session was started via /new or /reset',
  '[cron:',
] as const;

/** True when a stripped user message is an OpenClaw-synthesized prompt. */
export function isOpenclawSyntheticUserPrompt(text: string): boolean {
  const trimmed = text.trimStart();
  return OPENCLAW_SYNTHETIC_USER_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * Strips metadata from a raw user text and returns the user-visible content, or
 * `null` when nothing user-authored remains (pure injection / synthetic prompt).
 */
export function readOpenclawUserText(rawText: string): string | null {
  const stripped = stripOpenclawInboundMetadata(rawText).trim();
  if (!stripped || isOpenclawSyntheticUserPrompt(stripped)) {
    return null;
  }
  return stripped;
}

//----------------- AGENT STORE ACCESS ------------
/**
 * Opens one agent's SQLite transcript store read-only, or returns null when the
 * store does not exist. The CLI writes through WAL while a run is in flight, so
 * a short busy timeout keeps a concurrent read from failing with SQLITE_BUSY.
 */
export function openOpenclawAgentDatabase(agentId: string): Database.Database | null {
  const dbPath = getOpenclawAgentDbPath(agentId);
  if (!fsSync.existsSync(dbPath)) {
    return null;
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 2000');
  return db;
}

export type OpenclawTranscriptEventRow = { event_json: string | null; event_zstd: Buffer | null };

/**
 * Decodes one `transcript_events` row into its Pi-format entry.
 *
 * The two payload columns are mutually exclusive (a CHECK constraint): plain
 * rows carry `event_json`, large rows carry a zstd-compressed `event_zstd`.
 * A truncated or corrupt compressed frame is skipped rather than failing the
 * whole transcript.
 */
export function decodeOpenclawTranscriptEvent(row: OpenclawTranscriptEventRow): AnyRecord | null {
  try {
    if (typeof row.event_json === 'string' && row.event_json.length > 0) {
      return readObjectRecord(JSON.parse(row.event_json));
    }
    if (row.event_zstd) {
      const json = zlib.zstdDecompressSync(row.event_zstd).toString('utf8');
      return readObjectRecord(JSON.parse(json));
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolves which agent owns a session and its *current* window id.
 *
 * CloudCLI stores `provider_session_id` as OpenClaw's `session_key`
 * (`agent:<agentId>:<key>`), which is stable across reset/rollover while the
 * window id changes — so the key must be mapped back to the live
 * `session_nodes.current_session_id` before reading. A bare window id (no
 * `agent:` prefix) is accepted too, resolved by scanning each agent store.
 */
function resolveOpenclawSessionLocation(
  providerSessionId: string,
): { agentId: string; sessionId: string } | null {
  const agentId = getOpenclawAgentIdFromSessionKey(providerSessionId);
  if (agentId) {
    const db = openOpenclawAgentDatabase(agentId);
    if (!db) {
      return null;
    }
    try {
      const row = db
        .prepare('SELECT current_session_id AS sid FROM session_nodes WHERE session_key = ?')
        .get(providerSessionId) as { sid: string | null } | undefined;
      const sid = readOptionalString(row?.sid);
      return sid ? { agentId, sessionId: sid } : null;
    } finally {
      db.close();
    }
  }

  for (const candidateAgentId of getOpenclawAgentIds()) {
    const db = openOpenclawAgentDatabase(candidateAgentId);
    if (!db) {
      continue;
    }
    try {
      const row = db
        .prepare('SELECT session_id AS sid FROM session_windows WHERE session_id = ?')
        .get(providerSessionId) as { sid: string | null } | undefined;
      if (readOptionalString(row?.sid)) {
        return { agentId: candidateAgentId, sessionId: providerSessionId };
      }
    } finally {
      db.close();
    }
  }
  return null;
}

//----------------- ENTRY NORMALIZATION (Pi lineage) ------------
type OpenclawContentBlock = {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  data?: unknown;
  mimeType?: unknown;
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
};

type OpenclawAgentMessage = {
  role?: unknown;
  content?: unknown;
  /** The model recorded on an assistant message, shown in the reply footer. */
  model?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  isError?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
  usage?: unknown;
};

const readNonEmptyString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const dataUrlFromOpenclawImage = (block: OpenclawContentBlock): string => {
  const mime = typeof block.mimeType === 'string' && block.mimeType ? block.mimeType : 'image/png';
  return `data:${mime};base64,${block.data}`;
};

/** Discriminates rows produced by one entry so ids never collide. */
const blockId = (baseId: string | undefined, emitted: number): string | undefined => {
  if (!baseId) {
    return undefined;
  }
  return emitted > 0 ? `${baseId}-${emitted}` : baseId;
};

/** Reads the entry-level ISO timestamp so repeated reads stay stable. */
const readEntryTimestamp = (entry: AnyRecord): string | undefined => {
  if (typeof entry.timestamp === 'string' && entry.timestamp.trim()) {
    return entry.timestamp;
  }
  if (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)) {
    return new Date(entry.timestamp).toISOString();
  }
  return undefined;
};

/**
 * Normalizes one OpenClaw transcript entry (a Pi-format AgentMessage) into app
 * messages, oldest-first.
 *
 * Message content blocks map one-to-one (thinking/text/tool call), image blocks
 * become inline data URLs, and a `toolResult` message stays visible as a
 * separate `tool_result` row keyed by `toolCallId` — exactly the shape Pi's
 * reader produces, because OpenClaw's row format is Pi's. User rows are run
 * through {@link readOpenclawUserText} so injected context never surfaces, and a
 * row that is *only* injected context produces nothing.
 */
export function normalizeOpenclawAgentMessage(
  message: OpenclawAgentMessage,
  entryId: string | undefined,
  sessionId: string | null,
  timestamp?: string,
): NormalizedMessage[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const baseId = entryId ? `openclaw-${entryId}` : undefined;
  const role = message.role;
  const content = message.content;
  const blocks: OpenclawContentBlock[] = Array.isArray(content) ? content : [];

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
        images.push({ data: dataUrlFromOpenclawImage(block) });
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
      provider: PROVIDER,
      timestamp,
    }));
    return messages;
  }

  if (role === 'user') {
    if (typeof content === 'string') {
      const text = readOpenclawUserText(content);
      if (text) {
        messages.push(createNormalizedMessage({
          kind: 'text',
          role: 'user',
          content: text,
          id: baseId,
          sessionId,
          provider: PROVIDER,
          timestamp,
        }));
      }
    } else {
      const textParts: string[] = [];
      const images: Array<{ data: string; name?: string }> = [];
      for (const block of blocks) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          const text = readOpenclawUserText(block.text);
          if (text) {
            textParts.push(text);
          }
        } else if (block?.type === 'image' && typeof block.data === 'string') {
          images.push({ data: dataUrlFromOpenclawImage(block) });
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
          provider: PROVIDER,
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
        id: blockId(baseId, messages.length),
        sessionId,
        provider: PROVIDER,
        timestamp,
      }));
    } else if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      messages.push(createNormalizedMessage({
        kind: 'text',
        role: 'assistant',
        content: block.text,
        // OpenClaw records the answering model on the assistant message itself,
        // so the reply footer names it without consulting `model_change`.
        model: readNonEmptyString(message.model),
        id: blockId(baseId, messages.length),
        sessionId,
        provider: PROVIDER,
        timestamp,
      }));
    } else if (block?.type === 'toolCall' && readNonEmptyString(block.name)) {
      messages.push(createNormalizedMessage({
        kind: 'tool_use',
        role: 'assistant',
        toolName: readNonEmptyString(block.name) ?? '',
        toolInput: block.arguments,
        toolId: readNonEmptyString(block.id) ?? undefined,
        id: blockId(baseId, messages.length),
        sessionId,
        provider: PROVIDER,
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
      provider: PROVIDER,
      timestamp,
    }));
  }

  if (isErrorTurn && errorText) {
    messages.push(createNormalizedMessage({
      kind: 'error',
      role: 'assistant',
      content: errorText,
      id: baseId ? `${baseId}-error` : undefined,
      sessionId,
      provider: PROVIDER,
      timestamp,
    }));
  }

  return messages;
}

/** Summarizes the newest assistant usage on the active path for the token counter. */
function summarizeOpenclawTokenUsage(activeEntries: AnyRecord[]): unknown {
  for (let index = activeEntries.length - 1; index >= 0; index -= 1) {
    const entry = activeEntries[index];
    if (entry?.type !== 'message') {
      continue;
    }
    const message = readObjectRecord(entry.message);
    if (message?.role !== 'assistant') {
      continue;
    }
    const usage = readObjectRecord(message.usage);
    if (!usage) {
      continue;
    }
    const readNumber = (value: unknown): number =>
      (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    const input = readNumber(usage.input);
    const output = readNumber(usage.output);
    const cacheRead = readNumber(usage.cacheRead);
    const cacheWrite = readNumber(usage.cacheWrite);
    const totalTokens = readNumber(usage.totalTokens);
    // Interrupt/error turns persist an all-zero usage block rather than none at
    // all; skip them so a counter a live turn just set is not zeroed. Mirrors
    // `readOpenclawTokenUsage`, which reads the same store for the token-usage
    // endpoint — without this the two readers disagree on the newest turn.
    if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) {
      continue;
    }
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
 * Renders an ACP `tool_call_update` payload to the text a tool-result row shows.
 *
 * OpenClaw sends the outcome as `content` blocks and/or a `rawOutput` value;
 * prefer rendered text, then a string output, then a compact JSON dump.
 */
function renderToolCallOutput(content: unknown, output: unknown): string {
  if (Array.isArray(content)) {
    const parts = content
      .map((block) => readOptionalString(readObjectRecord(block)?.text))
      .filter((text): text is string => Boolean(text));
    if (parts.length > 0) {
      return parts.join('\n');
    }
  }
  const direct = readOptionalString(content);
  if (direct) {
    return direct;
  }
  const outputText = readOptionalString(output);
  if (outputText) {
    return outputText;
  }
  if (output !== undefined && output !== null) {
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }
  return '';
}

/**
 * Provider registry sessions adapter for OpenClaw.
 *
 * `fetchHistory` reads the active conversation branch out of OpenClaw's
 * per-agent SQLite transcript store: `session_transcript_active_events` gives
 * the current (leaf-selected) path, so no `parentId` tree walk is needed, and
 * each event is decoded from `event_json` or a zstd `event_zstd` frame before
 * being normalized with Pi's entry rules. Injected `role: 'user'` context is
 * stripped.
 *
 * `normalizeMessage` translates the ACP live-stream payloads the runtime emits.
 * The runtime has already accumulated chunk text per segment, so `content` is
 * the row's full text so far and `messageId` is the stable upsert id. OpenClaw
 * chunk frames carry no `messageId`, so the runtime mints `openclaw-<run>-…`
 * ids; tool rows key off the ACP `toolCallId`.
 */
export class OpenclawSessionsProvider implements IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    const event = readObjectRecord(raw);
    if (!event) {
      return [];
    }
    const type = readOptionalString(event.type);

    if (type === 'agent_message_chunk' || type === 'agent_thought_chunk') {
      const content = readOptionalString(event.content);
      if (!content) {
        return [];
      }
      const messageId = readOptionalString(event.messageId);
      return [createNormalizedMessage({
        kind: type === 'agent_message_chunk' ? 'text' : 'thinking',
        role: 'assistant',
        content,
        sessionId,
        provider: PROVIDER,
        ...(messageId ? { id: messageId } : {}),
      })];
    }

    if (type === 'tool_call') {
      const toolCallId = readOptionalString(event.toolCallId);
      return [createNormalizedMessage({
        kind: 'tool_use',
        role: 'assistant',
        toolName: readOptionalString(event.toolName) ?? 'tool',
        toolInput: event.input,
        toolId: toolCallId,
        id: toolCallId ? `openclaw-tool-${toolCallId}` : undefined,
        sessionId,
        provider: PROVIDER,
      })];
    }

    if (type === 'tool_call_update') {
      const toolCallId = readOptionalString(event.toolCallId);
      return [createNormalizedMessage({
        kind: 'tool_result',
        role: 'user',
        content: renderToolCallOutput(event.content, event.output),
        isError: event.isError === true,
        toolId: toolCallId,
        id: toolCallId ? `openclaw-tool-result-${toolCallId}` : undefined,
        sessionId,
        provider: PROVIDER,
      })];
    }

    return [];
  }

  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const providerSessionId = options.providerSessionId ?? sessionId;
    // Resolution and opening the store live inside the try as well: a store
    // whose tables are missing, is locked, or is corrupt must report an empty
    // history like every other failure here, not surface as a route 500.
    let db: Database.Database | null = null;

    try {
      const location = resolveOpenclawSessionLocation(providerSessionId);
      if (!location) {
        return EMPTY_HISTORY;
      }

      db = openOpenclawAgentDatabase(location.agentId);
      if (!db) {
        return EMPTY_HISTORY;
      }

      const activeEntries = this.readActiveEntries(db, location.sessionId);
      const messages = this.normalizeActiveEntries(activeEntries, sessionId);
      const tokenUsage = summarizeOpenclawTokenUsage(activeEntries);

      const normalizedOffset = Math.max(0, offset);
      const normalizedLimit = limit === null ? null : Math.max(0, limit);
      const total = messages.length;
      const { page, hasMore } = sliceTailPage(messages, normalizedLimit, normalizedOffset);

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
      console.warn(`[OpenclawProvider] Failed to load session ${sessionId}:`, message);
      return EMPTY_HISTORY;
    } finally {
      db?.close();
    }
  }

  /** Reads the session's active branch, oldest-first, decoded to entries. */
  private readActiveEntries(db: Database.Database, sessionId: string): AnyRecord[] {
    const rows = db.prepare(`
      SELECT t.event_json AS event_json, t.event_zstd AS event_zstd
      FROM session_transcript_active_events a
      INNER JOIN transcript_events t
        ON t.session_id = a.session_id AND t.seq = a.event_seq
      WHERE a.session_id = ?
      ORDER BY a.active_position
    `).all(sessionId) as OpenclawTranscriptEventRow[];

    const entries: AnyRecord[] = [];
    for (const row of rows) {
      const entry = decodeOpenclawTranscriptEvent(row);
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  }

  private normalizeActiveEntries(entries: AnyRecord[], sessionId: string): NormalizedMessage[] {
    const normalized: NormalizedMessage[] = [];
    for (const entry of entries) {
      // Only `message` entries carry renderable content; `model_change`,
      // `thinking_level_change`, `custom`, `custom_message` and `leaf` carry
      // none.
      if (entry.type !== 'message') {
        continue;
      }
      const message = readObjectRecord(entry.message);
      if (!message) {
        continue;
      }
      const entryId = typeof entry.id === 'string' ? entry.id : undefined;
      for (const emitted of normalizeOpenclawAgentMessage(
        message as OpenclawAgentMessage,
        entryId,
        sessionId,
        readEntryTimestamp(entry),
      )) {
        normalized.push(emitted);
      }
    }
    return normalized;
  }
}
