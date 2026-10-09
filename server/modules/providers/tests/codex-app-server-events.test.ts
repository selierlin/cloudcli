/**
 * Table-driven coverage for the `codex app-server` notification mapper.
 *
 * These run offline: no CLI, no process. They pin the mapping the runtime will
 * rely on, in particular the three places the protocol's shape differs from the
 * SDK's — camelCase item status, `kind` as an object, and progress carried as
 * deltas rather than snapshots.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCodexNotificationMapper } from '@/modules/providers/list/codex/codex-runtime.provider.js';

const TURN = 'turn-1';

test('a completed agent message maps to a reply row and closes its stream segment', () => {
  const mapper = createCodexNotificationMapper();

  const events = mapper.transformCodexNotification('item/completed', {
    threadId: 'thread-1',
    turnId: TURN,
    item: { type: 'agentMessage', id: 'msg-1', text: 'hello', phase: null, memoryCitation: null },
  });

  assert.deepEqual(events, [
    {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'msg-1',
      message: { role: 'assistant', content: 'hello' },
    },
    { type: 'stream_end' },
  ]);
});

test('a completed reasoning item maps to a thinking row built from its summary blocks', () => {
  const mapper = createCodexNotificationMapper();

  const events = mapper.transformCodexNotification('item/completed', {
    item: { type: 'reasoning', id: 'rsn-1', summary: ['first', 'second'], content: ['raw chain'] },
  });

  // Only the summary is rendered; the raw chain of thought is not.
  assert.deepEqual(events, [{
    type: 'item',
    itemType: 'reasoning',
    itemId: 'rsn-1',
    message: { role: 'assistant', content: 'first\nsecond', isReasoning: true },
  }]);
});

test('an item type with no renderer falls back to the generic tool row', () => {
  const mapper = createCodexNotificationMapper();
  const item = { type: 'dynamicToolCall', id: 'dyn-1', tool: 'x', arguments: {}, status: 'completed' };

  const events = mapper.transformCodexNotification('item/completed', { item });

  assert.deepEqual(events, [{ type: 'item', itemType: 'dynamicToolCall', itemId: 'dyn-1', item }]);
});

test('a plan item is dropped rather than drawn as a generic tool card', () => {
  const mapper = createCodexNotificationMapper();

  const events = mapper.transformCodexNotification('item/completed', {
    item: { type: 'plan', id: 'plan-1', text: '# Ship it' },
  });

  assert.deepEqual(events, []);
});

test('command status arrives camelCase and leaves as snake_case', () => {
  const mapper = createCodexNotificationMapper();
  const started = {
    type: 'commandExecution',
    id: 'cmd-1',
    command: 'ls -la',
    cwd: '/workspace',
    status: 'inProgress',
    aggregatedOutput: null,
    exitCode: null,
  };

  assert.deepEqual(
    mapper.transformCodexNotification('item/started', { item: started }),
    [{
      type: 'item',
      itemType: 'command_execution',
      itemId: 'cmd-1',
      command: 'ls -la',
      output: '',
      exitCode: null,
      status: 'in_progress',
    }],
  );

  assert.deepEqual(
    mapper.transformCodexNotification('item/completed', {
      item: { ...started, status: 'completed', aggregatedOutput: 'total 0\n', exitCode: 0 },
    }),
    [{
      type: 'item',
      itemType: 'command_execution',
      itemId: 'cmd-1',
      command: 'ls -la',
      output: 'total 0\n',
      exitCode: 0,
      status: 'completed',
    }],
  );
});

test('command output deltas accumulate, and the completion row carries the full output', () => {
  const mapper = createCodexNotificationMapper();
  mapper.transformCodexNotification('item/started', {
    item: {
      type: 'commandExecution',
      id: 'cmd-1',
      command: 'seq 2',
      status: 'inProgress',
      aggregatedOutput: null,
      exitCode: null,
    },
  });

  const first = mapper.transformCodexNotification('item/commandExecution/outputDelta', {
    threadId: 'thread-1',
    turnId: TURN,
    itemId: 'cmd-1',
    delta: '1\n',
  });
  const second = mapper.transformCodexNotification('item/commandExecution/outputDelta', {
    threadId: 'thread-1',
    turnId: TURN,
    itemId: 'cmd-1',
    delta: '2\n',
  });
  const completed = mapper.transformCodexNotification('item/completed', {
    item: { type: 'commandExecution', id: 'cmd-1', command: 'seq 2', status: 'completed', aggregatedOutput: '1\n2\n', exitCode: 0 },
  });

  // Each progress row carries everything seen so far: the client replaces the
  // row by id, so a fragment-only row would erase the output before it.
  assert.equal(first[0].output, '1\n');
  assert.equal(second[0].output, '1\n2\n');
  assert.equal(second[0].status, 'in_progress');
  assert.equal(second[0].command, 'seq 2');
  assert.equal(completed[0].output, '1\n2\n');
});

test('a progress update for an item that never started is dropped', () => {
  const mapper = createCodexNotificationMapper();

  assert.deepEqual(
    mapper.transformCodexNotification('item/commandExecution/outputDelta', { itemId: 'missing', delta: 'x' }),
    [],
  );
  assert.deepEqual(
    mapper.transformCodexNotification('item/mcpToolCall/progress', { itemId: 'missing', message: 'x' }),
    [],
  );
});

test('file change kinds are objects in the protocol and flat strings downstream', () => {
  const mapper = createCodexNotificationMapper();

  const events = mapper.transformCodexNotification('item/completed', {
    item: {
      type: 'fileChange',
      id: 'patch-1',
      status: 'completed',
      changes: [
        { path: '/w/new.ts', kind: { type: 'add' }, diff: '+++' },
        { path: '/w/old.ts', kind: { type: 'update', move_path: null }, diff: '@@' },
      ],
    },
  });

  assert.deepEqual(events, [{
    type: 'item',
    itemType: 'file_change',
    itemId: 'patch-1',
    status: 'completed',
    changes: [
      { path: '/w/new.ts', kind: 'add', diff: '+++' },
      { path: '/w/old.ts', kind: 'update', diff: '@@' },
    ],
  }]);
});

test('an mcp tool call keeps its result and normalizes its status', () => {
  const mapper = createCodexNotificationMapper();
  const result = { content: [{ type: 'text', text: 'ok' }], structuredContent: null, _meta: null };

  const events = mapper.transformCodexNotification('item/completed', {
    item: {
      type: 'mcpToolCall',
      id: 'mcp-1',
      server: 'fs',
      tool: 'read',
      arguments: { path: '/w/a' },
      result,
      error: null,
      status: 'completed',
    },
  });

  assert.deepEqual(events, [{
    type: 'item',
    itemType: 'mcp_tool_call',
    itemId: 'mcp-1',
    server: 'fs',
    tool: 'read',
    arguments: { path: '/w/a' },
    result,
    error: null,
    status: 'completed',
  }]);
});

test('an in-flight mcp progress line rides in the result slot the card renders', () => {
  const mapper = createCodexNotificationMapper();
  mapper.transformCodexNotification('item/started', {
    item: { type: 'mcpToolCall', id: 'mcp-1', server: 'fs', tool: 'read', arguments: { path: '/w/a' }, status: 'inProgress', result: null, error: null },
  });

  const events = mapper.transformCodexNotification('item/mcpToolCall/progress', {
    threadId: 'thread-1',
    turnId: TURN,
    itemId: 'mcp-1',
    message: 'reading 42 bytes',
  });

  assert.equal(events[0].status, 'in_progress');
  assert.equal(events[0].server, 'fs');
  assert.deepEqual(events[0].result, { content: [{ type: 'text', text: 'reading 42 bytes' }] });
});

test('a web search maps to the query the tool card shows', () => {
  const mapper = createCodexNotificationMapper();

  const events = mapper.transformCodexNotification('item/completed', {
    item: { type: 'webSearch', id: 'ws-1', query: 'openai codex', action: null, results: null },
  });

  assert.deepEqual(events, [{ type: 'item', itemType: 'web_search', itemId: 'ws-1', query: 'openai codex' }]);
});

test('agent message deltas stream the reply and remember which item they belong to', () => {
  const mapper = createCodexNotificationMapper();

  const events = mapper.transformCodexNotification('item/agentMessage/delta', {
    threadId: 'thread-1',
    turnId: TURN,
    itemId: 'msg-1',
    delta: 'Hel',
  });

  assert.deepEqual(events, [{
    type: 'stream_delta',
    streamChannel: 'text',
    content: 'Hel',
    sourceItemId: 'msg-1',
  }]);
});

test('whitespace-only deltas survive the mapper', () => {
  const mapper = createCodexNotificationMapper();

  // A token's leading space is what separates English words; dropping it would
  // run the reply's words together.
  const events = mapper.transformCodexNotification('item/agentMessage/delta', { itemId: 'msg-1', delta: ' ' });

  assert.deepEqual(events, [{ type: 'stream_delta', streamChannel: 'text', content: ' ', sourceItemId: 'msg-1' }]);
});

test('reasoning summary deltas stream on the thinking channel and start a new block with a newline', () => {
  const mapper = createCodexNotificationMapper();

  const firstBlock = mapper.transformCodexNotification('item/reasoning/summaryTextDelta', {
    itemId: 'rsn-1',
    delta: 'weighing',
    summaryIndex: 0,
  });
  const secondBlock = mapper.transformCodexNotification('item/reasoning/summaryTextDelta', {
    itemId: 'rsn-1',
    delta: 'deciding',
    summaryIndex: 1,
  });

  assert.deepEqual(firstBlock, [{ type: 'stream_delta', streamChannel: 'thinking', content: 'weighing', sourceItemId: 'rsn-1' }]);
  // The completed row joins summary blocks with newlines, so the streamed text
  // has to carry the same separator for the two to read as one message.
  assert.deepEqual(secondBlock, [{ type: 'stream_delta', streamChannel: 'thinking', content: '\ndeciding', sourceItemId: 'rsn-1' }]);
});

test('raw reasoning deltas are dropped', () => {
  const mapper = createCodexNotificationMapper();

  assert.deepEqual(
    mapper.transformCodexNotification('item/reasoning/textDelta', { itemId: 'rsn-1', delta: 'chain of thought', contentIndex: 0 }),
    [],
  );
});

test('plan updates become the todo items the normalizer reads, one row per turn', () => {
  const mapper = createCodexNotificationMapper();

  const events = mapper.transformCodexNotification('turn/plan/updated', {
    threadId: 'thread-1',
    turnId: TURN,
    explanation: null,
    plan: [
      { step: 'Read the code', status: 'completed' },
      { step: 'Write the fix', status: 'inProgress' },
      { step: 'Run the tests', status: 'pending' },
    ],
  });

  assert.deepEqual(events, [{
    type: 'item',
    itemType: 'todo_list',
    itemId: 'plan_turn-1',
    eventType: 'turn.plan.updated',
    // `inProgress` is not `completed`, matching the row shape the SDK channel
    // already produced.
    items: [
      { text: 'Read the code', completed: true },
      { text: 'Write the fix', completed: false },
      { text: 'Run the tests', completed: false },
    ],
  }]);
});

test('token usage is forwarded for the runtime to report once at turn end', () => {
  const mapper = createCodexNotificationMapper();
  const tokenUsage = { total: { totalTokens: 10 }, last: { totalTokens: 4 }, modelContextWindow: 200000 };

  const events = mapper.transformCodexNotification('thread/tokenUsage/updated', {
    threadId: 'thread-1',
    turnId: TURN,
    tokenUsage,
  });

  assert.deepEqual(events, [{ type: 'token_usage', usage: tokenUsage }]);
});

test('a retryable error is not rendered as a terminal error row', () => {
  const mapper = createCodexNotificationMapper();

  assert.deepEqual(
    mapper.transformCodexNotification('error', {
      error: { message: 'stream disconnected' },
      willRetry: true,
      threadId: 'thread-1',
      turnId: TURN,
    }),
    [],
  );
});

test('a final error maps to the error row the runtime also records', () => {
  const mapper = createCodexNotificationMapper();

  const events = mapper.transformCodexNotification('error', {
    error: { message: 'usage limit reached' },
    willRetry: false,
    threadId: 'thread-1',
    turnId: TURN,
  });

  assert.deepEqual(events, [{
    type: 'item',
    itemType: 'error',
    itemId: 'error_turn-1',
    message: { role: 'error', content: 'usage limit reached' },
  }]);
});

test('turn and thread boundaries map to the lifecycle events they replace', () => {
  const mapper = createCodexNotificationMapper();

  assert.deepEqual(mapper.transformCodexNotification('turn/started', { turn: { id: TURN } }), [{ type: 'turn_started' }]);
  assert.deepEqual(
    mapper.transformCodexNotification('thread/started', { thread: { id: 'thread-1' } }),
    [{ type: 'thread_started', threadId: 'thread-1' }],
  );
});

test('a completed turn closes with a terminal event, an interrupted one with nothing', () => {
  const mapper = createCodexNotificationMapper();

  assert.deepEqual(
    mapper.transformCodexNotification('turn/completed', { turn: { id: TURN, status: 'completed', error: null } }),
    [{ type: 'turn_complete' }],
  );
  assert.deepEqual(
    mapper.transformCodexNotification('turn/completed', { turn: { id: TURN, status: 'failed', error: { message: 'boom' } } }),
    [{ type: 'turn_failed', error: { message: 'boom' } }],
  );
  // Aborting is owned by the abort path, which sends its own terminal event.
  assert.deepEqual(
    mapper.transformCodexNotification('turn/completed', { turn: { id: TURN, status: 'interrupted', error: null } }),
    [],
  );
});

test('unknown notification methods map to nothing', () => {
  const mapper = createCodexNotificationMapper();

  assert.deepEqual(mapper.transformCodexNotification('thread/attachment/updated', { threadId: 'thread-1' }), []);
  assert.deepEqual(mapper.transformCodexNotification('item/fileChange/outputDelta', { itemId: 'x', delta: 'y' }), []);
});

test('streamed text is remembered per item and dropped when the turn ends', () => {
  const mapper = createCodexNotificationMapper();
  mapper.transformCodexNotification('item/agentMessage/delta', { itemId: 'msg-1', delta: 'Hel' });
  mapper.transformCodexNotification('item/agentMessage/delta', { itemId: 'msg-1', delta: 'lo' });

  assert.equal(mapper.streamedText('msg-1'), 'Hello');
  assert.equal(mapper.streamedText('msg-2'), undefined);

  mapper.transformCodexNotification('turn/completed', { turn: { id: TURN, status: 'completed', error: null } });

  assert.equal(mapper.streamedText('msg-1'), undefined);
});

test('a second turn reuses the mapper without leaking the first turn\'s items', () => {
  const mapper = createCodexNotificationMapper();
  mapper.transformCodexNotification('item/started', {
    item: { type: 'commandExecution', id: 'cmd-1', command: 'ls', status: 'inProgress', aggregatedOutput: null, exitCode: null },
  });
  mapper.transformCodexNotification('turn/completed', { turn: { id: TURN, status: 'completed', error: null } });

  // The item from the previous turn is gone, so its delta can no longer render.
  assert.deepEqual(
    mapper.transformCodexNotification('item/commandExecution/outputDelta', { itemId: 'cmd-1', delta: 'late' }),
    [],
  );
});
