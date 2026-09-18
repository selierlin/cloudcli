import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';

/**
 * The anchor is where every composer popover lands, how wide it gets and how
 * tall it may grow. Pinning to the right edge is what the right-hand tool
 * cluster (schedule, model, permissions) needs, and it has to keep working
 * exactly as before. The quick reply button is the one trigger in the left-hand
 * cluster, where a phone leaves less than the preferred width on both sides of
 * it: the menu used to be pinned right anyway and ran off the left edge, and
 * hugging the trigger afterwards still capped it at 228px of a 390px screen.
 * These tests cover the resulting rules — right when it fits, its mirror left
 * when only that fits, and the inset-from-both-edges sheet when neither does,
 * including the share of the screen that sheet may cover.
 */

const VIEWPORT_MARGIN = 8;
const SHEET_MARGIN = 16;
const SHEET_MAX_HEIGHT_RATIO = 0.54;
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;
/** Narrowest phone the composer is used on. */
const NARROW_WIDTH = 320;
const DESKTOP_WIDTH = 1440;

type TriggerRect = { left: number; right: number; top: number };

type Placement = {
  side: 'left' | 'right' | 'both';
  maxWidth: number;
  maxHeight: number;
  left: number;
  right: number;
};

/**
 * Must stay one stable function: the hook's listener effect depends on
 * `onClose`'s identity, so a fresh arrow per render re-runs the effect, which
 * stores a new anchor object, which re-renders — an endless render loop.
 */
const close = () => undefined;

/**
 * Renders the hook with the trigger stubbed at `rect` and returns the box that
 * anchor places, in viewport coordinates, so assertions read as geometry.
 */
const placementFor = ({
  rect,
  viewportWidth = PHONE_WIDTH,
  viewportHeight = PHONE_HEIGHT,
  preferredWidth,
}: {
  rect: TriggerRect;
  viewportWidth?: number;
  viewportHeight?: number;
  preferredWidth?: number;
}): Placement => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewportHeight });

  const { result } = renderHook(() => useComposerMenuAnchor(true, close, preferredWidth));
  const trigger = document.createElement('button');
  trigger.getBoundingClientRect = () => rect as DOMRect;
  (result.current.triggerRef as { current: HTMLButtonElement | null }).current = trigger;

  act(() => {
    result.current.updateAnchor();
  });

  const anchor = result.current.anchor;
  assert.ok(anchor, 'a stubbed trigger rect must produce an anchor');

  if (anchor.side === 'both') {
    return {
      side: anchor.side,
      maxWidth: anchor.maxWidth,
      maxHeight: anchor.maxHeight,
      left: anchor.offset,
      right: viewportWidth - anchor.offset,
    };
  }

  return anchor.side === 'left'
    ? {
        side: anchor.side,
        maxWidth: anchor.maxWidth,
        maxHeight: anchor.maxHeight,
        left: anchor.offset,
        right: anchor.offset + anchor.maxWidth,
      }
    : {
        side: anchor.side,
        maxWidth: anchor.maxWidth,
        maxHeight: anchor.maxHeight,
        left: viewportWidth - anchor.offset - anchor.maxWidth,
        right: viewportWidth - anchor.offset,
      };
};

test('a trigger with room on its left keeps the menu pinned to the right edge', () => {
  // Where the model menu's button sits on a 390px phone, next to the send button.
  const placement = placementFor({ rect: { left: 250, right: 370, top: 700 } });

  assert.equal(placement.side, 'right');
  assert.deepEqual(
    { left: placement.left, right: placement.right, maxWidth: placement.maxWidth },
    { left: 50, right: 370, maxWidth: 320 },
    'the same box the right-pinned math produced before, so this menu is unchanged',
  );
  assert.equal(
    placement.maxHeight,
    700 - VIEWPORT_MARGIN * 2,
    'and the same height: only the sheet takes a share of the screen',
  );
});

test('a right-hand menu asking for a wider preferred width still fits', () => {
  // The permission menu asks for 352 rather than the default 320.
  const placement = placementFor({ rect: { left: 250, right: 370, top: 700 }, preferredWidth: 352 });

  assert.equal(placement.side, 'right');
  assert.deepEqual(
    { left: placement.left, right: placement.right, maxWidth: placement.maxWidth },
    { left: 18, right: 370, maxWidth: 352 },
  );
});

test('the left cluster on a desktop keeps hugging the trigger', () => {
  // A desktop window leaves the same button room to its right, so the menu must
  // not be stretched across the window there.
  const placement = placementFor({
    rect: { left: 154, right: 186, top: 700 },
    viewportWidth: DESKTOP_WIDTH,
  });

  assert.equal(placement.side, 'left');
  assert.deepEqual(
    { left: placement.left, right: placement.right, maxWidth: placement.maxWidth },
    { left: 154, right: 474, maxWidth: 320 },
  );
});

test('the quick reply trigger on a phone stretches to both viewport margins', () => {
  // The five-button left cluster — attach, voice, usage, slash, quick reply —
  // ends at x=186, which leaves 178px to its left and 228px to its right: too
  // little for the preferred width on either side.
  const rect = { left: 154, right: 186, top: 700 };
  const placement = placementFor({ rect });

  assert.equal(placement.side, 'both');
  assert.deepEqual(
    { left: placement.left, right: placement.right, maxWidth: placement.maxWidth },
    {
      left: SHEET_MARGIN,
      right: PHONE_WIDTH - SHEET_MARGIN,
      maxWidth: PHONE_WIDTH - SHEET_MARGIN * 2,
    },
    'the same inset-from-both-edges sheet the slash-command menu opens on a phone',
  );
  assert.ok(
    placement.maxWidth > rect.right - VIEWPORT_MARGIN,
    'the width is the point: hugging the trigger capped this at 228px of a 390px screen',
  );
});

test('the phone sheet takes a share of the screen rather than every pixel above the composer', () => {
  // Fifteen shipped snippets in one list: uncapped, the sheet would run from the
  // top of the screen down to the composer and hide the conversation.
  const placement = placementFor({ rect: { left: 154, right: 186, top: 700 } });

  assert.equal(placement.maxHeight, PHONE_HEIGHT * SHEET_MAX_HEIGHT_RATIO);
  assert.ok(
    placement.maxHeight < 700 - VIEWPORT_MARGIN,
    'the space above the trigger is taller than the cap, so the cap is what shows',
  );
});

test('a phone too narrow for the preferred width still spans margin to margin', () => {
  const placement = placementFor({
    rect: { left: 144, right: 176, top: 700 },
    viewportWidth: NARROW_WIDTH,
  });

  assert.equal(placement.side, 'both');
  assert.deepEqual(
    { left: placement.left, right: placement.right, maxWidth: placement.maxWidth },
    {
      left: SHEET_MARGIN,
      right: NARROW_WIDTH - SHEET_MARGIN,
      maxWidth: NARROW_WIDTH - SHEET_MARGIN * 2,
    },
    'both edges stay inset, so the menu cannot run off either one',
  );
});
