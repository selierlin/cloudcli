import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { LLMProvider } from '@/shared/types';
import { LLMProviderLogo } from '@/shared/ui';

/**
 * Enumerated here rather than sourced from the component so the sweep below can
 * visit every provider. `satisfies` alone would not notice a provider added to
 * the union afterwards, so the compile-time check that follows is the real net:
 * growing `LLMProvider` without growing this list fails typecheck instead of
 * silently shrinking the guard's coverage.
 */
const PROVIDER_IDS = [
  'claude',
  'cursor',
  'codex',
  'opencode',
  'dsh',
  'workbuddy',
  'pi',
  'zcode',
  'omp',
  'openclaw',
] as const satisfies readonly LLMProvider[];

type UncoveredProvider = Exclude<LLMProvider, (typeof PROVIDER_IDS)[number]>;
// Tuples keep the conditional from distributing over a union (and from
// collapsing to `never` when the remainder is empty).
const allProvidersCovered: [UncoveredProvider] extends [never] ? true : UncoveredProvider = true;

const render = (provider: LLMProvider) =>
  renderToStaticMarkup(React.createElement(LLMProviderLogo, { provider, className: 'w-5 h-5' }));

/**
 * An exported transcript is one file opened from disk, so a logo that resolves
 * over HTTP comes out blank there — which is how the ZCode and WorkBuddy
 * avatars vanished from the HTML export while every other provider (inline SVG)
 * survived. Each logo must therefore carry its own pixels.
 */
describe('provider logos are self-contained', () => {
  it('visits every provider in the union', () => {
    expect(allProvidersCovered).toBe(true);
  });

  it.each([...PROVIDER_IDS])('renders %s without a network reference', (provider) => {
    const markup = render(provider);

    expect(markup).not.toMatch(/src="\//);
    expect(markup).not.toMatch(/src="https?:/);
  });

  it('carries the ZCode raster as a data URL', () => {
    const markup = render('zcode');

    expect(markup).toContain('src="data:image/png;base64,');
    expect(markup).not.toContain('/zcode.png');
  });

  it('carries the WorkBuddy mark as a data URL too', () => {
    const markup = render('workbuddy');

    // Deliberately an `<img>` and not an inline `<svg>`: sidebar rows wear
    // `buttonVariants`, whose `[&_svg]:size-4` overrides the caller's `h-5 w-5`
    // and shrinks the avatar. A replaced element is immune to that rule.
    expect(markup).toContain('src="data:image/svg+xml;base64,');
    expect(markup).toContain('alt="WorkBuddy"');
    expect(markup).not.toContain('/workbuddy.svg');
  });
});
