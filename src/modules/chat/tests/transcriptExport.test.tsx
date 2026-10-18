import assert from 'node:assert/strict';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { ChatMessage } from '@/shared/types';
import { buildTranscriptExport, toExportFileStem } from '@/modules/chat/utils/chatExport';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';

const chatT = i18n.getFixedT(null, 'chat');

const createDiff = createCachedDiffCalculator();
const exportedAt = new Date('2026-08-24T09:30:00.000Z');

const userMessage: ChatMessage = {
  type: 'user',
  content: 'Please rename the helper',
  timestamp: new Date('2026-08-24T09:00:00.000Z'),
} as ChatMessage;

const assistantMessage: ChatMessage = {
  type: 'assistant',
  content: 'Done. Here is the change:\n\n```js\nconst renamed = 1;\n```',
  timestamp: new Date('2026-08-24T09:01:00.000Z'),
} as ChatMessage;

// A tool call is typed `assistant` with empty content, which is exactly why an
// exporter that branches on `type` alone loses all of them.
const editToolMessage: ChatMessage = {
  type: 'assistant',
  content: '',
  isToolUse: true,
  toolName: 'Edit',
  toolInput: JSON.stringify({
    file_path: '/repo/src/helper.js',
    old_string: 'const a = 1;\nconst b = 2;',
    new_string: 'const renamed = 1;\nconst b = 2;\nconst c = 3;',
  }),
  toolResult: { content: 'Applied 1 edit', isError: false },
  timestamp: new Date('2026-08-24T09:00:30.000Z'),
} as unknown as ChatMessage;

const input = {
  messages: [userMessage, editToolMessage, assistantMessage],
  sessionTitle: 'Rename the helper',
  provider: 'claude' as const,
  createDiff,
};

describe('markdown export', () => {
  it('renders a tool call with its file, counts and diff', async () => {
    const markdown = await buildTranscriptExport('markdown', input, exportedAt);

    expect(markdown).toContain('`Edit`');
    expect(markdown).toContain('/repo/src/helper.js');
    expect(markdown).toContain('+2 -1');
    expect(markdown).toContain('+const renamed = 1;');
    expect(markdown).toContain('-const a = 1;');
    expect(markdown).toContain('Applied 1 edit');
  });

  it('keeps the user and assistant turns', async () => {
    const markdown = await buildTranscriptExport('markdown', input, exportedAt);

    expect(markdown).toContain('### You');
    expect(markdown).toContain('Please rename the helper');
    expect(markdown).toContain('### Claude');
    expect(markdown).toContain('const renamed = 1;');
  });

  it('fences content that already contains a fence', async () => {
    const markdown = await buildTranscriptExport('markdown', {
      ...input,
      messages: [{
        type: 'assistant',
        content: '',
        isToolUse: true,
        toolName: 'Bash',
        toolInput: JSON.stringify({ command: 'echo hi' }),
        toolResult: { content: 'output containing ``` a fence', isError: false },
        timestamp: new Date('2026-08-24T09:02:00.000Z'),
      } as unknown as ChatMessage],
    }, exportedAt);

    // A three-backtick fence would be closed early by the payload itself.
    expect(markdown).toContain('````');
  });
});

describe('json export', () => {
  it('carries every message unmodified', async () => {
    const json = JSON.parse(await buildTranscriptExport('json', input, exportedAt));

    assert.equal(json.messageCount, 3);
    assert.equal(json.messages.length, 3);
    assert.equal(json.messages[1].toolName, 'Edit');
    assert.equal(json.title, 'Rename the helper');
  });
});

describe('export filenames', () => {
  it('turns a session title into a safe stem', () => {
    assert.equal(
      toExportFileStem('Fix src/utils/date.ts "properly"', exportedAt),
      'fix-src-utils-date-ts-properly-2026-08-24',
    );
  });

  it('falls back when the title has nothing usable in it', () => {
    assert.equal(toExportFileStem('///', exportedAt), 'conversation-2026-08-24');
  });

  it('bounds a very long title', () => {
    const stem = toExportFileStem('word '.repeat(80), exportedAt);
    assert.ok(stem.length <= 60 + '-2026-08-24'.length);
  });
});

