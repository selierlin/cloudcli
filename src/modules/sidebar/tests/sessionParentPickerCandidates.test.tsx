import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { test } from 'vitest';

import {
  SessionParentPickerProvider,
  useSessionParentPicker,
} from '@/modules/sidebar/context/SessionParentPickerContext';
import type { Project } from '@/shared/types';

/**
 * The picker offers every top-level session of the same project. Manual filing
 * is a user choice, so it may cross providers; only the fork lineage stays
 * within one provider (see `buildProjectSessionTree`).
 */
const t = ((key: string) => key) as unknown as TFunction;

const project = {
  projectId: 'project-1',
  name: 'project-1',
  displayName: 'project one',
  fullPath: '/tmp/project-1',
  sessions: [
    { id: 'claude-target', summary: 'claude target', provider: 'claude' },
    { id: 'claude-other', summary: 'claude other', provider: 'claude' },
    { id: 'codex-target', summary: 'codex target', provider: 'codex' },
    { id: 'codex-other', summary: 'codex other', provider: 'codex' },
  ],
} as unknown as Project;

function OpenPicker({ sessionId }: { sessionId: string }) {
  const picker = useSessionParentPicker();
  return (
    <button
      type="button"
      onClick={() => picker?.requestAssignParent({
        sessionId, projectId: 'project-1', name: sessionId, parentSessionId: null,
      })}
    >
      open
    </button>
  );
}

/** Opens the picker for `sessionId` and returns the candidate names it offers. */
const candidatesFor = (sessionId: string): string[] => {
  const view = render(
    <SessionParentPickerProvider projects={[project]} setSessionParent={() => {}} t={t}>
      <OpenPicker sessionId={sessionId} />
    </SessionParentPickerProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'open' }));
  const names = [...document.querySelectorAll('[role="dialog"] span[title]')]
    .map((span) => span.getAttribute('title'))
    .filter((title): title is string => title !== null && title !== '');
  view.unmount();
  return names;
};

test('the picker lists every top-level session of the project, whatever its provider', () => {
  assert.deepEqual(candidatesFor('claude-target'), ['claude other', 'codex target', 'codex other']);
  assert.deepEqual(candidatesFor('codex-target'), ['claude target', 'claude other', 'codex other']);
});
