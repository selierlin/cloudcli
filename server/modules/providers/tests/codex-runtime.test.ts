import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCodexTokenBudget,
  transformCodexEvent,
} from '@/modules/providers/list/codex/codex-runtime.provider.js';

test('Codex runtime preserves native item ids for lifecycle updates', () => {
  const transformed = transformCodexEvent({
    type: 'item.updated',
    item: {
      id: 'command-live-1',
      type: 'command_execution',
      command: 'npm test',
      aggregated_output: 'running',
      status: 'in_progress',
    },
  });

  assert.deepEqual(transformed, {
    type: 'item',
    itemType: 'command_execution',
    itemId: 'command-live-1',
    command: 'npm test',
    output: 'running',
    exitCode: undefined,
    status: 'in_progress',
  });
});

test('Codex runtime reads current SDK reasoning usage fields', () => {
  assert.deepEqual(extractCodexTokenBudget({
    type: 'turn.completed',
    usage: {
      input_tokens: 120,
      cached_input_tokens: 30,
      cache_write_input_tokens: 10,
      output_tokens: 40,
      reasoning_output_tokens: 60,
    },
  }), {
    used: 220,
    total: 200000,
    inputTokens: 120,
    outputTokens: 40,
    reasoningTokens: 60,
    breakdown: {
      input: 120,
      output: 40,
      reasoning: 60,
    },
  });
});
