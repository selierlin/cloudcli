import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { test } from 'vitest';

import CommitHistoryItem from '@/modules/git-panel/history/CommitHistoryItem';
import type { GitCommitSummary } from '@/shared/types';

/**
 * The Commits tab's wrap/scroll switch.
 *
 * `ChangesView` renders this switch on every expanded file row. `HistoryView`
 * shows the same diff surface for a whole commit and had no switch at all, so
 * on a phone the commit diff could only ever wrap — with no way back to
 * horizontal scroll. These cases pin when the switch exists and that it drives
 * the shared wrap state rather than the commit's own expand/collapse.
 *
 * The switch is located through `button[title]`: the commit row's expand button
 * carries no `title`, so the lookup stays independent of the i18n copy, which
 * this suite runs without a provider (same as the other jsdom suites here).
 */

const COMMIT: GitCommitSummary = {
  hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  author: 'Tester',
  date: '2026-09-14T10:00:00.000Z',
  message: 'Keep the commit diff line structure',
};

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  '-const value = 1;',
  '+const value = 2;',
].join('\n');

type RenderOptions = {
  isMobile: boolean;
  wrapText?: boolean;
  isExpanded?: boolean;
  diff?: string;
};

const renderItem = ({ isMobile, wrapText = true, isExpanded = true, diff = DIFF }: RenderOptions) => {
  const calls = { expand: 0, wrap: 0 };
  const view = render(
    <CommitHistoryItem
      commit={COMMIT}
      isExpanded={isExpanded}
      diff={diff}
      isMobile={isMobile}
      wrapText={wrapText}
      onToggle={() => {
        calls.expand += 1;
      }}
      onToggleWrapText={() => {
        calls.wrap += 1;
      }}
    />,
  );
  return { ...view, calls };
};

const switchButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('button[title]');

/** The rendered diff line for a known source line, whatever chrome surrounds it. */
const diffLine = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('.diff-viewer > div')).find(
    (node) => node.textContent === '-const value = 1;',
  );

const hasToken = (element: HTMLElement, token: string) =>
  element.className.split(/\s+/).includes(token);

test('an expanded commit diff offers the wrap switch on mobile', () => {
  const { container } = renderItem({ isMobile: true });

  assert.ok(switchButton(container), 'expected the wrap switch to render');
});

test('the switch is absent on desktop, where the diff never wraps', () => {
  // Rendering it there would be a dead control: `GitDiffViewer` only honours
  // `wrapText` when `isMobile` is true.
  const { container } = renderItem({ isMobile: false });

  assert.equal(switchButton(container), null);
});

test('the switch is absent while the commit is collapsed', () => {
  const { container } = renderItem({ isMobile: true, isExpanded: false });

  assert.equal(switchButton(container), null);
});

test('clicking the switch toggles wrapping without collapsing the commit', () => {
  const { container, calls } = renderItem({ isMobile: true });
  const button = switchButton(container);
  assert.ok(button);

  fireEvent.click(button);

  assert.equal(calls.wrap, 1);
  // The switch must not live inside the commit row's own button: a click there
  // would collapse the very commit the user is trying to read.
  assert.equal(calls.expand, 0);
});

test('the switch offers the opposite of the current wrap state', () => {
  // `wrapText: true` means the diff wraps today, so the switch offers scroll.
  const wrapping = renderItem({ isMobile: true, wrapText: true });
  const scrolling = renderItem({ isMobile: true, wrapText: false });

  const wrappingLabel = switchButton(wrapping.container)?.textContent;
  const scrollingLabel = switchButton(scrolling.container)?.textContent;

  assert.ok(wrappingLabel, 'expected a label while wrapping');
  assert.ok(scrollingLabel, 'expected a label while scrolling');
  assert.notEqual(wrappingLabel, scrollingLabel);
});

test('the chosen state reaches the diff lines the switch claims to control', () => {
  // The switch is only worth rendering if it actually reaches a line. Both
  // branches are pinned by exact class tokens, because `whitespace-pre` is a
  // substring of `whitespace-pre-wrap` and a `includes()` check would accept
  // the wrapping branch as the scrolling one.
  const wrapping = renderItem({ isMobile: true, wrapText: true });
  const scrolling = renderItem({ isMobile: true, wrapText: false });

  const wrappedLine = diffLine(wrapping.container);
  const scrolledLine = diffLine(scrolling.container);
  assert.ok(wrappedLine, 'expected the wrapping diff line');
  assert.ok(scrolledLine, 'expected the scrolling diff line');

  assert.ok(hasToken(wrappedLine, 'whitespace-pre-wrap'), wrappedLine.className);
  assert.ok(hasToken(wrappedLine, 'break-all'), wrappedLine.className);
  assert.ok(!hasToken(wrappedLine, 'overflow-x-auto'), wrappedLine.className);

  assert.ok(hasToken(scrolledLine, 'whitespace-pre'), scrolledLine.className);
  assert.ok(hasToken(scrolledLine, 'overflow-x-auto'), scrolledLine.className);
  assert.ok(!hasToken(scrolledLine, 'whitespace-pre-wrap'), scrolledLine.className);
});
