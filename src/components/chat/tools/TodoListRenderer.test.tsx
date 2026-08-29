import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeTodoItems } from './components/ContentRenderers/TodoListUtils';
import { getToolConfig } from './configs/toolConfigs';

test('normalizes Codex TodoList items to the task renderer shape', () => {
  assert.deepEqual(
    normalizeTodoItems([
      { text: 'Verify the finished changes', completed: true },
      { text: 'Publish the result', completed: false },
    ]),
    [
      { content: 'Verify the finished changes', status: 'completed' },
      { content: 'Publish the result', status: 'pending' },
    ],
  );
});

test('uses the task-list renderer for Codex TodoList events', () => {
  const config = getToolConfig('TodoList');

  assert.equal(config.input.contentType, 'todo-list');
  assert.equal(config.result?.hidden, true);
});
