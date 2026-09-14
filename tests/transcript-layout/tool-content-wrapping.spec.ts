import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Real-browser gate for the message body's line-break rules (G1–G3 of the
 * whitespace-gap round).
 *
 * jsdom applies no stylesheet cascade, so the jsdom suite can only pin that the
 * right classes are declared. What actually decides the rendered behaviour here
 * is `.chat-message pre, .chat-message code { white-space: pre-wrap
 * !important; word-break: … }` in `src/index.css`, and the only way to observe
 * a cascade is to run the real sheet in a real engine. That is what this file
 * does, over the same fixture the geometry suite uses.
 *
 * Three deliberate choices:
 *
 * - The assertions are on **word boundaries and overflow**, not on the exact
 *   character a line breaks at. Break points depend on font metrics, which
 *   differ between Chromium and WebKit; asserting them would pin a number the
 *   engines disagree about.
 * - Every measured surface is a `<pre>` or a `<code>`. Those are the only
 *   elements the global rule reaches — a plain paragraph computes
 *   `word-break: normal` both before and after the change, so a test aimed at
 *   one passes either way and proves nothing. This file was written the other
 *   way round first, and that vacuous version passed against the unfixed
 *   stylesheet.
 * - Where a measurement needs a narrow line box, the width is pinned **on the
 *   nearest block ancestor** (an inline `<code>` ignores `width`) and then read
 *   back and asserted, so a silently-ignored width cannot turn a real assertion
 *   into a vacuous one.
 */

type WrappingFixtureWindow = Window & typeof globalThis & {
  __TRANSCRIPT_FIXTURE__?: {
    dispatch(step: { action: string; payload?: unknown }): Promise<{ timestamp?: string }>;
  };
};

type ProbeResult = {
  tagName: string;
  className: string;
  whiteSpace: string;
  wordBreak: string;
  overflowWrap: string;
  /** The element whose line box was measured: the target, or its block ancestor when inline. */
  widthHostTag: string;
  widthHostClassName: string;
  widthHostWidth: number;
  /** Overflow of the element that owns the line box. */
  hostScrollWidth: number;
  hostClientWidth: number;
  /** Overflow of the whole row, so a wide element cannot push the pane sideways. */
  messageScrollWidth: number;
  messageClientWidth: number;
  /** The target's text split by rendered line, as the engine actually laid it out. */
  lines: string[];
};

async function openWrappingFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as WrappingFixtureWindow).__TRANSCRIPT_FIXTURE__));
  await page.evaluate(async () => {
    await (window as WrappingFixtureWindow).__TRANSCRIPT_FIXTURE__?.dispatch({
      action: 'seed-wrapping-samples',
    });
  });
  await expect(page.locator('.chat-message').filter({ hasText: 'aaaaaaaaaa' }).first()).toBeVisible();
  // The pane follows the tail with a few animation frames; let layout settle
  // before anything is measured.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * Measures the tightest element matching `selector` inside the message whose
 * text contains `marker`.
 */
function probe(
  page: Page,
  args: { marker: string; selector: string; widthPx?: number },
): Promise<ProbeResult> {
  return page.evaluate(({ marker, selector, widthPx }) => {
    const messages = Array.from(document.querySelectorAll<HTMLElement>('.chat-message'));
    const message = messages.find((node) => (node.textContent ?? '').includes(marker));
    if (!message) throw new Error(`no .chat-message containing ${JSON.stringify(marker)}`);

    // Ancestors contain their descendants' text, so several candidates match;
    // the one to measure is the tightest — the element that renders the marker
    // and nothing else. Taking the last in document order instead picked up
    // sibling chrome such as the markdown source-view toggle.
    const target = Array.from(message.querySelectorAll<HTMLElement>(selector))
      .filter((node) => (node.textContent ?? '').includes(marker))
      .sort((left, right) => (left.textContent ?? '').length - (right.textContent ?? '').length)[0];
    if (!target) throw new Error(`no ${selector} inside the message containing ${JSON.stringify(marker)}`);

    // An inline box (the usual case for `<code>`) takes no `width`; the line box
    // that decides where its content breaks belongs to the nearest block
    // ancestor, so that is where the condition has to be applied.
    let widthHost = target;
    while (widthHost.parentElement && getComputedStyle(widthHost).display.startsWith('inline')) {
      widthHost = widthHost.parentElement;
    }

    target.scrollIntoView({ block: 'center' });
    if (widthPx !== undefined) widthHost.style.width = `${widthPx}px`;

    const style = getComputedStyle(target);

    // Split the target's own text run by the vertical position each character
    // was actually painted at — the engine's own answer to "where did it break".
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent && node.textContent.trim().length > 0) {
        textNode = node as Text;
        break;
      }
    }
    const lines: string[] = [];
    if (textNode?.data) {
      const range = document.createRange();
      let currentTop = Number.NaN;
      for (let index = 0; index < textNode.data.length; index += 1) {
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        if (top !== currentTop) {
          lines.push('');
          currentTop = top;
        }
        lines[lines.length - 1] += textNode.data[index];
      }
    }

    return {
      tagName: target.tagName,
      className: target.className,
      whiteSpace: style.whiteSpace,
      wordBreak: style.wordBreak,
      overflowWrap: style.overflowWrap,
      widthHostTag: widthHost.tagName,
      widthHostClassName: widthHost.className,
      widthHostWidth: widthHost.getBoundingClientRect().width,
      hostScrollWidth: widthHost.scrollWidth,
      hostClientWidth: widthHost.clientWidth,
      messageScrollWidth: message.scrollWidth,
      messageClientWidth: message.clientWidth,
      lines,
    };
  }, args);
}