const bashToolMessage: ChatMessage = {
  type: 'assistant',
  content: '',
  isToolUse: true,
  toolName: 'Bash',
  toolInput: JSON.stringify({ command: 'npm test' }),
  toolResult: { content: 'ok 1 - everything passed', isError: false },
  timestamp: new Date('2026-08-24T09:00:45.000Z'),
} as unknown as ChatMessage;

describe('html export', () => {
  it('renders the real tool card rather than an empty section', async () => {
    const html = await buildTranscriptExport('html', input, exportedAt);

    // The diff viewer's own markup, not a re-implementation of it.
    expect(html).toContain('/repo/src/helper.js');
    expect(html).toContain('const renamed = 1;');
    // The `+N -M` badge the transcript shows on an edit.
    expect(html).toContain('2 lines added, 1 removed');
  });

  it('is a standalone document carrying the app’s own styles', async () => {
    const html = await buildTranscriptExport('html', input, exportedAt);

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>Rename the helper</title>');
    // The header is part of the document, so it follows the app's language
    // instead of falling back to hard-coded English.
    // The header counts the conversation, not its plumbing: this input is a
    // user turn, a tool call and an answer, but only the two ends are messages.
    expect(html).toContain(chatT('export.messages', { count: 2 }));
    expect(html).not.toContain(chatT('export.messages', { count: 3 }));
    // A missing key renders as the key itself, which is how the untranslated
    // chrome looked before.
    expect(html).not.toContain('>toggleTheme<');
    expect(html).toContain(`>${chatT('export.toggleTheme')}<`);
    // No network dependency: everything is inline.
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('includes tool output that the live view only reveals on demand', async () => {
    const html = await buildTranscriptExport(
      'html',
      { ...input, messages: [bashToolMessage] },
      exportedAt,
    );

    expect(html).toContain('npm test');
    // A document has no chevron to click, so output that is merely present but
    // collapsed to zero height is output the reader can never reach.
    expect(html).toContain('ok 1 - everything passed');
    expect(html).not.toContain('grid-rows-[0fr]');
  });

  it('opens the collapsible bodies, since nothing in the file can expand them', async () => {
    const html = await buildTranscriptExport('html', input, exportedAt);

    expect(html).not.toContain('data-state="closed"');
  });

  it('renders assistant markdown instead of escaping it', async () => {
    const html = await buildTranscriptExport('html', input, exportedAt);

    // The fenced block became real markup; the fence characters are gone.
    expect(html).toContain('<code');
    expect(html).not.toContain('```js');
  });

  it('escapes a session title that contains markup', async () => {
    const html = await buildTranscriptExport(
      'html',
      { ...input, sessionTitle: '<img src=x onerror=alert(1)>' },
      exportedAt,
    );

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });
});

const thinkingMessage: ChatMessage = {
  type: 'assistant',
  content: 'Considering whether the rename touches other call sites.',
  isThinking: true,
  timestamp: new Date('2026-08-24T09:00:20.000Z'),
} as unknown as ChatMessage;

describe('html export thinking', () => {
  it('folds thinking into a native disclosure, closed by default', async () => {
    const html = await buildTranscriptExport(
      'html',
      { ...input, messages: [userMessage, thinkingMessage, assistantMessage] },
      exportedAt,
    );

    expect(html).toContain('<details class="chat-export-disclosure">');
    // No `open` attribute: the document opens with the process quiet, which is
    // what the chat pane shows. A `<details>` still expands on click without
    // any script, so the content stays reachable.
    expect(html).not.toMatch(/<details[^>]*\sopen[=\s>]/);
    expect(html).toContain('Considering whether the rename touches other call sites.');
    expect(html).toContain(chatT('transcript.executionProcess.reasoning'));
  });
});

const narrationMessage: ChatMessage = {
  type: 'assistant',
  content: 'Looking for the other call sites first.',
  timestamp: new Date('2026-08-24T09:00:15.000Z'),
} as unknown as ChatMessage;

const parseExport = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

describe('html export process runs', () => {
  it('folds a turn’s reasoning, narration and tools into one closed disclosure', async () => {
    const html = await buildTranscriptExport(
      'html',
      {
        ...input,
        messages: [userMessage, thinkingMessage, narrationMessage, editToolMessage, assistantMessage],
      },
      exportedAt,
    );
    const doc = parseExport(html);
    const process = doc.querySelector('details.chat-export-process');
    assert.ok(process, 'the run has one disclosure of its own');

    // Closed by default, matching the chat pane's collapsed "Execution process"
    // row. This is the fold that used to be missing: every member rendered
    // open, so the turn read as one long wall of process output.
    assert.equal(process.hasAttribute('open'), false);
    assert.equal(
      process.querySelector('summary')?.textContent,
      `›${chatT('transcript.executionProcess.execution')} · ${chatT('transcript.executionProcess.toolCount', { count: 1 })}`,
    );
    // Every member row lives inside the fold — including the narration prose,
    // which now wears the chat's muted process styling instead of reading like
    // a second answer.
    // Five rows, one question, one answer: reasoning and the absorbed
    // narration are execution detail and must not inflate the header tally.
    assert.ok(html.includes(chatT('export.messages', { count: 2 })));
    assert.ok(!html.includes(chatT('export.messages', { count: 5 })));
    assert.ok(process.textContent?.includes('Considering whether the rename touches other call sites.'));
    assert.ok(process.textContent?.includes('Looking for the other call sites first.'));
    assert.ok(process.querySelector('.process-run-narration'));
    assert.ok(process.textContent?.includes('/repo/src/helper.js'));
    // The harness identity stays outside, where the chat paints it above the
    // collapsed row — folding the first row must not erase it from the page.
    assert.ok(process.previousElementSibling?.textContent?.includes(chatT('messageTypes.claude')));

    // The final answer is the turn's visible prose, so it stays outside.
    assert.ok(!process.textContent?.includes('Done. Here is the change'));
    assert.ok(doc.body.textContent?.includes('Done. Here is the change'));
  });

  it('leaves a reasoning-only run to its own disclosure', async () => {
    const html = await buildTranscriptExport(
      'html',
      { ...input, messages: [userMessage, thinkingMessage, assistantMessage] },
      exportedAt,
    );
    const doc = parseExport(html);

    // Wrapping here would stack two identical "Thinking process" folds.
    assert.equal(doc.querySelector('details.chat-export-process'), null);
    assert.equal(doc.querySelectorAll('details').length, 1);
  });

  it('opens a run that needs attention, since the label alone cannot flag it', async () => {
    const failedTool: ChatMessage = {
      ...editToolMessage,
      toolResult: { content: 'Permission denied', isError: true },
    } as unknown as ChatMessage;
    const html = await buildTranscriptExport(
      'html',
      { ...input, messages: [userMessage, failedTool, assistantMessage] },
      exportedAt,
    );
    const process = parseExport(html).querySelector('details.chat-export-process');

    assert.ok(process);
    assert.ok(process.hasAttribute('open'));
    assert.ok(process.textContent?.includes(chatT('transcript.executionProcess.attention')));
  });

  it('keeps one fold when the vanguard answer splits the run’s members', async () => {
    // Streaming shape: the answer arrives, then more tool activity, so the
    // run's members sit on both sides of the visible prose. An export taken
    // mid-run must not open a second header and summary for the same run.
    const streamingAnswer: ChatMessage = {
      type: 'assistant',
      content: 'Let me check the tests.',
      timestamp: new Date('2026-08-24T09:00:25.000Z'),
    } as ChatMessage;
    const html = await buildTranscriptExport(
      'html',
      {
        ...input,
        messages: [userMessage, thinkingMessage, streamingAnswer, bashToolMessage],
      },
      exportedAt,
    );
    const doc = parseExport(html);
    const processes = [...doc.querySelectorAll('details.chat-export-process')];

    assert.equal(processes.length, 1);
    assert.ok(processes[0]!.textContent?.includes('Considering whether the rename touches other call sites.'));
    assert.ok(processes[0]!.textContent?.includes('npm test'));
    // The vanguard is the turn's visible prose, so it stays outside.
    assert.ok(!processes[0]!.textContent?.includes('Let me check the tests.'));
    assert.ok(doc.body.textContent?.includes('Let me check the tests.'));
  });
});

// A file opened from disk resolves `url('/fonts/…')` against `file://`, so a
// font the app serves over HTTP has to be embedded or it silently disappears.
describe('html export asset inlining', () => {
  const injected: HTMLStyleElement[] = [];

  const injectStyle = (css: string): void => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    injected.push(style);
  };

  // Only the two members the exporter reads, so the test does not depend on
  // whichever fetch implementation the environment happens to provide.
  const responseOf = (bytes: number[], contentType: string): Response =>
    ({
      ok: true,
      headers: { get: (name: string) => (name === 'content-type' ? contentType : null) },
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    }) as unknown as Response;

  afterEach(() => {
    for (const style of injected.splice(0)) style.remove();
    vi.unstubAllGlobals();
  });

  it('embeds a bundled font instead of leaving a dead relative URL', async () => {
    injectStyle(
      "@font-face { font-family: 'Probe Sans'; src: url('/fonts/probe.woff2') format('woff2'); }",
    );
    const fetchMock = vi.fn(async () => responseOf([0x77, 0x4f, 0x46, 0x32], 'font/woff2'));
    vi.stubGlobal('fetch', fetchMock);

    const html = await buildTranscriptExport('html', input, exportedAt);

    // "wOF2", the woff2 signature, encoded — proof the bytes made it in — and
    // still wrapped, because `src: data:…` without `url()` is discarded.
    expect(html).toContain('url("data:font/woff2;base64,d09GMg==")');
    expect(html).not.toContain('probe.woff2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops the reference when the asset cannot be read', async () => {
    injectStyle(
      "@font-face { font-family: 'Probe Sans'; src: url('/fonts/missing.woff2') format('woff2'); }",
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const html = await buildTranscriptExport('html', input, exportedAt);

    // The export must still be produced; a dead URL in a static file is worse
    // than no rule at all.
    expect(html).not.toContain('missing.woff2');
    expect(html).toContain('none');
  });

  it('leaves a same-document fragment alone rather than fetching the page', async () => {
    injectStyle('.probe-fragment { background-image: url(#probe-gradient); }');
    const fetchMock = vi.fn(async () => responseOf([1], 'image/png'));
    vi.stubGlobal('fetch', fetchMock);

    const html = await buildTranscriptExport('html', input, exportedAt);

    expect(html).toContain('url(#probe-gradient)');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps one format per face and never fetches the legacy ones', async () => {
    injectStyle(
      "@font-face { font-family: 'Probe Sans'; font-style: normal; " +
        "src: url('/fonts/probe.woff2') format('woff2'), " +
        "url('/fonts/probe.woff') format('woff'), " +
        "url('/fonts/probe.ttf') format('truetype'); }",
    );
    const fetchMock = vi.fn(async () => responseOf([0x77, 0x4f, 0x46, 0x32], 'font/woff2'));
    vi.stubGlobal('fetch', fetchMock);

    const html = await buildTranscriptExport('html', input, exportedAt);

    // Every modern browser reads woff2, so the woff/ttf copies are payload
    // with no reachable consumer — one request, not three.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(html).toContain('url("data:font/woff2;base64,d09GMg==")');
    expect(html).not.toContain('probe.woff');
    expect(html).not.toContain('probe.ttf');
  });

  it('drops math faces when the transcript rendered no formula', async () => {
    injectStyle(
      "@font-face { font-family: KaTeX_Main; src: url('/fonts/katex-main.woff2') format('woff2'); }",
    );
    const fetchMock = vi.fn(async () => responseOf([1], 'font/woff2'));
    vi.stubGlobal('fetch', fetchMock);

    const html = await buildTranscriptExport('html', input, exportedAt);

    // Twenty math faces are unreachable without `.katex` markup.
    expect(html).not.toContain('katex-main');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps math faces when a formula actually rendered', async () => {
    injectStyle(
      "@font-face { font-family: KaTeX_Main; src: url('/fonts/katex-main.woff2') format('woff2'); }",
    );
    const fetchMock = vi.fn(async () => responseOf([1], 'font/woff2'));
    vi.stubGlobal('fetch', fetchMock);

    const html = await buildTranscriptExport(
      'html',
      {
        ...input,
        // `$…$` is disabled in the chat renderer; `\[…\]` is what a model's
        // display math actually arrives as.
        messages: [{ ...assistantMessage, content: String.raw`\[a^2 + b^2 = c^2\]` }],
      },
      exportedAt,
    );

    expect(html).toContain('class="katex"');
    expect(html).toContain('url("data:font/woff2;base64,AQ==")');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

const htmlTagOf = (html: string): string =>
  html.slice(html.indexOf('<html'), html.indexOf('>', html.indexOf('<html')) + 1);

// Tool rows used to force their bodies open in an export because their toggle
// is React state. That kept the content reachable but left the row permanently
// expanded — the reader could never fold a long command away.
describe('html export tool disclosures', () => {
  it('renders a Bash row as a native disclosure that starts collapsed', async () => {
    const doc = parseExport(
      await buildTranscriptExport('html', { ...input, messages: [bashToolMessage] }, exportedAt),
    );
    const details = doc.querySelector('details.chat-export-details');

    assert.ok(details, 'the command row is a details element');
    // A transcript is mostly commands; leaving every output open buries the
    // conversation. The row keeps its summary so one click still reveals it.
    assert.equal(details.hasAttribute('open'), false, 'its output waits for a click');
    assert.ok(details.querySelector('summary')?.textContent?.includes('npm test'));
    assert.ok(details.textContent?.includes('ok 1 - everything passed'));
    // The chevron flips through the export's own stylesheet, not React state.
    assert.ok(details.querySelector('summary .chat-export-details-chevron'));
  });

  it('renders a collapsible tool section as a native disclosure that starts collapsed', async () => {
    const doc = parseExport(await buildTranscriptExport('html', input, exportedAt));
    const sections = [...doc.querySelectorAll('details.chat-export-details')];

    assert.ok(sections.length > 0);
    assert.ok(sections.some((section) => section.textContent?.includes('/repo/src/helper.js')));
    // Every layer of the process — run, batch and one tool's output — starts
    // folded; the reader opens exactly the depth they want.
    assert.ok(sections.every((section) => !section.hasAttribute('open')));
    // Radix's own state machine cannot run in a document; none of it is left.
    assert.equal(doc.querySelector('[data-state="closed"]'), null);
  });
});

// The final answer's footer is the one place the export can still behave like
// the app: the model that answered, when, and a working copy control.
describe('html export message footer', () => {
  const answeredMessage: ChatMessage = {
    ...assistantMessage,
    model: 'claude-sonnet-4-5',
  } as ChatMessage;

  it('keeps copy, model and time under the final answer', async () => {
    const doc = parseExport(
      await buildTranscriptExport(
        'html',
        { ...input, messages: [userMessage, thinkingMessage, answeredMessage] },
        exportedAt,
      ),
    );
    const copy = doc.querySelector('[data-export-copy]');
    const source = doc.querySelector('[data-export-copy-source]');

    assert.ok(copy, 'the footer carries a copy control');
    assert.ok(source, 'the copy control needs a source subtree');
    assert.ok(source.textContent?.includes('Done. Here is the change'));
    // The collapsed reasoning lives inside the source, but `innerText` skips
    // closed details — the copied text is what the reader can see.
    assert.ok(copy.closest('.chat-message')?.contains(source));

    const answeredBy = chatT('message.answeredBy', { model: 'claude-sonnet-4-5' });
    assert.ok(doc.querySelector(`[title="${answeredBy}"]`), 'the answering model is named');
    // Not a "today" timestamp, so the footer prints the full date and time.
    assert.ok(
      copy.parentElement?.textContent?.includes(
        new Date(answeredMessage.timestamp).toLocaleString(),
      ),
    );
  });

  it('does not put a footer on the process narration', async () => {
    const doc = parseExport(
      await buildTranscriptExport(
        'html',
        { ...input, messages: [userMessage, thinkingMessage, narrationMessage, answeredMessage] },
        exportedAt,
      ),
    );

    // Narration is process record, not an answer; its copy target and footer
    // would both belong to the row the reader never asked to copy.
    const narration = doc.querySelector('.process-run-narration');
    assert.ok(narration);
    assert.equal(narration.closest('.chat-message')?.querySelector('[data-export-copy]'), null);
  });
});


// The document, not the transcript: what the export wears is decided by the
// attributes on `<html>`, and a stylesheet full of `[data-theme="…"]` rules is
// inert without the attribute that selects them.
describe('html export root attributes', () => {
  const root = document.documentElement;
  // Read before any test runs, so a test that rewrites `lang` can put the
  // document back exactly as it found it.
  const documentLang = root.getAttribute('lang');

  afterEach(() => {
    root.removeAttribute('data-theme');
    root.removeAttribute('data-appearance');
    root.removeAttribute('style');
    root.classList.remove('dark');
    if (documentLang === null) root.removeAttribute('lang');
    else root.setAttribute('lang', documentLang);
  });

  it('carries what the document is wearing, minus the splash record', async () => {
    root.setAttribute('data-theme', 'cc-dracula');
    root.setAttribute('data-appearance', 'light');
    root.classList.add('dark');
    root.style.setProperty('--ui-font-family', 'Encode Sans');

    const tag = htmlTagOf(await buildTranscriptExport('html', input, exportedAt));

    expect(tag).toContain('data-theme="cc-dracula"');
    expect(tag).toContain('class="dark"');
    // Font settings are an inline style on `<html>`, not part of any sheet.
    expect(tag).toContain('--ui-font-family: Encode Sans');
    // The first-paint appearance is stale by design — React never maintains it.
    expect(tag).not.toContain('data-appearance');
  });

  it('writes its own lang from the app language, and only one', async () => {
    root.setAttribute('lang', 'fr');

    const tag = htmlTagOf(await buildTranscriptExport('html', input, exportedAt));

    // The live document's attribute is not authoritative — the template owns
    // this one, and a second `lang` would be invalid markup.
    expect(tag).not.toContain('"fr"');
    expect(tag).toContain(`lang="${i18n.language}"`);
    expect(tag.match(/\blang=/g) ?? []).toHaveLength(1);
  });

  it('escapes an attribute value that carries a quote', async () => {
    // A font stack is quoted in CSS, so this is the shape the value really has.
    root.style.setProperty('--ui-font-family', '"My Font", sans-serif');

    const html = await buildTranscriptExport('html', input, exportedAt);

    expect(html).toContain('&quot;My Font&quot;, sans-serif');
    // An unescaped quote would have closed the attribute early.
    expect(html).not.toContain('--ui-font-family: "My Font');
  });
});
