import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BashCommandDisplay } from '@/modules/chat/tools/BashCommandDisplay';
import { SubagentPanel } from '@/modules/chat/tools/SubagentPanel';

afterEach(() => {
  vi.useRealTimers();
});

describe('BashCommandDisplay activity summary', () => {
  it('ticks a running command from its provider timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T10:00:05.000Z'));
    const { container } = render(
      <BashCommandDisplay
        command="npm test"
        status="running"
        startTimestamp="2026-09-13T10:00:00.000Z"
      />,
    );
    expect(container.textContent).toContain('Running · 5s');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toContain('Running · 6s');
  });

  it('shows stable completion duration and output line count', () => {
    const { container } = render(
      <BashCommandDisplay
        command="printf test"
        output={'one\ntwo\n'}
        status="completed"
        startTimestamp="2026-09-13T10:00:00.000Z"
        endTimestamp="2026-09-13T10:00:02.400Z"
      />,
    );
    expect(container.textContent).toContain('Completed');
    expect(container.textContent).toContain('2.4s · 2 lines');
  });

  it('previews only the last three error lines while collapsed', () => {
    const { container } = render(
      <BashCommandDisplay
        command="npm test"
        output={'first\nsecond\nthird\nfourth'}
        status="error"
        isError
      />,
    );
    const preview = container.querySelector('pre');
    expect(preview?.textContent).toBe('second\nthird\nfourth');
  });
});

describe('SubagentPanel activity summary', () => {
  it('shows elapsed time, total steps, tool count, and current activity without mounting the timeline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T10:00:05.000Z'));
    const { container } = render(
      <SubagentPanel
        toolInput={{ prompt: 'inspect' }}
        subagent={{ id: 'a1', status: 'running', activityCount: 12 }}
        activity={[
          { kind: 'thinking', content: 'checking' },
          { kind: 'tool', toolName: 'Bash', toolInput: { command: 'npm test' } },
        ]}
        startTimestamp="2026-09-13T10:00:00.000Z"
        createDiff={() => []}
      />,
    );
    expect(container.textContent).toContain('Running · 5s · 12 steps');
    expect(container.textContent).toContain('Bash / npm test');
    expect(container.textContent).not.toContain('Task');
  });

  it('shows a compact failed result while the full timeline stays unmounted', () => {
    const { container } = render(
      <SubagentPanel
        toolInput={{ prompt: 'inspect' }}
        toolResult={{ content: 'failure detail\nsecond line', isError: true }}
        subagent={{ id: 'a1', status: 'failed', activityCount: 3 }}
        activity={[]}
        createDiff={() => []}
      />,
    );
    expect(container.textContent).toContain('failed');
    expect(container.textContent).toContain('failure detail');
    expect(container.textContent).not.toContain('Result');
  });
});
