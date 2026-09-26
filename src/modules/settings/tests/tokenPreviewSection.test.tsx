import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import TokenPreviewSection from '@/modules/settings/TokenPreviewSection';

/**
 * The settings page's token preview section.
 *
 * What is this section's own behaviour, as opposed to the snapshot's (which has
 * its own file)? That the read is a snapshot taken by a click — never during
 * render, since the read flips the `.dark` class — and that opening again
 * re-reads rather than replaying the last one. The snapshot module is mocked
 * with a spy so the tests can also see *when* it ran.
 */

const readTokenSnapshot = vi.fn();

vi.mock('@/shared/tokenSnapshot', () => ({
  readTokenSnapshot: (...args: unknown[]) => readTokenSnapshot(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      options ? `${key}:${JSON.stringify(options)}` : key
    ),
    i18n: { language: 'en' },
  }),
}));

const SNAPSHOT = {
  groups: [
    {
      id: 'semantic',
      entries: [
        {
          name: '--background',
          light: '10 20% 30%',
          dark: '210 45% 8%',
          lightSwatch: 'hsl(10 20% 30%)',
          darkSwatch: 'hsl(210 45% 8%)',
        },
        {
          name: '--font-ui',
          light: 'ui-sans-serif, system-ui',
          dark: 'ui-sans-serif, system-ui',
          lightSwatch: null,
          darkSwatch: null,
        },
      ],
    },
    {
      id: 'palette',
      entries: [
        {
          name: '--palette-brand-500',
          light: '221.2 83.2% 53.3%',
          dark: '217.2 91.2% 59.8%',
          lightSwatch: 'hsl(221.2 83.2% 53.3%)',
          darkSwatch: 'hsl(217.2 91.2% 59.8%)',
        },
      ],
    },
  ],
  tokenCount: 3,
};

beforeEach(() => {
  readTokenSnapshot.mockReset();
  readTokenSnapshot.mockImplementation(() => SNAPSHOT);
});

afterEach(() => {
  vi.clearAllMocks();
});

test('closed, the section is one disclosure and the document is not read', () => {
  const { container, getByText } = render(<TokenPreviewSection />);

  assert.equal(container.textContent?.includes('--background'), false);
  assert.equal(readTokenSnapshot.mock.calls.length, 0, 'rendering the section must not read the document');
  assert.equal(getByText('tokenPreview.open').getAttribute('aria-expanded'), 'false');
});

test('opening takes a snapshot and shows both columns; closing takes the rows away', () => {
  const { container, getByText } = render(<TokenPreviewSection />);

  fireEvent.click(getByText('tokenPreview.open'));
  assert.equal(readTokenSnapshot.mock.calls.length, 1);
  assert.equal(getByText('tokenPreview.close').getAttribute('aria-expanded'), 'true');

  const light = container.querySelector('[data-appearance-column="light"]')?.textContent ?? '';
  const dark = container.querySelector('[data-appearance-column="dark"]')?.textContent ?? '';
  assert.ok(light.includes('10 20% 30%'), 'the light column wears the light value');
  assert.ok(dark.includes('210 45% 8%'), 'the dark column wears the dark value');

  const backgroundSwatches = container.querySelectorAll('[data-token-swatch="--background"]');
  assert.equal(backgroundSwatches.length, 2, 'one swatch per appearance');
  // jsdom parses the inline `hsl(...)` into its own serialization, so the pin
  // here is "a colour got through, and the two columns differ"; the exact
  // classification is the snapshot module's test to hold.
  const lightSwatch = (backgroundSwatches[0] as HTMLElement).style.background;
  const darkSwatch = (backgroundSwatches[1] as HTMLElement).style.background;
  assert.notEqual(lightSwatch, '', 'the light swatch wears a colour');
  assert.notEqual(darkSwatch, '', 'the dark swatch wears a colour');
  assert.notEqual(lightSwatch, darkSwatch, 'the two appearances resolve differently');

  fireEvent.click(getByText('tokenPreview.close'));
  assert.equal(container.textContent?.includes('--background'), false, 'closing takes the rows away');
  assert.equal(readTokenSnapshot.mock.calls.length, 1, 'closing does not read again');
});

test('opening again re-reads instead of replaying the last snapshot', () => {
  const { getByText } = render(<TokenPreviewSection />);

  fireEvent.click(getByText('tokenPreview.open'));
  fireEvent.click(getByText('tokenPreview.close'));
  readTokenSnapshot.mockImplementation(() => ({ groups: [], tokenCount: 0 }));
  fireEvent.click(getByText('tokenPreview.open'));

  assert.equal(readTokenSnapshot.mock.calls.length, 2, 'the second open asked the document again');
  assert.equal(getByText('tokenPreview.close').getAttribute('aria-expanded'), 'true');
});

test('a non-colour value renders the row without a swatch style', () => {
  const { container, getByText } = render(<TokenPreviewSection />);
  fireEvent.click(getByText('tokenPreview.open'));

  const fontSwatches = container.querySelectorAll('[data-token-swatch="--font-ui"]');
  assert.equal(fontSwatches.length, 2);
  assert.equal((fontSwatches[0] as HTMLElement).style.background, '', 'no colour, no inline background');
});
