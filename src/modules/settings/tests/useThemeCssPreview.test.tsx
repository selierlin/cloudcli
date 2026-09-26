import assert from 'node:assert/strict';

import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test } from 'vitest';

import type { PastedThemeFormat } from '@/shared/userThemePastes';
import { useThemeCssPreview } from '@/modules/settings/hooks/useThemeCssPreview';

/**
 * The advanced mode's live preview (§5.5): the page wears the draft, and the
 * report beside the box says what is on the page.
 *
 * What these tests hold is the pair of properties that make a preview worth
 * having: the text reaches the *document* rather than only the component's
 * state, and a draft that cannot be injected says so instead of leaving the
 * previous one up looking like it worked. The debounce is tested from both sides
 * — nothing before the pause, the draft after it — because "real time" is what
 * the feature claims.
 */

const PREVIEW_SELECTOR = 'style[data-cloudcli-theme-preview]';

const previewElement = (): HTMLStyleElement | null =>
  document.querySelector<HTMLStyleElement>(PREVIEW_SELECTOR);

function Probe({ format, draft }: { format: PastedThemeFormat; draft: string }) {
  const state = useThemeCssPreview(format, draft);
  return (
    <div data-testid="state">
      {state.kind === 'unavailable' ? `unavailable:${state.reason}` : state.kind}
    </div>
  );
}

const stateText = (container: HTMLElement) =>
  container.querySelector('[data-testid="state"]')?.textContent;

/** Waits out the debounce and lets the state update it causes settle. */
async function passDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 350);
    });
  });
}

/** Waits less than the debounce, so a draft that has not been applied yet is still absent. */
async function waitLessThanDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  });
}

beforeEach(() => {
  previewElement()?.remove();
});

afterEach(() => {
  previewElement()?.remove();
});

test('the draft reaches the document as a stylesheet', async () => {
  const { container } = render(<Probe format="css" draft=":root { --primary: 175 84% 32%; }" />);

  await passDebounce();

  assert.equal(
    previewElement()?.textContent,
    ':root { --primary: 175 84% 32%; }',
    'the preview has to be in the document; state alone would not repaint anything',
  );
  assert.equal(stateText(container), 'previewing');
});

test('the draft is not put on the page before typing pauses', async () => {
  render(<Probe format="css" draft=":root { --primary: 175 84% 32%; }" />);

  await waitLessThanDebounce();
  assert.ok(previewElement() === null, 'a preview per keystroke would repaint the app at typing speed');

  await passDebounce();
  assert.ok(previewElement(), 'and it arrives once the typing stops');
});

test('a later draft replaces the stylesheet rather than adding a second one', async () => {
  const { rerender } = render(<Probe format="css" draft=":root { --a: 1; }" />);
  await passDebounce();

  rerender(<Probe format="css" draft=":root { --a: 2; }" />);
  await passDebounce();

  assert.equal(
    document.querySelectorAll(PREVIEW_SELECTOR).length,
    1,
    'two previews would leave the first one applied under the second',
  );
  assert.equal(previewElement()?.textContent, ':root { --a: 2; }');
});

test('a draft that cannot be injected says so and takes the previous one away', async () => {
  const { container, rerender } = render(<Probe format="css" draft=":root { --a: 1; }" />);
  await passDebounce();
  assert.ok(previewElement(), 'the first draft was applied, so there is one to take away');

  rerender(<Probe format="css" draft="@import url('x.css');" />);
  await passDebounce();

  assert.ok(
    previewElement() === null,
    'a refused draft must not leave the previous one on the page — the author would read it as this one',
  );
  assert.equal(
    stateText(container),
    'unavailable:import-rule',
    'and the box has to name the reason, the same one a paste of this text would give',
  );
});

test('a result is not reported against a draft it did not come from', async () => {
  const { container, rerender } = render(<Probe format="css" draft="@import url('x.css');" />);
  await passDebounce();
  assert.equal(stateText(container), 'unavailable:import-rule');

  rerender(<Probe format="css" draft=":root { --a: 1; }" />);

  assert.equal(
    stateText(container),
    'idle',
    'while the new draft waits out the debounce, the old verdict says nothing about it',
  );
});

test('option A is not previewed', async () => {
  const { container } = render(
    <Probe format="json" draft='{ "tokens": { "--primary": "175 84% 32%" } }' />,
  );
  await passDebounce();

  assert.ok(previewElement() === null, '§5.5 puts the preview on the advanced switch');
  assert.equal(stateText(container), 'idle');
});

test('emptying the box takes the preview away', async () => {
  const { container, rerender } = render(<Probe format="css" draft=":root { --a: 1; }" />);
  await passDebounce();
  assert.ok(previewElement(), 'the draft was applied');

  rerender(<Probe format="css" draft="" />);

  assert.ok(previewElement() === null, 'an empty box is not a theme the page should keep wearing');
  assert.equal(stateText(container), 'idle');
});

test('a box holding only whitespace is not previewed', async () => {
  // A JS expression, not a JSX attribute: `draft="\n\t"` would be the four
  // literal characters, which are not whitespace and would be previewed.
  render(<Probe format="css" draft={'   \n\t '} />);
  await passDebounce();

  assert.ok(
    previewElement() === null,
    'whitespace is not a stylesheet, and putting it on the page would clear the picked theme for nothing',
  );
});

test('leaving the page removes the preview', async () => {
  const { unmount } = render(<Probe format="css" draft=":root { --a: 1; }" />);
  await passDebounce();
  assert.ok(previewElement(), 'the draft was applied');

  unmount();

  assert.ok(previewElement() === null, 'a preview outliving the page would be a theme nobody chose');
});
