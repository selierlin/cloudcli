import assert from 'node:assert/strict';

import { render, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { ProviderQuota } from '@/shared/types';

/**
 * The panel's job is deciding when a provider has quota to show at all, so the
 * assertions below count rendered rows rather than translated copy: the fake
 * `t` returns keys, which keeps them independent of the locale files. It also
 * echoes the interpolation values, which is what lets the remaining-quota
 * arithmetic be asserted without a real translation.
 */

const quotaResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: { providers: { quota: () => quotaResponse() } },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: 'en' },
  }),
}));

const buildQuota = (): ProviderQuota => ({
  provider: 'codex',
  windows: [
    { usedPercent: 6, windowMinutes: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
    { usedPercent: 31, windowMinutes: 10080, resetsAt: Math.floor(Date.now() / 1000) + 259_200 },
  ],
  planType: 'plus',
  credits: null,
  creditsUsed: null,
  creditsTotal: null,
  isPaidAccount: null,
  fetchedAt: Date.now(),
});

/** Resolves the quota request with one provider answer, successful or not. */
function respondWith(quota: ProviderQuota | null) {
  quotaResponse.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { quota } }),
  });
}

async function renderPanel(agent: 'codex' | 'claude' | 'workbuddy') {
  const { default: ProviderQuotaSection } = await import(
    '@/modules/settings/tabs/agents-settings/sections/content/ProviderQuotaSection'
  );
  return render(<ProviderQuotaSection agent={agent} />);
}

beforeEach(() => {
  quotaResponse.mockReset();
});

test('shows one row per reported window', async () => {
  respondWith(buildQuota());

  const { container } = await renderPanel('codex');

  await waitFor(() => {
    assert.match(container.textContent ?? '', /agents\.quota\.window/);
  });
  assert.match(container.textContent ?? '', /agents\.quota\.title/);
  assert.equal((container.textContent ?? '').match(/agents\.quota\.remaining/g)?.length, 2);
  assert.equal((container.textContent ?? '').match(/agents\.quota\.resetsAt/g)?.length, 2);
  assert.equal((container.textContent ?? '').match(/agents\.quota\.resetsIn/g)?.length, 2);
  assert.match(container.textContent ?? '', /plus/);
});

/**
 * The provider only reports consumption, so the panel has to invert it. The two
 * windows here are deliberately different (6% and 31% used) to catch a bar that
 * renders the wrong end of the range.
 */
test('reports headroom as the complement of the reported consumption', async () => {
  respondWith(buildQuota());

  const { container } = await renderPanel('codex');

  await waitFor(() => {
    assert.match(container.textContent ?? '', /agents\.quota\.remaining/);
  });
  const text = container.textContent ?? '';
  assert.match(text, /"percent":94/);
  assert.match(text, /"percent":69/);
  assert.doesNotMatch(text, /"percent":6[^0-9]/);
});

/** A reset moment has to be a real formatted timestamp, not a raw epoch value. */
test('renders the next reset as a formatted clock time', async () => {
  respondWith(buildQuota());

  const { container } = await renderPanel('codex');

  await waitFor(() => {
    assert.match(container.textContent ?? '', /agents\.quota\.resetsAt/);
  });
  assert.match(container.textContent ?? '', /agents\.quota\.resetsAt:\{"time":"[^"]+"\}/);
  assert.doesNotMatch(container.textContent ?? '', /agents\.quota\.resetsAt:\{"time":"\}/);
});

test('renders nothing when the provider reports no quota', async () => {
  respondWith(null);

  const { container } = await renderPanel('claude');

  await waitFor(() => {
    assert.equal(quotaResponse.mock.calls.length, 1);
  });
  assert.equal(container.textContent, '');
});

test('renders nothing when the reported snapshot has no windows', async () => {
  respondWith({ ...buildQuota(), windows: [] });

  const { container } = await renderPanel('codex');

  await waitFor(() => {
    assert.equal(quotaResponse.mock.calls.length, 1);
  });
  assert.equal(container.textContent, '');
});

/**
 * WorkBuddy bills against prepaid credits and reports no rolling window, so a
 * panel that waited for a window row would hide the only number it has.
 */
test('renders a credits-only snapshot without any window rows', async () => {
  respondWith({
    ...buildQuota(),
    provider: 'workbuddy',
    windows: [],
    planType: null,
    credits: '5699.93',
  });

  const { container } = await renderPanel('workbuddy');

  await waitFor(() => {
    assert.match(container.textContent ?? '', /agents\.quota\.credits/);
  });
  const text = container.textContent ?? '';
  assert.match(text, /"balance":"5699\.93"/);
  assert.match(text, /agents\.quota\.title/);
  assert.equal(text.match(/agents\.quota\.window/g), null);
});

/**
 * A balance on its own cannot tell the reader how much of the budget is already
 * gone; the consumed figure is what turns it into a burn rate.
 */
test('renders the consumed and total credits beneath the balance', async () => {
  respondWith({
    ...buildQuota(),
    provider: 'workbuddy',
    windows: [],
    planType: null,
    credits: '5699.93',
    creditsUsed: '7912.07',
    creditsTotal: '13612.00',
    isPaidAccount: true,
  });

  const { container } = await renderPanel('workbuddy');

  await waitFor(() => {
    assert.match(container.textContent ?? '', /agents\.quota\.creditsUsage/);
  });
  const text = container.textContent ?? '';
  assert.match(text, /"used":"7912\.07"/);
  assert.match(text, /"total":"13612\.00"/);
});

/**
 * A provider that reports only the balance must not leave the panel promising a
 * total it never sent, so the breakdown line stays away entirely.
 */
test('omits the breakdown when the provider reports no total', async () => {
  respondWith({
    ...buildQuota(),
    provider: 'workbuddy',
    windows: [],
    planType: null,
    credits: '5699.93',
  });

  const { container } = await renderPanel('workbuddy');

  await waitFor(() => {
    assert.match(container.textContent ?? '', /agents\.quota\.credits/);
  });
  assert.doesNotMatch(container.textContent ?? '', /agents\.quota\.creditsUsage/);
});

/** Providers that flag paid capacity instead of naming a plan still get a tier label. */
test('falls back to the paid flag when the provider names no plan', async () => {
  respondWith({
    ...buildQuota(),
    provider: 'workbuddy',
    windows: [],
    planType: null,
    credits: '10.00',
    isPaidAccount: true,
  });

  const { container } = await renderPanel('workbuddy');

  await waitFor(() => {
    assert.match(container.textContent ?? '', /agents\.quota\.plan\.paid/);
  });
  assert.doesNotMatch(container.textContent ?? '', /agents\.quota\.plan\.free/);
});

/**
 * A named plan is the provider's own wording and is shown as sent, so the flag
 * must not override it.
 */
test('keeps the provider plan name over the paid flag', async () => {
  respondWith({ ...buildQuota(), isPaidAccount: true });

  const { container } = await renderPanel('codex');

  await waitFor(() => {
    assert.match(container.textContent ?? '', /plus/);
  });
  assert.doesNotMatch(container.textContent ?? '', /agents\.quota\.plan\./);
});
