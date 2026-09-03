import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useQuickSettingsDrag } from '@/modules/quick-settings-panel/hooks/useQuickSettingsDrag';

type PointerTarget = {
  setPointerCapture: ReturnType<typeof vi.fn>;
  hasPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
};

function createPointerTarget(): PointerTarget {
  return {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  };
}

function createPointerEvent({
  target,
  type,
  clientY,
}: {
  target: PointerTarget;
  type: string;
  clientY: number;
}): ReactPointerEvent<HTMLButtonElement> {
  return {
    type,
    pointerId: 7,
    pointerType: 'touch',
    button: 0,
    clientY,
    currentTarget: target,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as ReactPointerEvent<HTMLButtonElement>;
}

describe('useQuickSettingsDrag', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = 'text';
  });

  it('captures one pointer through drag completion and suppresses only its release click', () => {
    const target = createPointerTarget();
    const view = renderHook(() => useQuickSettingsDrag({ isMobile: false }));

    act(() => {
      view.result.current.startDrag(createPointerEvent({ target, type: 'pointerdown', clientY: 500 }));
      view.result.current.handlePointerMove(createPointerEvent({ target, type: 'pointermove', clientY: 600 }));
    });

    expect(target.setPointerCapture).toHaveBeenCalledWith(7);
    expect(view.result.current.isDragging).toBe(true);
    expect(view.result.current.handleStyle).toMatchObject({ top: '60%' });
    expect(document.body.style.cursor).toBe('grabbing');

    act(() => {
      view.result.current.endDrag(createPointerEvent({ target, type: 'pointerup', clientY: 600 }));
    });

    expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(view.result.current.isDragging).toBe(false);
    expect(document.body.style.cursor).toBe('crosshair');
    expect(document.body.style.userSelect).toBe('text');
    expect(view.result.current.consumeSuppressedClick()).toBe(true);
    expect(view.result.current.consumeSuppressedClick()).toBe(false);
  });
});
