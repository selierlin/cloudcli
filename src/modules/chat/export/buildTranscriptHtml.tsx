import { createElement } from 'react';

import { i18n } from '@/modules/i18n';
import { api } from '@/shared/api';
import type { ChatImage, ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';
import { TranscriptExportDocument } from '@/modules/chat/export/TranscriptExportDocument';
import { countVisibleTranscriptMessages } from '@/modules/chat/utils/executionProcess';
import { getChatProviderLabel } from '@/modules/chat/utils/chatProviderLabel';
import {
  buildTranscriptMessageKeys,
  getTranscriptMessageKey,
} from '@/modules/chat/utils/messageKeys';

type BuildTranscriptHtmlInput = {
  messages: ChatMessage[];
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  provider: LLMProvider | string;
  selectedProject?: Project | null;
  sessionTitle: string;
  exportedAt: Date;
  /** The whole conversation when `messages` is only the picked rows. */
  totalMessages?: ChatMessage[];
};

/**
 * Collects the stylesheets the running app is already using.
 *
 * Reading `document.styleSheets` rather than fetching a build artifact is what
 * makes this work identically in dev (Vite injects `<style>` tags) and in a
 * production build (a single emitted `<link>`), and it means the exported file
 * is styled by definition with the same rules the user was looking at —
 * including every CSS variable the theme is built from.
 */
function collectDocumentStyles(): string {
  const blocks: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      blocks.push(Array.from(rules).map((rule) => rule.cssText).join('\n'));
    } catch {
      // A cross-origin sheet cannot be read. None of the app's own styles are
      // served that way, so skipping it costs nothing.
    }
  }

  return blocks.join('\n');
}

/** Matches a stylesheet `url()` and captures the raw, possibly quoted target. */
const CSS_URL_REFERENCE = /url\(\s*([^)]*?)\s*\)/g;

/**
 * A file on disk can reach these on its own; everything else needs inlining.
 *
 * A fragment (`url(#gradient)`) points at an element in the same document.
 * It needs no fetch — and asking for one would download the page itself.
 */
const SELF_REACHABLE_URL = /^(data:|https?:|blob:|#)/i;

/** Used when the response does not label itself and the extension is unknown. */
const FALLBACK_MIME_TYPE = 'application/octet-stream';

const MIME_BY_EXTENSION: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** Matches one `@font-face` block; every bundled face is a single rule. */
const FONT_FACE_RULE = /@font-face\s*\{[^}]*\}/g;

function fontFamilyOf(rule: string): string {
  const match = rule.match(/font-family\s*:\s*([^;}]+)/i);
  return match ? stripQuotes(match[1].trim()) : '';
}

/**
 * Shrinks the font payload before anything is fetched.
 *
 * Each face ships the same glyphs three times (woff2, woff, ttf) for browsers
 * that have supported woff2 for a decade. Embedding all three costs well over
 * a megabyte per export, and base64 adds a third on top — so one `url()` per
 * face is kept, woff2 when it is offered, and the rest never leave the app.
 *
 * KaTeX declares twenty faces of math glyphs. They are only reachable from
 * `.katex` markup, so a transcript without a formula drops them entirely;
 * `hasMath` comes from the body that was just rendered, not from a guess.
 */
function pruneFontFaces(css: string, hasMath: boolean): string {
  return css.replace(FONT_FACE_RULE, (rule) => {
    if (!hasMath && fontFamilyOf(rule).startsWith('KaTeX_')) return '';

    return rule.replace(/(src\s*:\s*)([^;}]+)/i, (whole, prefix: string, value: string) => {
      const parts = value.split(',').map((part) => part.trim());
      const urls = parts.filter((part) => /url\(/i.test(part));
      if (urls.length <= 1) return whole;

      const chosen = urls.find((part) => /woff2/i.test(part)) ?? urls[0];
      // `local()` entries are free — they name an installed font, not bytes.
      const locals = parts.filter((part) => /^local\(/i.test(part));
      return `${prefix}${[...locals, chosen].join(', ')}`;
    });
  });
}

function stripQuotes(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * `String.fromCharCode(...bytes)` throws once the spread exceeds the argument
 * limit, which a font asset reaches easily, so the buffer is walked in chunks.
 */
function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function mimeTypeOf(reference: string, response: Response): string {
  const declared = response.headers.get('content-type')?.split(';')[0].trim();
  if (declared && declared !== FALLBACK_MIME_TYPE) return declared;

  const extension = reference.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? FALLBACK_MIME_TYPE;
}

async function readAsDataUrl(reference: string, href: string): Promise<string | null> {
  try {
    const response = await fetch(href);
    if (!response.ok) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    return `data:${mimeTypeOf(reference, response)};base64,${encodeBase64(bytes)}`;
  } catch {
    // Offline, or the app is served from somewhere the asset is missing.
    return null;
  }
}

/**
 * Reads an already-authorized response into a data URL. The response came from
 * the app's own client, whose auth header a second `fetch(response.url)` would
 * not carry, so the bytes are taken from the body that was just received.
 */
async function responseToDataUrl(response: Response, reference: string): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return `data:${mimeTypeOf(reference, response)};base64,${encodeBase64(bytes)}`;
  } catch {
    return null;
  }
}

