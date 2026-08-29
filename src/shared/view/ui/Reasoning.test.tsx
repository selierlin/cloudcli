import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { Reasoning, ReasoningContent } from './Reasoning';

test('lazy reasoning content is omitted from the initial closed render', () => {
  const markup = renderToStaticMarkup(
    <Reasoning defaultOpen={false}>
      <ReasoningContent lazyMount>
        <span>expensive markdown body</span>
      </ReasoningContent>
    </Reasoning>,
  );

  assert.equal(markup.includes('expensive markdown body'), false);
});

test('lazy reasoning content renders immediately when initially open', () => {
  const markup = renderToStaticMarkup(
    <Reasoning defaultOpen>
      <ReasoningContent lazyMount>
        <span>visible reasoning body</span>
      </ReasoningContent>
    </Reasoning>,
  );

  assert.equal(markup.includes('visible reasoning body'), true);
});
