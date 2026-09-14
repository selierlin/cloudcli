import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test } from 'vitest';

import { AskUserQuestionPanel } from '@/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, Question } from '@/shared/types';

/**
 * G1–G3 of the whitespace-gap round.
 *
 * G1: the AskUserQuestion *interaction panel* is the second face of the same
 * payload the transcript's answer card renders (`QuestionAnswerContent`, fixed
 * in the previous round). It sits in the composer, outside `.chat-message`, so
 * it inherits no global rule and had no whitespace class at all — every `\n`
 * inside a question or an option collapsed into a space.
 *
 * G2: the pure-JSON reply block asked for `whitespace-pre`, which the global
 * `.chat-message code { white-space: pre-wrap !important }` outranks on
 * specificity. The class was dead and the block wrapped instead of scrolling.
 *
 * G3 is a single declaration in `index.css` and cannot be asserted here — jsdom
 * applies no stylesheet cascade. Its computed values are covered by
 * `tests/transcript-layout/`. What this file pins is that the fix stayed at the
 * CSS level: the elements that already declared `break-words` must keep
 * declaring it, because that is what the global rule was overruling.
 */

// --- G1 -------------------------------------------------------------------

const QUESTION = 'Which file should I edit?\nPick one of the two.';
const LABEL = 'src/a.ts\n(the newer one)';
const DESCRIPTION = 'Rewrites two lines\nand leaves the rest alone.';

const questions = (): Question[] => [
  {
    question: QUESTION,
    header: 'File',
    options: [
      { label: LABEL, description: DESCRIPTION },
      { label: 'src/b.ts' },
    ],
  },
];

const renderPanel = (payload: Question[]) =>
  render(
    <AskUserQuestionPanel
      request={{ requestId: 'req-1', toolName: 'AskUserQuestion', input: { questions: payload } }}
      onDecision={() => {}}
    />,
  );

/**
 * The innermost element whose text is exactly `text`. Ancestors share their
 * descendants' text, and document order puts them first, so the last match is
 * the element that actually renders the string.
 */
const deepestWithText = (container: HTMLElement, text: string): HTMLElement => {
  const matches = Array.from(container.querySelectorAll<HTMLElement>('*')).filter(
    (node) => node.textContent === text,
  );
  assert.ok(matches.length > 0, `no element renders ${JSON.stringify(text)}`);
  return matches[matches.length - 1];
};

const hasToken = (el: HTMLElement, token: string) =>
  el.className.split(/\s+/).includes(token);

test('the interaction panel keeps the newlines in the question text', () => {
  const { container } = renderPanel(questions());
  const question = deepestWithText(container, QUESTION);

  assert.equal(question.tagName, 'P');
  assert.ok(hasToken(question, 'whitespace-pre-wrap'), question.className);
  assert.ok(hasToken(question, 'break-words'), question.className);
});

test('the interaction panel keeps the newlines in an option label', () => {
  const { container } = renderPanel(questions());
  const label = deepestWithText(container, LABEL);

  assert.ok(hasToken(label, 'whitespace-pre-wrap'), label.className);
  assert.ok(hasToken(label, 'break-words'), label.className);
});

test('the interaction panel keeps the newlines in an option description', () => {
  const { container } = renderPanel(questions());
  const description = deepestWithText(container, DESCRIPTION);

  assert.ok(hasToken(description, 'whitespace-pre-wrap'), description.className);
  assert.ok(hasToken(description, 'break-words'), description.className);
});

test('panel text keeps the classes when the payload has no newlines', () => {
  // The classes must not be conditional on the data: a payload that happens to
  // be single-line today would otherwise silently drop them.
  const { container } = renderPanel([
    { question: 'One line?', options: [{ label: 'yes', description: 'also one line' }] },
  ]);

  for (const text of ['One line?', 'yes', 'also one line']) {
    const el = deepestWithText(container, text);
    assert.ok(hasToken(el, 'whitespace-pre-wrap'), `${text}: ${el.className}`);
    assert.ok(hasToken(el, 'break-words'), `${text}: ${el.className}`);
  }
});

// --- G2 and the inline-code surface ---------------------------------------

const assistantMessage = (content: string): ChatMessage => ({
  type: 'assistant',
  content,
  timestamp: '2026-09-14T10:00:00.000Z',
  isStreaming: false,
});

const renderMessage = (content: string) =>
  render(
    <UiPreferencesProvider>
      <MessageComponent
        message={assistantMessage(content)}
        prevMessage={null}
        createDiff={() => []}
        provider="claude"
      />
    </UiPreferencesProvider>,
  );

test('a pure-JSON reply block opts out of the wrap via the marker class', () => {
  const { container } = renderMessage('{"a":1,"nested":{"b":2}}');
  const code = container.querySelector('code');

  assert.ok(code, 'expected the JSON viewer to render a <code>');
  assert.ok(hasToken(code, 'tool-terminal-output'), code.className);
  // The dead class must be gone: leaving it would suggest the utility still
  // did something.
  assert.ok(!hasToken(code, 'whitespace-pre'), code.className);

  const pre = code.parentElement;
  assert.equal(pre?.tagName, 'PRE');
  assert.ok(hasToken(pre as HTMLElement, 'overflow-x-auto'), pre?.className ?? '');
});

test('a JSON array reply is treated the same as an object', () => {
  const { container } = renderMessage('[{"a":1},{"b":2}]');
  const code = container.querySelector('code');

  assert.ok(code);
  assert.ok(hasToken(code, 'tool-terminal-output'), code.className);
});

test('ordinary replies carry no marker class', () => {
  const { container } = renderMessage('Just a normal answer.');

  assert.equal(container.querySelector('.tool-terminal-output'), null);
});

test('inline code in an assistant reply still declares its own wrapping', () => {
  // G3 flips the global `word-break`, not this element. If someone later drops
  // `break-words` here to "fix" a symptom, the global rule has nothing to
  // restore it to and long tokens start clipping.
  const { container } = renderMessage('Run `npm run test:client` before pushing.');
  const code = container.querySelector('code');

  assert.ok(code, 'expected an inline <code>');
  assert.ok(hasToken(code, 'whitespace-pre-wrap'), code.className);
  assert.ok(hasToken(code, 'break-words'), code.className);
  assert.ok(!hasToken(code, 'tool-terminal-output'), code.className);
});
