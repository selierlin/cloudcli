import { expect, test } from 'vitest';

import {
  SIDE_ASK_DOCKED_MIN_WIDTH,
  SIDE_ASK_OVERLAY_MIN_WIDTH,
  resolveSideAskPlacement,
} from '@/modules/chat/hooks/useSideAskPlacement';

/**
 * The drawer's layout is chosen from the chat column's measured width, not the
 * viewport's, so these boundaries are the whole contract: a 900px column keeps
 * a 480px transcript beside the 420px dock, and below 640px an overlay would
 * cover every pixel of the column.
 */

test('a wide column docks the drawer beside the transcript', () => {
  expect(resolveSideAskPlacement(SIDE_ASK_DOCKED_MIN_WIDTH)).toBe('docked');
  expect(resolveSideAskPlacement(1440)).toBe('docked');
});

test('a column too narrow to split floats the drawer over the transcript', () => {
  expect(resolveSideAskPlacement(SIDE_ASK_DOCKED_MIN_WIDTH - 1)).toBe('overlay');
  expect(resolveSideAskPlacement(SIDE_ASK_OVERLAY_MIN_WIDTH)).toBe('overlay');
});

test('a column narrower than the drawer itself becomes a full-width sheet', () => {
  expect(resolveSideAskPlacement(SIDE_ASK_OVERLAY_MIN_WIDTH - 1)).toBe('sheet');
  // What the first render measures before the host has any width.
  expect(resolveSideAskPlacement(0)).toBe('sheet');
});
