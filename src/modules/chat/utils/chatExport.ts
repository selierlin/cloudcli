/**
 * Turns a loaded transcript into a downloadable file.
 *
 * The HTML path renders the app's real transcript components, so an exported
 * conversation looks like the one on screen — tool cards, diffs, highlighted
 * code, subagent timelines and all. Markdown and JSON are the plain-text and
 * machine-readable views of the same messages.
 */

import type { ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';
import { api, readApiJson } from '@/shared/api';
import { buildTranscriptHtml } from '@/modules/chat/export/buildTranscriptHtml';
import { buildTranscriptMarkdown } from '@/modules/chat/export/buildTranscriptMarkdown';

export type TranscriptExportFormat = 'html' | 'markdown' | 'json';

/** The formats a turn-selection export offers; JSON stays a whole-session view. */
export type PartialExportFormat = Extract<TranscriptExportFormat, 'html' | 'markdown'>;

/** A live `/s/...` link returned after publishing a transcript snapshot. */
export type SharedTranscriptLink = {
  shareId: string;
  /** Absolute, origin included, so it can be pasted into any chat client. */
  url: string;
  /** ISO timestamp; the link stops working at this moment. */
  expiresAt: string;
};

export type TranscriptExportInput = {
  messages: ChatMessage[];
  sessionTitle: string;
  provider: LLMProvider | string;
  selectedProject?: Project | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  /** The whole conversation, when `messages` is only the rows the user picked. */
  totalMessages?: ChatMessage[];
  /**
   * True when `messages` is a picked subset even if `totalMessages` is absent.
   *
   * A paginated session only has its loaded window in memory, so callers omit
   * `totalMessages` rather than pass a count that understates the conversation;
   * this flag keeps the document saying that it is an excerpt.
   */
  isExcerpt?: boolean;
  /**
   * Whether the document may carry its own scripts. A published snapshot sets
   * this to `false`: `/s/:token` runs under a CSP that forbids scripts, so a
   * theme toggle or a copy button would render and then do nothing.
   */
  interactive?: boolean;
};

const EXTENSIONS: Record<TranscriptExportFormat, string> = {
  html: 'html',
  markdown: 'md',
  json: 'json',
};

const MIME_TYPES: Record<TranscriptExportFormat, string> = {
  html: 'text/html;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

/**
 * Makes a session title safe to use as a filename.
 *
 * Session titles are the user's first message, so they routinely contain
 * slashes and quotes; unsanitized they produced downloads named after only the
 * last path segment, or nothing at all.
 *
 * `prefix` names the artifact — the caller localizes it, so a zh-CN export
 * reads `对话-重构导出.html` and an English one `conversation-Refactor-export`.
 * The export date only appears when the title itself cannot name the file,
 * including the caller's own "untitled" placeholder, which would otherwise
 * produce `对话-对话`.
 */
export function toExportFileStem(
  sessionTitle: string,
  exportedAt: Date,
  prefix = 'conversation',
): string {
  const date = exportedAt.toISOString().slice(0, 10);
  const slug = sessionTitle
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();

  return slug && slug !== prefix.toLowerCase() ? `${prefix}-${slug}` : `${prefix}-${date}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Builds the file's text without downloading it, so it can be asserted on. */
export async function buildTranscriptExport(
  format: TranscriptExportFormat,
  input: TranscriptExportInput,
  exportedAt: Date,
): Promise<string> {
  if (format === 'json') {
    return `${JSON.stringify(
      {
        title: input.sessionTitle,
        provider: input.provider,
        exportedAt: exportedAt.toISOString(),
        messageCount: input.messages.length,
        messages: input.messages,
      },
      null,
      2,
    )}\n`;
  }

  if (format === 'markdown') {
    return buildTranscriptMarkdown({
      messages: input.messages,
      sessionTitle: input.sessionTitle,
      provider: input.provider,
      exportedAt,
      createDiff: input.createDiff,
      totalMessages: input.totalMessages,
      isExcerpt: input.isExcerpt,
    });
  }

  return buildTranscriptHtml({
    messages: input.messages,
    createDiff: input.createDiff,
    provider: input.provider,
    selectedProject: input.selectedProject,
    sessionTitle: input.sessionTitle,
    exportedAt,
    totalMessages: input.totalMessages,
    isExcerpt: input.isExcerpt,
    interactive: input.interactive,
  });
}

export async function downloadTranscriptExport(
  format: TranscriptExportFormat,
  input: TranscriptExportInput,
  fileNamePrefix?: string,
): Promise<void> {
  const exportedAt = new Date();
  const content = await buildTranscriptExport(format, input, exportedAt);
  const filename = `${toExportFileStem(input.sessionTitle, exportedAt, fileNamePrefix)}.${EXTENSIONS[format]}`;

  downloadBlob(new Blob([content], { type: MIME_TYPES[format] }), filename);
}

/**
 * Uploads an already-built HTML snapshot and returns its public link.
 *
 * The server stores the document verbatim, which is what makes a link and a
 * downloaded file identical and lets it keep working after the conversation
 * changes. The dialog builds first so the reader sees the size and confirms
 * before anything becomes publicly reachable.
 */
export async function publishTranscriptHtml(
  html: string,
  meta: { title: string; sessionId?: string | null; messageCount: number },
): Promise<SharedTranscriptLink> {
  const response = await api.shares.create({
    html,
    title: meta.title,
    sessionId: meta.sessionId ?? null,
    messageCount: meta.messageCount,
  });
  const payload = await readApiJson<{
    share: { shareId: string; urlPath: string; expiresAt: string };
  }>(response);

  return {
    shareId: payload.share.shareId,
    url: `${window.location.origin}${payload.share.urlPath}`,
    expiresAt: payload.share.expiresAt,
  };
}
