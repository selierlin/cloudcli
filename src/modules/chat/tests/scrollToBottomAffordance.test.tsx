import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ScrollToBottomAffordance from '@/modules/chat/ScrollToBottomAffordance';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

type AffordanceParts = {
  button: HTMLElement;
  grid: HTMLElement;
  arrow: SVGElement;
  dotRow: HTMLElement;
  dots: HTMLElement[];
  onScrollToBottom: ReturnType<typeof vi.fn>;
};

/**
 * `getAttribute('class')` rather than `.className`, which is an SVGAnimatedString
 * on the arrow. Tokens instead of `toContain` so `opacity-100` can never satisfy
 * an `opacity-0` assertion by substring.
 */
function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/);
}

/**
 * The button holds one grid cell with both glyphs stacked in it so they can
 * cross-fade in place — the swap is opacity, not mounting, so "which glyph is
 * showing" is only expressible as a class name. Every assertion about that lives
 * behind this helper, so a restyle changes one spot rather than each case.
 */
function expectGlyphState(parts: AffordanceParts, expected: 'thinking' | 'idle'): void {
  const arrowShown = expected === 'idle';
  expect(classTokens(parts.arrow)).toContain(arrowShown ? 'opacity-100' : 'opacity-0');
  expect(classTokens(parts.dotRow)).toContain(arrowShown ? 'opacity-0' : 'opacity-100');
}

function renderAffordance(isThinking: boolean): AffordanceParts {
  const onScrollToBottom = vi.fn();
  const { container } = render(
    <ScrollToBottomAffordance isThinking={isThinking} onScrollToBottom={onScrollToBottom} />,
  );

  // Scoped to this render's container so cases that render twice do not collide.
  // Doubles as the "accessible name never changes" assertion: the lookup fails
  // if the button stops being findable by the action label.
  const button = within(container).getByRole('button', { name: 'input.scrollToBottom' });
  const grid = button.firstElementChild as HTMLElement;
  const arrow = grid.children[0] as SVGElement;
  const dotRow = grid.children[1] as HTMLElement;

  return {
    button,
    grid,
    arrow,
    dotRow,
    dots: Array.from(dotRow.children) as HTMLElement[],
    onScrollToBottom,
  };
}

describe('ScrollToBottomAffordance', () => {
  it('shows the arrow and no dots while the turn is idle', () => {
    const parts = renderAffordance(false);

    expect(parts.button.dataset.state).toBe('idle');
    expectGlyphState(parts, 'idle');
  });

  it('shows the dots and no arrow while the turn is thinking', () => {
    const parts = renderAffordance(true);

    expect(parts.button.dataset.state).toBe('thinking');
    expectGlyphState(parts, 'thinking');
  });

  it('staggers three dots in both states', () => {
    for (const isThinking of [true, false]) {
      const parts = renderAffordance(isThinking);

      expect(parts.dots).toHaveLength(3);
      expect(parts.dots.map((dot) => dot.style.animationDelay)).toEqual(['0ms', '150ms', '300ms']);
    }
  });

  it('only carries the bounce animation while thinking', () => {
    const idle = renderAffordance(false);
    for (const dot of idle.dots) {
      expect(classTokens(dot)).not.toContain('animate-dot-bounce');
    }

    const thinking = renderAffordance(true);
    for (const dot of thinking.dots) {
      expect(classTokens(dot)).toContain('animate-dot-bounce');
    }
  });

  it('keeps both glyphs out of the accessibility tree', () => {
    for (const isThinking of [true, false]) {
      const parts = renderAffordance(isThinking);

      expect(parts.grid.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('keeps its footprint identical across states', () => {
    for (const isThinking of [true, false]) {
      const parts = renderAffordance(isThinking);

      expect(classTokens(parts.button)).toContain('h-8');
      expect(classTokens(parts.button)).toContain('w-8');
    }
  });

  it('reports the scroll request exactly once per click', () => {
    const parts = renderAffordance(true);

    fireEvent.click(parts.button);

    expect(parts.onScrollToBottom).toHaveBeenCalledTimes(1);
  });
});
