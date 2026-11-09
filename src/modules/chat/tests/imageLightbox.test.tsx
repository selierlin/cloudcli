import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { ImageLightbox } from '@/modules/chat/transcript/ChatMessageImages';

// jsdom ships no PointerEvent, so testing-library would collapse every pointer
// into a plain Event without pointerId/pointerType and multi-touch could not be
// simulated at all.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;

    constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, writable: true });
}

/**
 * The lightbox is self-contained and talks to the browser through pointer and
 * wheel events, so these tests exercise the gesture semantics rather than the
 * visual result: tap-to-close at fit, tap-to-reset while zoomed, pinch and
 * wheel zoom.
 */

function renderLightbox(onClose = vi.fn()) {
  const result = render(<ImageLightbox src="blob:image" alt="attachment" onClose={onClose} />);
  const image = screen.getByRole('img', { name: 'attachment' }) as HTMLImageElement;
  return { ...result, image, onClose };
}

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', id: number, x: number, y: number) {
  return {
    pointerId: id,
    pointerType: 'touch' as const,
    clientX: x,
    clientY: y,
    button: type === 'pointermove' ? -1 : 0,
  };
}

function scaleOf(image: HTMLImageElement): number {
  const match = /scale\(([\d.]+)\)/.exec(image.style.transform);
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

describe('ImageLightbox gestures', () => {
  test('a touch tap on the image closes it at fit', () => {
    const { image, onClose } = renderLightbox();

    fireEvent.pointerDown(image, pointer('pointerdown', 1, 100, 100));
    fireEvent.pointerUp(image, pointer('pointerup', 1, 100, 100));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('a touch tap on the backdrop closes it', () => {
    const { onClose } = renderLightbox();

    fireEvent.click(screen.getByRole('dialog'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('pinching apart zooms in, and a tap then resets instead of closing', () => {
    const { image, onClose } = renderLightbox();

    fireEvent.pointerDown(image, pointer('pointerdown', 1, 100, 100));
    fireEvent.pointerDown(image, pointer('pointerdown', 2, 200, 100));
    fireEvent.pointerMove(image, pointer('pointermove', 2, 300, 100));

    expect(scaleOf(image)).toBeGreaterThan(1);

    fireEvent.pointerUp(image, pointer('pointerup', 1, 100, 100));
    fireEvent.pointerUp(image, pointer('pointerup', 2, 300, 100));

    expect(scaleOf(image)).toBeGreaterThan(1);

    fireEvent.pointerDown(image, pointer('pointerdown', 3, 150, 150));
    fireEvent.pointerUp(image, pointer('pointerup', 3, 150, 150));

    expect(scaleOf(image)).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('the wheel zooms in', () => {
    const { image } = renderLightbox();

    fireEvent.wheel(image, { deltaY: -200, clientX: 500, clientY: 400 });

    expect(scaleOf(image)).toBeGreaterThan(1);
  });

  test('a drag at fit does not close on release', () => {
    const { image, onClose } = renderLightbox();

    fireEvent.pointerDown(image, pointer('pointerdown', 1, 100, 100));
    fireEvent.pointerMove(image, pointer('pointermove', 1, 140, 100));
    fireEvent.pointerUp(image, pointer('pointerup', 1, 140, 100));

    expect(onClose).not.toHaveBeenCalled();
  });
});
