import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test } from 'vitest';

import { Markdown } from '@/modules/chat/transcript/Markdown';

/**
 * GFM's autolink literal ends a URL only at whitespace, a line ending or `<`,
 * so CJK prose that puts a URL straight against punctuation gets the whole
 * sentence linked. `normalizeAutolinkBoundaries` wraps such URLs in angle
 * brackets first; these render the real component, so the rewrite under test
 * is the one the app ships.
 */

const PROSE = 'prose prose-sm max-w-none dark:prose-invert';

const renderMarkdown = (content: string) =>
  render(<Markdown className={PROSE}>{content}</Markdown>).container;

const inlineText = (container: HTMLElement, selector: string): string[] =>
  Array.from(container.querySelectorAll(selector)).map((node) => node.textContent ?? '');

test('a bare URL followed by a fullwidth parenthesis stops at the URL', () => {
  const container = renderMarkdown('本地开发服务器还开着（http://localhost:5199/），需要我关掉吗？');

  assert.deepEqual(inlineText(container, 'a'), ['http://localhost:5199/']);
  assert.equal(container.querySelector('a')?.getAttribute('href'), 'http://localhost:5199/');
  assert.equal(
    container.textContent,
    '本地开发服务器还开着（http://localhost:5199/），需要我关掉吗？',
  );
});

const BARE_FOLLOWERS: Array<[string, string]> = [
  ['a CJK comma', '详见 http://x.test/a，然后继续'],
  ['a CJK period', '详见 http://x.test/a。'],
  ['an ideographic comma', '详见 http://x.test/a、后面'],
  ['a CJK semicolon', '详见 http://x.test/a；后面'],
  ['a CJK question mark', '详见 http://x.test/a？'],
  ['a closing CJK quote', '详见「http://x.test/a」后继续'],
];

for (const [name, content] of BARE_FOLLOWERS) {
  test(`a bare URL followed by ${name} links only the URL`, () => {
    const container = renderMarkdown(content);

    assert.deepEqual(inlineText(container, 'a'), ['http://x.test/a']);
    assert.equal(container.querySelector('a')?.getAttribute('href'), 'http://x.test/a');
  });
}

test('a bold URL followed directly by a CJK parenthesis keeps the tail out of the link', () => {
  const container = renderMarkdown(
    '亮，站点做好了，本地已经跑起来验证过：**http://localhost:5199/**（开发服务器还开着，可以直接点开看）。',
  );

  assert.deepEqual(inlineText(container, 'strong'), ['http://localhost:5199/']);
  assert.deepEqual(inlineText(container, 'a'), ['http://localhost:5199/']);
  assert.equal(container.querySelector('a')?.getAttribute('href'), 'http://localhost:5199/');
  assert.equal(
    container.textContent,
    '亮，站点做好了，本地已经跑起来验证过：http://localhost:5199/（开发服务器还开着，可以直接点开看）。',
  );
});

test('a bold repository URL followed by a CJK parenthesis renders as a bold link', () => {
  const container = renderMarkdown(
    '**https://github.com/selierlin/dsh-purge**（私有，默认分支 `master`，`.git` 仅 4.1M）',
  );

  assert.deepEqual(inlineText(container, 'strong'), ['https://github.com/selierlin/dsh-purge']);
  assert.equal(
    container.querySelector('a')?.getAttribute('href'),
    'https://github.com/selierlin/dsh-purge',
  );
  assert.ok(!(container.textContent ?? '').includes('**'));
});

const BOLD_FOLLOWERS: Array<[string, string, string]> = [
  ['a CJK period', '**http://x.test/a**。', 'http://x.test/a'],
  ['a CJK character', '**http://x.test/a**后面跟着中文', 'http://x.test/a'],
  ['a Japanese kana', '**http://x.test/a**の続き', 'http://x.test/a'],
  ['a Hangul syllable', '**http://x.test/a**한국어', 'http://x.test/a'],
];

