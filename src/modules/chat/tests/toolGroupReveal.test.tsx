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

describe('tool group search reveal', () => {
  it('folds a one-tool batch when it belongs to a process run', () => {
    const [group] = groupConsecutiveTools([{
      id: 'tool-1', type: 'assistant', content: '', timestamp: '2026-09-16T10:00:01.000Z',
      isToolUse: true, toolName: 'Read', toolInput: { file_path: '/repo/a.ts' }, toolStatus: 'completed',
    }], true);
    expect(isToolGroupItem(group)).toBe(true);
    if (!isToolGroupItem(group)) return;

    const view = render(
      <UiPreferencesProvider>
        <ToolGroupContainer
          group={group}
          collapseSingleTool
          prevMessage={null}
          createDiff={() => []}
          getMessageKey={(message) => String(message.id)}
          selectedProject={project}
          provider="claude"
        />
      </UiPreferencesProvider>,
    );

    expect(view.getByRole('button', { name: /Read/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('does not repeat the process harness identity when its tool batch opens', () => {
    const [group] = groupConsecutiveTools([{
      id: 'tool-1', type: 'assistant', content: '', timestamp: '2026-09-16T10:00:01.000Z',
      isToolUse: true, toolName: 'Read', toolInput: { file_path: '/repo/a.ts' }, toolStatus: 'completed',
    }], true);
    expect(isToolGroupItem(group)).toBe(true);
    if (!isToolGroupItem(group)) return;

    const view = render(
      <UiPreferencesProvider>
        <ToolGroupContainer
          group={group}
          collapseSingleTool
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
    const [group] = groupConsecutiveTools([{
      id: 'tool-1', type: 'assistant', content: '', timestamp: '2026-09-16T10:00:01.000Z',
      isToolUse: true, toolName: 'Read', toolInput: { file_path: '/repo/a.ts' }, toolStatus: 'completed',
    }], true);
    expect(isToolGroupItem(group)).toBe(true);
    if (!isToolGroupItem(group)) return;

    const onExpandedChange = vi.fn();
    const renderGroup = (expanded: boolean) => (
      <UiPreferencesProvider>
        <ToolGroupContainer
          group={group}
          collapseSingleTool
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
