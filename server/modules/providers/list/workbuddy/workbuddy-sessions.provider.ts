import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import { createNormalizedMessage, sliceTailPage } from '@/shared/utils.js';

/**
 * Both engine roots persist transcripts as `projects/<encoded-cwd>/<id>.jsonl`.
 * Resolved lazily so `os.homedir()` is read at call time, not import time.
 * `WORKBUDDY_PROJECTS_ROOT` overrides the roots entirely (mirrors
 * `DSH_SESSIONS_ROOT`) for tests and non-standard engine data locations.
 */
function getWorkbuddySessionRoots(): string[] {
  const override = process.env.WORKBUDDY_PROJECTS_ROOT?.trim();
  if (override) {
    return [override];
  }
  return [
    path.join(os.homedir(), '.codebuddy', 'projects'),
    path.join(os.homedir(), '.workbuddy', 'projects'),
  ];
}

/** Mirrors the engine's directory encoding: strip the leading slash, `/` → `-`. */
function encodeCwd(cwd: string): string {
  return cwd.replace(/^\//, '').replace(/\//g, '-');
}

/** Resolves the transcript path for one engine session id across both roots. */
function resolveTranscriptPath(engineSessionId: string, cwd: string): string | null {
  const encodedCwd = encodeCwd(cwd);
  for (const root of getWorkbuddySessionRoots()) {
    const candidate = path.join(root, encodedCwd, `${engineSessionId}.jsonl`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Reads the first `text` field of one content block type in a message. */
function extractBlockText(blocks: unknown[], type: string): string | undefined {
  for (const block of blocks) {
    const record = block as AnyRecord | null;
    if (record?.type === type && typeof record.text === 'string' && record.text.trim()) {
      return record.text;
    }
  }
  return undefined;
}

/**
 * Recovers the actual user prompt from a WorkBuddy user-turn transcript.
 *
 * The engine wraps every user turn's real input in a `<user_query>…</user_query>`
 * tag that sits after a `<system-reminder data-role="user-context">` block
 * (injected current time, memory/skill reminders, …). Without this, history
 * shows that injected context instead of what the user typed. Older transcripts
 * that stored plain text are returned unchanged.
 */
function extractUserPrompt(inputText: string): string {
  const match = inputText.match(/<user_query>([\s\S]*?)<\/user_query>/);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }
  return inputText.trim();
}

const EMPTY_HISTORY: FetchHistoryResult = {
  messages: [],
  total: 0,
  hasMore: false,
  offset: 0,
  limit: null,
};

/**
 * Provider registry session adapter for WorkBuddy.
 *
 * `normalizeMessage` translates the stream-json `assistant` events emitted by
 * the WorkBuddy runtime into app messages: thinking blocks become `thinking`
 * messages, text blocks become assistant `text` messages.
 */
export class WorkbuddySessionsProvider implements IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    const event = raw as AnyRecord | null;
    if (event?.type !== 'assistant') {
      return [];
    }

    const message = event.message as AnyRecord | null;
    const blocks = Array.isArray(message?.content) ? message.content : [];
    const messages: NormalizedMessage[] = [];

    for (const block of blocks) {
      const record = block as AnyRecord | null;
      if (!record) {
        continue;
      }
      if (record.type === 'thinking' && typeof record.thinking === 'string' && record.thinking.trim()) {
        messages.push(createNormalizedMessage({
          kind: 'thinking',
          role: 'assistant',
          content: record.thinking,
          sessionId,
          provider: 'workbuddy',
        }));
      } else if (record.type === 'text' && typeof record.text === 'string' && record.text.trim()) {
        messages.push(createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content: record.text,
          sessionId,
          provider: 'workbuddy',
        }));
      }
    }

    return messages;
  }

  async fetchHistory(sessionId: string, options: FetchHistoryOptions = {}): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const row = sessionsDb.getSessionById(sessionId);
    const engineSessionId = row?.provider_session_id?.trim();
    if (!row?.project_path || !engineSessionId) {
      return EMPTY_HISTORY;
    }

    const filePath = resolveTranscriptPath(engineSessionId, row.project_path);
    if (!filePath) {
      return EMPTY_HISTORY;
    }

    const allMessages = await this.readTranscript(filePath, sessionId);
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
   * Decodes a persisted engine transcript into app messages, oldest first.
   *
   * Only `message` events carry content: user turns use `input_text` blocks,
   * assistant turns use `output_text` (text) and `reasoning_text` (thinking)
   * blocks. Every other event type (`ai-title`, `file-history-snapshot`,
   * `reasoning`, …) is skipped.
   */
  private async readTranscript(filePath: string, appSessionId: string): Promise<NormalizedMessage[]> {
    const messages: NormalizedMessage[] = [];

    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      return messages;
    }

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let event: AnyRecord;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type !== 'message') {
        continue;
      }

      const timestamp = typeof event.timestamp === 'number'
        ? new Date(event.timestamp).toISOString()
        : undefined;
      const timestampField = timestamp ? { timestamp } : {};
      const blocks = Array.isArray(event.content) ? event.content : [];

      if (event.role === 'user') {
        const text = extractBlockText(blocks, 'input_text');
        if (text) {
          messages.push(createNormalizedMessage({
            kind: 'text',
            role: 'user',
            content: extractUserPrompt(text),
            sessionId: appSessionId,
            provider: 'workbuddy',
            ...timestampField,
          }));
        }
      } else if (event.role === 'assistant') {
        // Emit blocks in transcript order so reasoning reads as thinking before
        // the final answer, matching how the live stream normalizes them.
        for (const block of blocks) {
          const record = block as AnyRecord | null;
          if (!record) {
            continue;
          }
          if (record.type === 'reasoning_text' && typeof record.text === 'string' && record.text.trim()) {
            messages.push(createNormalizedMessage({
              kind: 'thinking',
              role: 'assistant',
              content: record.text,
              sessionId: appSessionId,
              provider: 'workbuddy',
              ...timestampField,
            }));
          } else if (record.type === 'output_text' && typeof record.text === 'string' && record.text.trim()) {
            messages.push(createNormalizedMessage({
              kind: 'text',
              role: 'assistant',
              content: record.text,
              sessionId: appSessionId,
              provider: 'workbuddy',
              ...timestampField,
            }));
          }
        }
      }
    }

    return messages;
  }
}
