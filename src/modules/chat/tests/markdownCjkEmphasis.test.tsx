import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test } from 'vitest';

import { Markdown } from '@/modules/chat/transcript/Markdown';

/**
 * CommonMark's emphasis flanking rules assume space-separated words. A bold run
 * that ends in punctuation and is directly followed by a CJK character never
 * closes — the closing `**` is preceded by punctuation but followed by a
 * character that is neither whitespace nor punctuation, so it is not
 * right-flanking — and its asterisks leak into the reply as literal text.
 * Chinese prose hits this constantly, because it puts punctuation inside the
 * emphasis and no space after it. Markdown.tsx wires in `remark-cjk-friendly`
 * for exactly this; these render the real component, so the plugin list under
 * test is the one the app ships.
 */

const PROSE = 'prose prose-sm max-w-none dark:prose-invert';

const renderMarkdown = (content: string) =>
  render(<Markdown className={PROSE}>{content}</Markdown>).container;

/** Text content of every inline element the selector matches, in document order. */
const inlineText = (container: HTMLElement, selector: string): string[] =>
  Array.from(container.querySelectorAll(selector)).map((node) => node.textContent ?? '');

const FIXED: Array<[string, string, string[]]> = [
  [
    'bold closing on a straight quote, followed by a CJK character',
    '发送路径是**唯一还停留在"100ms 后一次性跳到底部"**的滚动写入',
    ['唯一还停留在"100ms 后一次性跳到底部"'],
  ],
  [
    'bold closing on a CJK period, followed by a CJK character',
    '这是**重点。**后面紧跟文字',
    ['重点。'],
  ],
  [
    'bold closing on a curly quote',
    '**唯一还停留在“弯引号”**的滚动',
    ['唯一还停留在“弯引号”'],
  ],
  [
    'bold opening on CJK punctuation',
    '前缀**「被引号包住」**后缀',
    ['「被引号包住」'],
  ],
];

for (const [name, content, expected] of FIXED) {
  test(`CJK emphasis renders as bold instead of leaking asterisks: ${name}`, () => {
    const container = renderMarkdown(content);

    assert.deepEqual(inlineText(container, 'strong'), expected);
    assert.ok(
      !(container.textContent ?? '').includes('**'),
      'no literal ** may survive in the rendered text',
    );
  });
}

test('a single asterisk closing on CJK punctuation renders as italics', () => {
  const container = renderMarkdown('这是*斜体。*后面');

  assert.deepEqual(inlineText(container, 'em'), ['斜体。']);
  assert.ok(!(container.textContent ?? '').includes('*'));
});

const UNCHANGED: Array<[string, string]> = [
  ['multiplication signs', '计算 2 * 3 * 4 的结果'],
  ['an asterisk with nothing to close it', '这是*未闭合的星号后面'],
  ['an underscore inside a path', '路径 src/a_b_c/d.ts 里的下划线'],
];

for (const [name, content] of UNCHANGED) {
  test(`the CJK rule does not invent emphasis: ${name}`, () => {
    const container = renderMarkdown(content);

    assert.deepEqual(inlineText(container, 'strong'), []);
    assert.deepEqual(inlineText(container, 'em'), []);
  });
}

test('markdown outside CJK context is unaffected', () => {
  const container = renderMarkdown('this is **bold** and *italic* text');

  assert.deepEqual(inlineText(container, 'strong'), ['bold']);
  assert.deepEqual(inlineText(container, 'em'), ['italic']);
});

test('CJK bold that already parsed keeps parsing', () => {
  const container = renderMarkdown('中文**加粗**中文');

  assert.deepEqual(inlineText(container, 'strong'), ['加粗']);
  assert.equal(container.textContent, '中文加粗中文');
});