for (const [name, content, url] of BOLD_FOLLOWERS) {
  test(`a bold URL followed directly by ${name} stays bold and links only the URL`, () => {
    const container = renderMarkdown(content);

    assert.deepEqual(inlineText(container, 'strong'), [url]);
    assert.equal(container.querySelector('a')?.getAttribute('href'), url);
    assert.ok(
      !(container.textContent ?? '').includes('**'),
      'no literal ** may survive in the rendered text',
    );
  });
}

// The rewrite only runs when the message contains a URL somewhere, so the bold
// branch must be anchored on a scheme: otherwise every bold run followed by a
// CJK character would be wrapped as `<…>`, which is not an autolink and renders
// with literal angle brackets and no emphasis.
test('a bold run that is not a URL is left alone when the message contains a URL', () => {
  const container = renderMarkdown('先看链接 http://x.test/a。然后**加粗**后继续');

  assert.deepEqual(inlineText(container, 'strong'), ['加粗']);
  assert.equal((container.textContent ?? '').includes('<'), false);
});

test('a bold link followed by CJK text stays a bold link', () => {
  const container = renderMarkdown('先看链接 http://x.test/a。运行 **[npm](http://x.test/b)**后重启');

  const strong = container.querySelector('strong');
  assert.equal(strong?.textContent, 'npm');
  assert.equal(strong?.querySelector('a')?.getAttribute('href'), 'http://x.test/b');
  assert.equal((container.textContent ?? '').includes('<'), false);
});

test('a bold IRI is still wrapped, so its CJK path survives', () => {
  const container = renderMarkdown('**https://zh.wikipedia.org/wiki/中文**后面继续');

  assert.deepEqual(inlineText(container, 'strong'), ['https://zh.wikipedia.org/wiki/中文']);
  assert.deepEqual(inlineText(container, 'a'), ['https://zh.wikipedia.org/wiki/中文']);
});

const UNTOUCHED: Array<[string, string, (container: HTMLElement) => void]> = [
  [
    'a URL with CJK in its path (IRI)',
    '详见 https://zh.wikipedia.org/wiki/中文',
    (container) => {
      assert.deepEqual(inlineText(container, 'a'), ['https://zh.wikipedia.org/wiki/中文']);
    },
  ],
  [
    'the author’s own link destination',
    '[文案](http://x.test/a，后续)',
    (container) => {
      assert.deepEqual(inlineText(container, 'a'), ['文案']);
      assert.equal(
        container.querySelector('a')?.getAttribute('href'),
        'http://x.test/a%EF%BC%8C%E5%90%8E%E7%BB%AD',
      );
    },
  ],
  [
    'an angle autolink that already ends',
    '详见 <http://x.test/a>，然后继续',
    (container) => {
      assert.deepEqual(inlineText(container, 'a'), ['http://x.test/a']);
      assert.ok(!(container.textContent ?? '').includes('<<'));
    },
  ],
  [
    'a URL followed by a space',
    '访问 http://x.test/a 后继续',
    (container) => {
      assert.deepEqual(inlineText(container, 'a'), ['http://x.test/a']);
    },
  ],
  [
    'a bold URL followed by a space',
    '**http://x.test/a** 后面',
    (container) => {
      assert.deepEqual(inlineText(container, 'strong'), ['http://x.test/a']);
    },
  ],
  [
    'bold text that is not a bare URL',
    '中文**加粗**中文',
    (container) => {
      assert.deepEqual(inlineText(container, 'strong'), ['加粗']);
    },
  ],
  [
    'an inline code span',
    '示例 `http://x.test/a，说明` 保持原样',
    (container) => {
      assert.deepEqual(inlineText(container, 'a'), []);
      assert.ok((container.textContent ?? '').includes('http://x.test/a，说明'));
    },
  ],
  [
    'a fenced code block',
    '```md\nhttp://x.test/a，说明\n```',
    (container) => {
      assert.deepEqual(inlineText(container, 'a'), []);
      assert.ok((container.textContent ?? '').includes('http://x.test/a，说明'));
    },
  ],
];

for (const [name, content, assertRendered] of UNTOUCHED) {
  test(`the rewrite leaves ${name} alone`, () => {
    assertRendered(renderMarkdown(content));
  });
}
