import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';
import type { PendingPermissionRequest } from '@/shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/modules/chat/utils/chatStorage', () => ({
  getClaudeSettings: vi.fn(() => {
    throw new Error('DSH permission prompts must not read Claude settings');
  }),
}));

const request: PendingPermissionRequest = {
  requestId: 'dsh-request-1',
  toolName: 'bash',
  input: { command: 'touch outside-workspace' },
  sessionId: 'session-1',
  provider: 'dsh',
};

test('DSH permission prompts offer a one-shot decision without Claude remember rules', () => {
  const decisions: Array<[string, { allow?: boolean }]> = [];

  render(
    <PermissionRequestsBanner
      pendingPermissionRequests={[request]}
      handlePermissionDecision={(requestId, decision) => {
        decisions.push([requestId as string, decision]);
      }}
      handleGrantToolPermission={() => ({ success: true })}
    />,
  );

  expect(screen.getByText('bash')).toBeTruthy();
  expect(screen.queryByText('Allow & remember')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));

  assert.deepEqual(decisions, [['dsh-request-1', { allow: true }]]);
});