/**
 * One attachment image, as bytes the document can carry.
 *
 * Path-based attachments are fetched by the live view in a `useEffect`, which
 * a static render never runs: without this the export painted a pulsing
 * placeholder that could never resolve. The same two routes the chat tries
 * are used here — the global asset store, then the project files route for
 * sessions recorded before attachments moved — and a failure leaves the image
 * data-less, which the component turns into its filename.
 */
async function resolveImageData(image: ChatImage, projectId?: string | null): Promise<string | null> {
  if (image.data) return image.data;
  const imagePath = image.path;
  if (!imagePath) return null;

  const filename = imagePath.split(/[\\/]/).pop() || '';
  const candidates: Array<() => Promise<Response>> = [
    () => api.assets.image(filename),
    ...(projectId ? [() => api.readFileBlob(projectId, imagePath)] : []),
  ];

  for (const request of candidates) {
    try {
      const response = await request();
      if (!response.ok) continue;
      const data = await responseToDataUrl(response, imagePath);
      // A 200 whose body cannot be read is still a miss: fall through to the
      // next route instead of ending the search here.
      if (data) return data;
    } catch {
      // Try the next route; a 403 here is a project the reader cannot read.
    }
  }

  return null;
}

/** Rewrites path-based attachments into data URLs before the static render. */
async function inlineMessageImages(messages: ChatMessage[], projectId?: string | null): Promise<ChatMessage[]> {
  const needsInline = messages.some((message) => message.images?.some((image) => !image.data && image.path));
  if (!needsInline) return messages;

  return Promise.all(messages.map(async (message) => {
    if (!message.images?.length) return message;

    const images = await Promise.all(message.images.map(async (image) => {
      const data = await resolveImageData(image, projectId);
      return data ? { ...image, data } : image;
    }));
    return { ...message, images };
  }));
}

/**
 * Rewrites every stylesheet `url()` that points into the app's own origin into
 * a data URL.
 *
 * An exported file is opened from disk, so a reference like
 * `url('/fonts/encode-sans-latin.woff2')` resolves against `file://` and 404s —
 * the bundled faces silently vanished and the document fell back to system
 * fonts. Fetching them here is what makes "self-contained" true for fonts too,
 * and it keeps working for any asset a later theme adds, without the exporter
 * knowing which ones exist.
 *
 * A reference that cannot be fetched is replaced by `none`, the old behaviour:
 * a dead URL in a static file is worse than no rule at all.
 */
