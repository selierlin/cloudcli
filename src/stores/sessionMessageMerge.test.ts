import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from './useSessionStore';
import { computeMerged, upsertRealtimeMessages } from './sessionMessageMerge';

function message(
  id: string,
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage {
  return {
    id,
    sessionId: 'session-1',
    timestamp: '2026-08-28T00:00:00.000Z',
    provider: 'workbuddy',
    kind: 'tool_use',
    toolName: 'TodoList',
    toolId: id,
    toolInput: { items: [{ text: '检查', completed: false }] },
    status: 'running',
    ...overrides,
  };
}

test('realtime TodoList terminal snapshot overlays the stale server snapshot', () => {
  const serverMessage = message('todo-1');
  const realtimeMessage = message('todo-1', {
    status: 'completed',
    toolInput: { items: [{ text: '检查', completed: true }] },
    isFinal: true,
  });

  const merged = computeMerged([serverMessage], [realtimeMessage]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.status, 'completed');
  assert.deepEqual(merged[0]?.toolInput, {
    items: [{ text: '检查', completed: true }],
  });
  assert.equal(merged[0]?.isFinal, true);
});

test('realtime task lifecycle snapshots keep one row by stable id', () => {
  const running = message('task-1', {
    kind: 'task_notification',
    toolName: 'Task',
    toolId: undefined,
    status: 'running',
  });
  const completed = message('task-1', {
    kind: 'task_notification',
    toolName: 'Task',
    toolId: undefined,
    status: 'completed',
    isFinal: true,
  });

  const updated = upsertRealtimeMessages([], [running, completed]);

  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.status, 'completed');
  assert.equal(updated[0]?.isFinal, true);
});

test('tool snapshots with changing transport ids still reuse the stable tool id', () => {
  const started = message('transport-1', { toolId: 'native-tool-1' });
  const finished = message('transport-2', {
    toolId: 'native-tool-1',
    status: 'completed',
    isFinal: true,
  });

  const updated = upsertRealtimeMessages([], [started, finished]);

  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.toolId, 'native-tool-1');
  assert.equal(updated[0]?.status, 'completed');
  assert.equal(updated[0]?.isFinal, true);
});
