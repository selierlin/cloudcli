import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage, Project } from '@/shared/types';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import ToolGroupContainer from '@/modules/chat/transcript/ToolGroupContainer';
import { groupConsecutiveTools, isToolGroupItem } from '@/modules/chat/utils/toolGrouping';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
} as Project;

/** A run of same-tool calls, the shape a Process Run batches before folding. */
const readBatch = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `tool-${index}`,
    type: 'assistant',
    content: '',
    timestamp: '2026-09-16T10:00:01.000Z',
    isToolUse: true,
    toolName: 'Read',
    toolInput: { file_path: `/repo/${index}.ts` },
    toolStatus: 'completed',
  })) as ChatMessage[];

describe('tool group search reveal', () => {
  it('folds a process-run batch only once it outgrows three calls', () => {
    const renderBatch = (count: number) => {
      const [group] = groupConsecutiveTools(readBatch(count), true);
      expect(isToolGroupItem(group)).toBe(true);
      if (!isToolGroupItem(group)) return null;

      return render(
        <UiPreferencesProvider>
          <ToolGroupContainer
            group={group}
            collapseAbove={3}
            prevMessage={null}
            createDiff={() => []}
            getMessageKey={(message) => String(message.id)}
            selectedProject={project}
            provider="claude"
          />
        </UiPreferencesProvider>,
      );
    };

    // Three calls stay flat under the process title: no `x3` disclosure row, so
    // the reader sees the tools themselves.
    const flat = renderBatch(3);
    expect(flat?.queryByRole('button', { name: /x3/ })).toBeNull();
    // The third call's own row is mounted: the batch renders as rows, not as
    // one collapsed line.
    expect(flat?.container.textContent).toContain('2.ts');
    // The fourth call folds the batch behind an `x4` row, hiding its rows.
    const folded = renderBatch(4);
    expect(
      folded?.getByRole('button', { name: /x4/ }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(folded?.container.textContent).not.toContain('3.ts');
  });

  it('does not repeat the process harness identity when its tool batch opens', () => {
    const [group] = groupConsecutiveTools(readBatch(4), true);
    expect(isToolGroupItem(group)).toBe(true);
    if (!isToolGroupItem(group)) return;

    const view = render(
      <UiPreferencesProvider>
        <ToolGroupContainer
          group={group}
          collapseAbove={3}
          expanded
          hidesProcessIdentity
          prevMessage={null}
          createDiff={() => []}
          getMessageKey={(message) => String(message.id)}
          selectedProject={project}
          provider="claude"
        />
      </UiPreferencesProvider>,
    );

    expect(view.queryByText('messageTypes.claude')).toBeNull();
  });

  it('expands the targeted group when a reveal request arrives', () => {
    const messages: ChatMessage[] = [
      {
        id: 'tool-1', type: 'assistant', content: '', timestamp: '2026-09-16T10:00:01.000Z',
        isToolUse: true, toolName: 'Read', toolInput: { file_path: '/repo/a.ts' }, toolStatus: 'completed',
      },
      {
        id: 'tool-2', type: 'assistant', content: '', timestamp: '2026-09-16T10:00:02.000Z',
        isToolUse: true, toolName: 'Read', toolInput: { file_path: '/repo/b.ts' }, toolStatus: 'completed',
      },
    ];
    const [group] = groupConsecutiveTools(messages, true);
    expect(isToolGroupItem(group)).toBe(true);
    if (!isToolGroupItem(group)) return;

    const renderGroup = (revealRequestId?: number) => (
      <UiPreferencesProvider>
        <ToolGroupContainer
          group={group}
          prevMessage={null}
          createDiff={() => []}
          getMessageKey={(message) => String(message.id)}
          selectedProject={project}
          provider="claude"
          revealRequestId={revealRequestId}
        />
      </UiPreferencesProvider>
    );
    const view = render(renderGroup());
    expect(view.getByRole('button', { name: /Read/ }).getAttribute('aria-expanded')).toBe('false');

    view.rerender(renderGroup(1));

    expect(view.getByRole('button', { name: /Read/ }).getAttribute('aria-expanded')).toBe('true');

    view.rerender(renderGroup());

    expect(view.getByRole('button', { name: /Read/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('retains a parent-owned tool disclosure across remounts', () => {
    const [group] = groupConsecutiveTools(readBatch(4), true);
    expect(isToolGroupItem(group)).toBe(true);
    if (!isToolGroupItem(group)) return;

    const onExpandedChange = vi.fn();
    const renderGroup = (expanded: boolean) => (
      <UiPreferencesProvider>
        <ToolGroupContainer
          group={group}
          collapseAbove={3}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          prevMessage={null}
          createDiff={() => []}
          getMessageKey={(message) => String(message.id)}
          selectedProject={project}
          provider="claude"
        />
      </UiPreferencesProvider>
    );
    const view = render(renderGroup(false));

    fireEvent.click(view.getByRole('button', { name: /Read/ }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);

    view.rerender(renderGroup(true));
    expect(view.getByRole('button', { name: /Read/ }).getAttribute('aria-expanded')).toBe('true');

    view.unmount();
    const remounted = render(renderGroup(true));
    expect(remounted.getByRole('button', { name: /Read/ }).getAttribute('aria-expanded')).toBe('true');
  });
});
