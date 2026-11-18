import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, test, vi } from 'vitest';

import { CollapsibleUserMessage } from '@/modules/chat/transcript/CollapsibleUserMessage';
import '@/modules/i18n';

/**
 * A question taller than the fold threshold starts clipped and can be unfolded
 * in place; a reload returns it to the folded state.
 */

const SCROLL_HEIGHT_DESCRIPTOR = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');

/**
 * jsdom lays nothing out, so the clip decision is driven from the fixture text.
 * Every other element reports an empty height.
 */
function stubQuestionHeight(heights: Record<string, number>) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const text = this.textContent ?? '';
      for (const [needle, height] of Object.entries(heights)) {
        if (text.includes(needle)) return height;
      }
      return 0;
    },
  });
}

afterEach(() => {
  if (SCROLL_HEIGHT_DESCRIPTOR) {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', SCROLL_HEIGHT_DESCRIPTOR);
  }
});

const renderQuestion = (text: string, enabled?: boolean) => render(
  <CollapsibleUserMessage enabled={enabled}>
    <p>{text}</p>
  </CollapsibleUserMessage>,
);

test('a short question keeps its full height and offers no toggle', () => {
  stubQuestionHeight({ SHORT: 120 });
  const { container } = renderQuestion('SHORT question');

  const body = container.firstElementChild as HTMLElement;
  assert.equal(body.style.maxHeight, '', 'a question under the threshold is not clipped');
  assert.equal(container.querySelector('button'), null, 'there is nothing to unfold');
});

test('a long question starts folded and unfolds on click', () => {
  stubQuestionHeight({ LONG: 600 });
  const { container } = renderQuestion('LONG question');

  const body = container.firstElementChild as HTMLElement;
  const toggle = container.querySelector('button');
  assert.equal(body.style.maxHeight, '196px', 'the folded block keeps about eight lines');
  assert.ok(toggle, 'the folded question offers a toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  fireEvent.click(toggle);
  assert.equal(body.style.maxHeight, '', 'unfolding releases the clip');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');

  fireEvent.click(toggle);
  assert.equal(body.style.maxHeight, '196px', 'folding restores the clip');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('an exported transcript keeps the whole question', () => {
  stubQuestionHeight({ LONG: 600 });
  const { container } = renderQuestion('LONG question', false);

  const body = container.firstElementChild as HTMLElement;
  assert.equal(body.style.maxHeight, '', 'a document has no reader to unfold it');
  assert.equal(container.querySelector('button'), null, 'and no control to click');
});

test('the disabled branch meets the static export renderer without a layout effect', () => {
  // The export document is built with renderToStaticMarkup, where a layout
  // effect warns once per question. The disabled branch therefore renders no
  // hooks at all; this pins that split down.
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const html = renderToStaticMarkup(
      <CollapsibleUserMessage enabled={false}>
        <p>LONG question</p>
      </CollapsibleUserMessage>,
    );

    assert.equal(html, '<p>LONG question</p>', 'the document carries the question untouched');
    assert.ok(
      !errorSpy.mock.calls.some((call) => String(call[0]).includes('useLayoutEffect')),
      'no layout-effect warning from the static renderer',
    );
  } finally {
    errorSpy.mockRestore();
  }
});
