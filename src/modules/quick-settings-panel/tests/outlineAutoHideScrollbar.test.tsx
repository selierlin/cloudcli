import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test, vi } from 'vitest';

import QuickSettingsOutline from '@/modules/quick-settings-panel/QuickSettingsOutline';
import type { SessionOutlineItem } from '@/shared/types';

/**
 * The outline tab is the reason `useAutoHideScrollbar` hands back a ref
 * callback instead of reading a ref object: while the outline loads (and while
 * a session has no messages) this component returns before rendering the
 * scroll container, so the node arrives in a later commit than the hook's
 * first run. If the wiring slipped back to an effect keyed on a ref object,
 * the attribute below would never appear and the bar would stay on screen.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ITEMS: SessionOutlineItem[] = [
  { timestamp: '2026-03-01T10:00:00.000Z', snippet: 'why does the bar stay visible' },
  { timestamp: '2026-03-01T10:05:00.000Z', snippet: 'and after a reload' },
];

const scrollerOf = (container: HTMLElement) => {
  const scroller = container.querySelector<HTMLElement>('[class*="overflow-y-auto"]');
  assert.ok(scroller, 'the outline renders a scroll container once it has rows');
  return scroller;
};

test('the bar is hidden on the container that mounts after loading', () => {
  const { container, rerender } = render(
    <QuickSettingsOutline items={[]} isLoading onJumpToMessage={() => undefined} />,
  );
  assert.equal(container.querySelector('[class*="overflow-y-auto"]'), null);

  rerender(<QuickSettingsOutline items={ITEMS} isLoading={false} onJumpToMessage={() => undefined} />);

  assert.ok(scrollerOf(container).hasAttribute('data-scrollbar-idle'));
});

test('the bar is hidden when the rows are already there on mount', () => {
  const { container } = render(
    <QuickSettingsOutline items={ITEMS} isLoading={false} onJumpToMessage={() => undefined} />,
  );

  assert.ok(scrollerOf(container).hasAttribute('data-scrollbar-idle'));
});

test('an empty outline has nowhere to scroll, so no bar is claimed', () => {
  const { container } = render(
    <QuickSettingsOutline items={[]} isLoading={false} onJumpToMessage={() => undefined} />,
  );

  assert.equal(container.querySelector('[class*="overflow-y-auto"]'), null);
});
