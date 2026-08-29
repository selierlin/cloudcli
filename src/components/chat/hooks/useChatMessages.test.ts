import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizedToChatMessages } from './useChatMessages';

test('normalizedToChatMessages preserves stopped tool status', () => {
  const [message] = normalizedToChatMessages([{
    id: 'tool-stopped-1',
    sessionId: 'session-1',
    timestamp: '2026-08-28T00:00:00.000Z',
    provider: 'workbuddy',
    kind: 'tool_use',
    toolName: 'Bash',
    toolInput: { command: 'sleep 10' },
    toolId: 'tool-stopped-1',
    status: 'stopped',
  }]);

  assert.equal(message?.toolStatus, 'stopped');
});

test('normalizedToChatMessages maps a cancelled tool result to stopped', () => {
  const [message] = normalizedToChatMessages([
    {
      id: 'tool-cancelled-1',
      sessionId: 'session-1',
      timestamp: '2026-08-28T00:00:00.000Z',
      provider: 'workbuddy',
      kind: 'tool_use',
      toolName: 'Bash',
      toolInput: { command: 'sleep 10' },
      toolId: 'tool-cancelled-1',
    },
    {
      id: 'tool-result-cancelled-1',
      sessionId: 'session-1',
      timestamp: '2026-08-28T00:00:01.000Z',
      provider: 'workbuddy',
      kind: 'tool_result',
      toolId: 'tool-cancelled-1',
      content: 'cancelled by user',
      isError: true,
      status: 'cancelled',
    },
  ]);

  assert.equal(message?.toolStatus, 'stopped');
  assert.equal(message?.toolResult?.status, 'cancelled');
});
