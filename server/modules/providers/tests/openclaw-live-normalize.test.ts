import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenclawSessionsProvider } from '@/modules/providers/list/openclaw/openclaw-sessions.provider.js';

const provider = new OpenclawSessionsProvider();

test('normalizeMessage maps an accumulated text chunk to an upsertable text row', () => {
  const [message] = provider.normalizeMessage(
    { type: 'agent_message_chunk', content: '累计快照', messageId: 'openclaw-run-text-0' },
    'app-session',
  );
  assert.equal(message.kind, 'text');
  assert.equal(message.role, 'assistant');
  assert.equal(message.content, '累计快照');
  assert.equal(message.id, 'openclaw-run-text-0');
  assert.equal(message.provider, 'openclaw');
});

test('normalizeMessage maps a thought chunk to a thinking row', () => {
  const [message] = provider.normalizeMessage(
    { type: 'agent_thought_chunk', content: '推理中', messageId: 'openclaw-run-thinking-0' },
    'app-session',
  );
  assert.equal(message.kind, 'thinking');
  assert.equal(message.content, '推理中');
  assert.equal(message.id, 'openclaw-run-thinking-0');
});

test('normalizeMessage maps a tool call to a tool_use row keyed by the ACP toolCallId', () => {
  const [message] = provider.normalizeMessage(
    { type: 'tool_call', toolCallId: 't1', toolName: 'bash', input: { command: 'ls' } },
    'app-session',
  );
  assert.equal(message.kind, 'tool_use');
  assert.equal(message.toolName, 'bash');
  assert.deepEqual(message.toolInput, { command: 'ls' });
  assert.equal(message.toolId, 't1');
  assert.equal(message.id, 'openclaw-tool-t1');
});

test('normalizeMessage renders a completed tool result from content blocks', () => {
  const [message] = provider.normalizeMessage(
    {
      type: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      isError: false,
      content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }],
    },
    'app-session',
  );
  assert.equal(message.kind, 'tool_result');
  assert.equal(message.content, 'line one\nline two');
  assert.equal(message.isError, false);
  assert.equal(message.toolId, 't1');
});

test('normalizeMessage flags a failed tool result and falls back to the raw output', () => {
  const [message] = provider.normalizeMessage(
    { type: 'tool_call_update', toolCallId: 't2', status: 'failed', isError: true, output: 'boom' },
    'app-session',
  );
  assert.equal(message.kind, 'tool_result');
  assert.equal(message.isError, true);
  assert.equal(message.content, 'boom');
});

test('normalizeMessage ignores unknown events and empty chunks', () => {
  assert.deepEqual(provider.normalizeMessage({ type: 'available_commands_update' }, 'app-session'), []);
  assert.deepEqual(provider.normalizeMessage({ type: 'agent_message_chunk', content: '' }, 'app-session'), []);
  assert.deepEqual(provider.normalizeMessage(null, 'app-session'), []);
});