async function inlineStylesheetUrls(css: string): Promise<string> {
  const references = new Set<string>();

  for (const match of css.matchAll(CSS_URL_REFERENCE)) {
    const reference = stripQuotes(match[1]);
    if (reference && !SELF_REACHABLE_URL.test(reference)) references.add(reference);
  }

  const inlined = await Promise.all(
    Array.from(references, async (reference) => {
      const url = new URL(reference, document.baseURI);
      const dataUrl =
        url.origin === window.location.origin ? await readAsDataUrl(reference, url.href) : null;
      return [reference, dataUrl] as const;
    }),
  );

  const replacements = new Map(inlined);

  return css.replace(CSS_URL_REFERENCE, (whole, rawReference: string) => {
    const reference = stripQuotes(rawReference);
    if (!reference || SELF_REACHABLE_URL.test(reference)) return whole;
    const dataUrl = replacements.get(reference);
    // The `url()` wrapper is part of the syntax: replacing the whole token
    // with a bare data URL leaves `src: data:…`, which browsers discard.
    return dataUrl ? `url("${dataUrl}")` : 'none';
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The live `<html>` attributes, copied verbatim.
 *
 * Not everything the document is wearing lives in a stylesheet, so rebuilding
 * the root by hand drops the parts that do not. The overlay selector is an
 * attribute — `[data-theme="<id>"]` rules in `index.css` for a built-in theme,
 * and the same selector in the compiled user-theme `<style>` — the font sizes
 * and families are an inline `style`, and the appearance is both `class` and
 * `color-scheme`. Reading the element instead means a carrier added later is
 * carried too, which is the failure that put this here: the export used to
 * restate `class="dark"` alone, so every picked overlay was collected into the
 * file and then never matched.
 *
 * `lang` is skipped because the template writes its own, and `data-appearance`
 * is the launch splash's first-paint record — React never maintains it, so
 * copying it would pin a stale appearance into a static file.
 */
function snapshotRootAttributes(): string {
  const attributes: string[] = [];

  for (const { name, value } of Array.from(document.documentElement.attributes)) {
    if (name === 'lang' || name === 'data-appearance') continue;
    attributes.push(`${name}="${escapeHtml(value)}"`);
  }

  return attributes.join(' ');
}

/**
 * Renders a transcript into one self-contained HTML file.
 *
 * Self-contained is the whole design: no network, no build step, no viewer —
 * it opens offline in any browser, prints to PDF from there, and carries the
 * app's own light and dark themes with a toggle, because a transcript full of
 * syntax-highlighted code is unreadable in the wrong one.
 */
export async function buildTranscriptHtml(input: BuildTranscriptHtmlInput): Promise<string> {
  // Loaded on demand so react-dom/server stays out of the app's main chunk.
  const { renderToStaticMarkup } = await import('react-dom/server');

  // The live view resolves attachment paths in effects, which never run here.
  // Resolving them first is what turns a pulsing placeholder into the image.
  const messages = await inlineMessageImages(input.messages, input.selectedProject?.projectId);

  const body = renderToStaticMarkup(
    createElement(TranscriptExportDocument, {
      messages,
      createDiff: input.createDiff,
      provider: input.provider,
      selectedProject: input.selectedProject,
    }),
  );

  // KaTeX's twenty faces are dead weight unless the transcript rendered math.
  const hasMath = body.includes('class="katex');
  const styles = await inlineStylesheetUrls(pruneFontFaces(collectDocumentStyles(), hasMath));
  const title = escapeHtml(input.sessionTitle);
  const rootAttributes = snapshotRootAttributes();
  // The separator belongs to the list, so an empty snapshot cannot leave a
  // stray space in the tag.
  const rootAttributeList = rootAttributes ? ` ${rootAttributes}` : '';
  const exportedAt = escapeHtml(input.exportedAt.toLocaleString());
  // The header counts the conversation, not the plumbing: one question that
  // ran twenty tool calls is still one message and one answer.
  const messageKeys = buildTranscriptMessageKeys(messages);
  const messageCount = countVisibleTranscriptMessages(
    messages,
    (message) => messageKeys.get(message) ?? getTranscriptMessageKey(message),
  );
  // The document speaks the language the app is set to: the header, the
  // disclosure labels and `lang` all come from the same catalog, so an export
  // no longer drops the user back into English.
  const t = i18n.getFixedT(null, 'chat');
  const lang = escapeHtml(i18n.language || 'en');
  // A partial export has to say so: the header's own count describes the file,
  // and a reader would otherwise take four picked rows for the whole session.
  const totalVisibleCount = (() => {
    if (!input.totalMessages) return messageCount;
    const keys = buildTranscriptMessageKeys(input.totalMessages);
    return countVisibleTranscriptMessages(
      input.totalMessages,
      (message) => keys.get(message) ?? getTranscriptMessageKey(message),
    );
  })();
  const messageSummary = totalVisibleCount > messageCount
    ? t('export.partialMessages', { count: messageCount, total: totalVisibleCount })
    : t('export.messages', { count: messageCount });
  // Whoever receives the file has none of the app's context around it: name the
  // tool that produced the transcript, the project it belongs to, and the
  // window it covers. Each part is optional, so an export missing one keeps the
  // others instead of printing a separator for nothing.
  const firstTimestamp = input.messages[0]?.timestamp;
  const lastTimestamp = input.messages[input.messages.length - 1]?.timestamp;
  const contextLine = [
    getChatProviderLabel(String(input.provider), t),
    input.selectedProject?.displayName
      ? t('export.projectName', { name: input.selectedProject.displayName })
      : null,
    firstTimestamp && lastTimestamp
      ? `${new Date(firstTimestamp).toLocaleString()} – ${new Date(lastTimestamp).toLocaleString()}`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .map(escapeHtml)
    .join(' · ');

  return `<!DOCTYPE html>
<html lang="${lang}"${rootAttributeList}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${styles}
</style>
<style>
  /* Export-only: the app styles above assume a fixed-height flex shell. */
  html, body { height: auto; overflow: visible; }
  body { background: hsl(var(--background)); color: hsl(var(--foreground)); margin: 0; }
  .chat-export-shell { max-width: 60rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  /* The reader's prose face and size are applied under .chat-messages-pane
     in the app, an ancestor this document does not have. Without restating
     them here every paragraph falls back to the font-serif utility — the
     transcript would ignore Settings → Appearance → Fonts. */
  .chat-export-transcript .chat-message .break-words,
  .chat-export-transcript .chat-message .prose {
    font-family: var(--ui-font-family, ui-serif, Georgia, Cambria, "Times New Roman", Times, serif);
  }
  .chat-export-transcript .chat-message .prose { font-size: var(--ui-font-size, 14px); }
  /* Tool output is capped at 20rem in the chat so a long command cannot swallow
     the conversation. A document has no pane to scroll: the cap would hide
     most of the output behind an inner scrollbar and clip it on paper, so the
     block runs its full length here. Horizontal overflow is left alone -- a
     terminal row must not wrap. */
  .chat-export-transcript pre { max-height: none !important; }
  .chat-export-header {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    border-bottom: 1px solid hsl(var(--border)); padding-bottom: 1rem; margin-bottom: 2rem;
  }
  .chat-export-title { font-size: 1.25rem; font-weight: 600; margin: 0; }
  .chat-export-meta { font-size: 0.75rem; color: hsl(var(--muted-foreground)); margin: 0.25rem 0 0; }
  .chat-export-theme-toggle {
    border: 1px solid hsl(var(--border)); background: transparent; color: inherit;
    border-radius: 0.5rem; padding: 0.375rem 0.75rem; font-size: 0.75rem; cursor: pointer;
  }
  /* Off-screen skipping is a scrolling optimisation; in a printed document it
     leaves blank pages. */
  .chat-message { content-visibility: visible !important; contain-intrinsic-size: auto !important; }
  /* Thinking blocks and Process Runs are native disclosures: no script,
     collapsed by default, and a click opens them. This is also why the export
     can keep a full record without drowning the reader in process output —
     the run's rows are all in the file, just folded. The UA marker is replaced
     by a chevron we can rotate. */
  .chat-export-disclosure { margin: 0.25rem 0; }
  .chat-export-disclosure-summary {
    display: flex; align-items: center; gap: 0.375rem;
    font-size: 0.875rem; color: hsl(var(--muted-foreground));
    cursor: pointer; list-style: none; user-select: none;
  }
  .chat-export-disclosure-summary::-webkit-details-marker { display: none; }
  .chat-export-disclosure-summary:hover { color: hsl(var(--foreground)); }
  .chat-export-disclosure-chevron { display: inline-block; transition: transform 150ms; }
  .chat-export-disclosure[open] > .chat-export-disclosure-summary .chat-export-disclosure-chevron {
    transform: rotate(90deg);
  }
  .chat-export-disclosure-body { margin-top: 0.5rem; }
  /* The chat's process row is 12px medium on a 28px line with a hover fill;
     the shared summary is sized for prose. Match the row the reader knows, so
     the fold reads as the same affordance it is in the app. */
  .chat-export-process > .chat-export-disclosure-summary {
    min-height: 1.75rem; border-radius: 0.375rem;
    padding: 0 0.375rem; margin: 0 -0.375rem;
    font-size: 0.75rem; font-weight: 500;
  }
  .chat-export-process > .chat-export-disclosure-summary:hover {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
  }
  /* Thinking uses the chat's ChevronDown, which points down when closed. */
  .chat-export-thinking-chevron { transition: transform 150ms; flex-shrink: 0; }
  .chat-export-disclosure[open] > .chat-export-disclosure-summary .chat-export-thinking-chevron {
    transform: rotate(180deg);
  }
  /* Tool rows use the same native disclosure so a command, a file section or
     a whole tool batch can be closed again. The header is the summary; only
     the marker is stripped, every layout class carries over from the app. */
  .chat-export-details > .chat-export-details-summary {
    list-style: none; cursor: pointer;
  }
  .chat-export-details > .chat-export-details-summary::-webkit-details-marker { display: none; }
  .chat-export-details > .chat-export-details-summary::marker { content: ''; }
  .chat-export-details > .chat-export-details-summary .chat-export-details-chevron {
    transition: transform 150ms;
  }
  .chat-export-details[open] > .chat-export-details-summary .chat-export-details-chevron {
    transform: rotate(90deg);
  }
  /* A message footer's copy control is the one affordance a document keeps:
     the script below swaps the clipboard icon for a check while it confirms. */
  [data-export-copy] { cursor: pointer; }
  [data-export-copy] .chat-export-copy-check { display: none; }
  [data-export-copy].is-copied .chat-export-copy-icon { display: none; }
  [data-export-copy].is-copied .chat-export-copy-check { display: inline-block; }
  @media print {
    /* A sheet has no scroll pane and no margin of its own. Without a page
       margin the text runs into the printer's dead edge, and without
       exact colour a code block or tool output loses the fill that separates
       it from prose — both are what the screen rendering relies on. */
    @page { margin: 12mm; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    /* Keep a fold's header with the body it opens; a header alone at the foot
       of a page reads as an empty section. Long bodies still split, browsers
       ignore this once the block exceeds a page. */
    .chat-export-details, .chat-export-disclosure { break-inside: avoid; }
    .chat-export-theme-toggle { display: none; }
    .chat-export-shell { max-width: none; padding: 0; }
  }
</style>
</head>
<body>
<div class="chat-export-shell">
  <header class="chat-export-header">
    <div>
      <h1 class="chat-export-title">${title}</h1>
      <p class="chat-export-meta">${messageSummary} · ${t('export.exportedAt', { time: exportedAt })}</p>
      ${contextLine ? `<p class="chat-export-meta">${contextLine}</p>` : ''}
    </div>
    <button type="button" class="chat-export-theme-toggle" onclick="document.documentElement.classList.toggle('dark')">${t('export.toggleTheme')}</button>
  </header>
  ${body}
</div>
<script>
/* Printing hides a closed <details> completely — the body is not laid out. A
   transcript that keeps its runs folded would therefore print as bare summary
   lines. Open every fold for the print and restore the reader's state after,
   so printing the page by hand still yields the whole conversation. */
(function () {
  var reopened = [];
  window.addEventListener('beforeprint', function () {
    reopened = [];
    var folds = document.querySelectorAll('details');
    for (var index = 0; index < folds.length; index += 1) {
      if (folds[index].open) continue;
      reopened.push(folds[index]);
      folds[index].open = true;
    }
  });
  window.addEventListener('afterprint', function () {
    for (var index = 0; index < reopened.length; index += 1) {
      reopened[index].open = false;
    }
    reopened = [];
  });
})();
</script>
<script>
/* The one thing a static transcript cannot do with markup alone is write to
   the clipboard. Everything else on this page is a native disclosure; this
   listener gives each message footer's copy button the same behaviour it has
   in the app, with a selection-based fallback for browsers that refuse the
   async clipboard from file://. */
(function () {
  function markCopied(button) {
    button.classList.add('is-copied');
    window.setTimeout(function () { button.classList.remove('is-copied'); }, 1500);
  }
  function copyWithSelection(text, button) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); markCopied(button); } catch (error) {}
    document.body.removeChild(area);
  }
  /* A table copies as TSV and a code block copies as its own source, matching
     what the app gives each of its copy buttons. Both are scoped to the block
     that owns the button, so a code block never drags its language label into
     the clipboard and never falls back to the whole message.
     Every backslash below is doubled: this script lives inside a template
     literal, where an unescaped escape would become a real character. */
  function tableToTsv(table) {
    if (!table) return '';
    return Array.prototype.map.call(table.rows, function (row) {
      return Array.prototype.map.call(row.cells, function (cell) {
        return cell.innerText.replace(/\\s+/g, ' ').trim();
      }).join('\\t');
    }).join('\\n');
  }
  function textFor(button) {
    var group = button.closest('[data-export-copy-group]');
    if (group) {
      if (group.getAttribute('data-export-copy-group') === 'table') {
        return tableToTsv(group.querySelector('table'));
      }
      var code = group.querySelector('code');
      return code ? code.textContent : '';
    }
    var message = button.closest('.chat-message');
    var source = message && message.querySelector('[data-export-copy-source]');
    return source ? source.innerText : '';
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-export-copy]');
    if (!button) return;
    var text = textFor(button);
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        markCopied(button);
      }, function () {
        copyWithSelection(text, button);
      });
    } else {
      copyWithSelection(text, button);
    }
  });
})();
</script>
</body>
</html>`;
}
