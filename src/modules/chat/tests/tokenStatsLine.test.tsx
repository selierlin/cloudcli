import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { describe, it, vi } from 'vitest';

import TokenStatsLine from '@/modules/chat/composer/TokenStatsLine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { percent?: string }) => {
      if (key === 'chat:misc.cacheHitRate') return `${options?.percent}% cached`;
      if (key === 'chat:misc.tokensLabel') return 'tokens';
      return key;
    },
  }),
}));

const renderLine = (
  usage: Record<string, unknown> | null,
  provider: 'claude' | 'workbuddy' | 'opencode' | 'omp' | 'codex' = 'claude',
  onShowDetails = () => {},
) => {
  const { container, unmount } = render(
    <TokenStatsLine usage={usage} provider={provider} onShowDetails={onShowDetails} />,
  );
  return { text: container.textContent ?? '', container, unmount };
};

describe('TokenStatsLine', () => {
  it('renders nothing until a provider reports usage', () => {
    assert.equal(renderLine(null).text, '');
    assert.equal(renderLine({ total: 200_000 }).text, '');
  });

  it('carries a count that rounds up into the next unit', () => {
    for (const [used, shown] of [
      [9_949, '9.9K'],
      [9_960, '10K'],
      [376_000, '376K'],
      [999_499, '999K'],
      [999_600, '1.0M'],
      [9_960_000, '10M'],
    ] as const) {
      const { text, unmount } = renderLine({ used });
      assert.equal(text, `${shown} tokens`);
      unmount();
    }
  });

  it('pairs the used count with the window it is measured against', () => {
    assert.match(renderLine({ used: 4_183, total: 200_000 }).text, /^4\.2K \/ 200K tokens·2%$/);
  });

  it('reads Claude cache reads against an already inclusive input count', () => {
    // 950 / 1,000, not 950 / 1,950: buildTokenBudget folds cache into inputTokens.
    const { text } = renderLine({
      used: 1_200,
      total: 200_000,
      inputTokens: 1_000,
      outputTokens: 200,
      cacheReadTokens: 950,
      cacheTokens: 950,
    });
    assert.match(text, /95% cached/);
  });

  it('reads WorkBuddy cache reads against an inclusive input count', () => {
    // 80 / 100: the engine's `input_tokens` already counts the cache read, and
    // its `breakdown.input` says so. Adding the bucket again would report 44%.
    const { text } = renderLine(
      {
        used: 120,
        total: 200_000,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 80,
        cacheTokens: 80,
        breakdown: { input: 100, output: 20 },
      },
      'workbuddy',
    );
    assert.match(text, /80% cached/);
  });

  it('reads a miss-only input count against the prompt including the cache', () => {
    // 80 / 180: Pi/OpenClaw/OMP report `input` without the cache and normalize
    // the whole prompt in `breakdown.input`.
    const { text } = renderLine(
      {
        used: 120,
        total: 200_000,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 80,
        cacheTokens: 80,
        breakdown: { input: 180, output: 20 },
      },
      'omp',
    );
    assert.match(text, /44% cached/);
  });

  it('does not read Codex session totals against the context window', () => {
    // Codex's `used` is the session's running total, so "1.2M / 200K" and a
    // permanent 100% would both be fiction; the count stands alone.
    const { text } = renderLine({ used: 1_200_000, total: 200_000, inputTokens: 900_000 }, 'codex');
    assert.equal(text, '1.2M tokens');
  });

  it('keeps a decimal instead of claiming a full hit', () => {
    const { text } = renderLine({
      used: 1_000,
      inputTokens: 1_001,
      cacheReadTokens: 1_000,
      cacheTokens: 1_000,
    });
    assert.match(text, /99\.9% cached/);
  });

  it('shows the decimal only once the integer rounding would reach a full hit', () => {
    assert.match(
      renderLine({ used: 1_000, inputTokens: 1_000, cacheReadTokens: 996, cacheTokens: 1_000 })
        .text,
      /99\.6% cached/,
    );
    assert.match(
      renderLine({ used: 1_000, inputTokens: 1_004, cacheReadTokens: 996, cacheTokens: 1_004 })
        .text,
      /99% cached/,
    );
  });

  it('reports a genuine full hit as 100', () => {
    const { text } = renderLine({
      used: 1_000,
      inputTokens: 1_000,
      cacheReadTokens: 1_000,
      cacheTokens: 1_000,
    });
    assert.match(text, /100% cached/);
  });

  it('says nothing about caching when the provider reports no cache bucket', () => {
    // OpenCode's payload carries input/output only; a 0% hit would be a claim.
    assert.doesNotMatch(
      renderLine({ used: 5_000, total: 200_000, inputTokens: 4_000, outputTokens: 1_000 }, 'opencode').text,
      /cached/,
    );
  });

  it('opens the breakdown when the line is clicked', () => {
    let opened = 0;
    const { container } = renderLine({ used: 10 }, 'claude', () => { opened += 1; });

    fireEvent.click(container.querySelector('button')!);

    assert.equal(opened, 1);
  });
});