/** Every whitespace-separated token on every rendered line. */
const tokens = (lines: string[]): string[] =>
  lines.flatMap((line) => line.split(/\s+/).filter(Boolean));

test('code wraps between words, never inside one', async ({ page }) => {
  await openWrappingFixture(page);
  const result = await probe(page, { marker: 'aaaaaaaaaa', selector: 'code', widthPx: 140 });

  // Guard the measurement condition itself: a width the layout ignored would
  // make the word-boundary check below pass for the wrong reason.
  expect(
    Math.round(result.widthHostWidth),
    `pinned on ${result.widthHostTag}.${result.widthHostClassName}`,
  ).toBe(140);
  expect(result.lines.length).toBeGreaterThanOrEqual(3);

  // The fixture text is only these two words, repeated. `word-break: break-all`
  // split them mid-token (`bbbbbbbbb` + `b`), so a partial token on any line is
  // exactly the regression this pins.
  const observed = tokens(result.lines);
  expect(observed.length).toBeGreaterThanOrEqual(6);
  for (const token of observed) {
    expect(['aaaaaaaaaa', 'bbbbbbbbbb']).toContain(token);
  }
});

test('a token longer than the line does not overflow the transcript', async ({ page }) => {
  await openWrappingFixture(page);
  const result = await probe(page, { marker: 'Long token:', selector: 'div', widthPx: 200 });

  expect(Math.round(result.widthHostWidth), result.widthHostClassName).toBe(200);
  // `overflow-wrap: break-word` is what makes this hold now that `word-break`
  // is `normal`; without it the 400-character token would push the pane wide.
  expect(result.hostScrollWidth).toBeLessThanOrEqual(result.hostClientWidth + 1);
  expect(result.messageScrollWidth).toBeLessThanOrEqual(result.messageClientWidth + 1);
});

test('inline code wraps at word boundaries', async ({ page }) => {
  await openWrappingFixture(page);
  const result = await probe(page, { marker: 'ContentRenderers/TextContent.tsx', selector: 'code', widthPx: 160 });

  expect(result.tagName).toBe('CODE');
  // The element's own declarations, which the global rule used to overrule.
  expect(result.whiteSpace).toBe('pre-wrap');
  expect(result.overflowWrap).toBe('break-word');
  expect(result.wordBreak).toBe('normal');
  expect(result.messageScrollWidth).toBeLessThanOrEqual(result.messageClientWidth + 1);
});

test('the pure-JSON viewer keeps its source lines and scrolls instead of wrapping', async ({ page }) => {
  await openWrappingFixture(page);
  const code = await probe(page, { marker: '"key"', selector: 'code' });

  expect(code.whiteSpace).toBe('pre');
  expect(code.wordBreak).toBe('normal');

  // The scroll outlet is the parent `<pre>`; it is matched by the global
  // `.chat-message pre` rule alone (no marker class on it), so this doubles as
  // the assertion that the global rule resolves to `normal` for the six `<pre>`
  // surfaces that rely on it.
  const pre = await probe(page, { marker: '"key"', selector: 'pre' });
  expect(pre.tagName).toBe('PRE');
  expect(pre.wordBreak).toBe('normal');
  expect(pre.overflowWrap).toBe('break-word');
  expect(pre.hostScrollWidth).toBeGreaterThan(pre.hostClientWidth);
});

test('fenced code blocks keep their higher-specificity exemption', async ({ page }) => {
  await openWrappingFixture(page);
  const pre = await probe(page, { marker: 'const longLine', selector: '.markdown-code-block pre' });

  expect(pre.tagName).toBe('PRE');
  // `.chat-message .markdown-code-block pre` (0,2,1) must keep beating
  // `.chat-message pre` (0,1,1): a fenced block still never wraps.
  expect(pre.whiteSpace).toBe('pre');
  expect(pre.wordBreak).toBe('normal');
  expect(pre.overflowWrap).toBe('normal');
  expect(pre.hostScrollWidth).toBeGreaterThan(pre.hostClientWidth);
});
