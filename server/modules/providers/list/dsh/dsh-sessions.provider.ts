import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import { createNormalizedMessage, sliceTailPage } from '@/shared/utils.js';

import { getDshSessionsRoot } from './dsh-models.provider.js';

// ---------- DSH JSONL session-log decoding ----------
//
// The DSH ACP server persists one session as `<sessions-root>/--<project-key>--/
// <session-id>/session.jsonl.zstd`: a concatenation of independent Zstandard frames (one header
// frame plus one frame per append batch). Directory naming mirrors
// `@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts`.

const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
export const SESSION_LOG_FILE = 'session.jsonl.zstd';

/** Escapes one raw session id into a single safe path segment (`~XXXX` for unsafe code units). */
export function encodeSessionSegment(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch;
    } else {
      out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  return out;
}

/**
 * Builds the readable project directory key for a session cwd: separators
 * become `-`, unsafe code units use `~XXXX`, and the result is wrapped in
 * `--…--` (mirrors `projectKey` in the DSH JSONL persistence package).
 */
export function projectKey(cwd: string): string {
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) {
        readable += '-';
      }
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
      separatorRun = false;
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root';
  return `--${slug.slice(0, 251)}--`;
}

/** Decodes a concatenated-zstd session log into its logical JSONL lines. */
export function decodeZstdFrames(buffer: Buffer): string {
  let text = '';
  let index = buffer.indexOf(ZSTD_FRAME_MAGIC);
  while (index !== -1) {
    const next = buffer.indexOf(ZSTD_FRAME_MAGIC, index + ZSTD_FRAME_MAGIC.length);
    const frame = buffer.subarray(index, next === -1 ? buffer.length : next);
    try {
      text += zlib.zstdDecompressSync(frame).toString('utf8');
    } catch {
      // A corrupt frame ends the readable prefix; keep the frames decoded so far.
    }
    index = next;
  }
  return text;
}

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

/** Resolves the session-log path for one ACP session id under a project cwd. */
function resolveSessionLogPath(acpSessionId: string, cwd: string): string | null {
  const candidate = path.join(
    getDshSessionsRoot(),
    projectKey(cwd),
    encodeSessionSegment(acpSessionId),
    SESSION_LOG_FILE,
  );
  return existsSync(candidate) ? candidate : null;
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

  const candidate = path.join(projectDir, entries[0], SESSION_LOG_FILE);
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/** Converts one decoded session log into app messages, oldest first (chronological). */
function decodeSessionLog(text: string, appSessionId: string): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];
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
    const timestamp = typeof event.time === 'number'
      ? new Date(event.time).toISOString()
      : undefined;

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
        messages.push(createNormalizedMessage({
          kind: 'text',
          role: 'user',
          content,
          sessionId: appSessionId,
          provider: 'dsh',
          ...(timestamp ? { timestamp } : {}),
        }));
      }
    } else if (event.type === 'assistant/message') {
      const content = extractText((data.message as AnyRecord | null)?.content);
      if (content) {
        messages.push(createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content,
          sessionId: appSessionId,
          provider: 'dsh',
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
 * runtime (currently `agent_message_chunk`) into app messages.
 * `fetchHistory` decodes the harness's JSONL session log (located through the
 * app session row's `provider_session_id` and project path).
 */
export class DshSessionsProvider implements IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    const record = raw as { type?: unknown; content?: unknown } | null;
    if (record?.type === 'agent_message_chunk' && typeof record.content === 'string' && record.content) {
      return [createNormalizedMessage({
        kind: 'text',
        role: 'assistant',
        content: record.content,
        sessionId,
        provider: 'dsh',
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

    const allMessages = decodeSessionLog(decodeZstdFrames(buffer), sessionId);
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
}
