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
 * The picker may only offer parents the tree can actually nest under. A
 * cross-provider choice used to be listed and stored, but
 * `buildProjectSessionTree` keeps such a row top-level, so the filing looked
 * like it had been ignored.
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

test('the picker lists only parents of the filed session’s own provider', () => {
  assert.deepEqual(candidatesFor('claude-target'), ['claude other']);
  assert.deepEqual(candidatesFor('codex-target'), ['codex other']);
});
