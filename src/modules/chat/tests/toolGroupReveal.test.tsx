import { render } from '@testing-library/react';
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
  });
});
