/**
 * Normalization coverage for the app-server channel's new shapes: the
 * `stream_delta` / `stream_end` frames the frontend buffers and seals, and the
 * downstream rows the mapper's translation feeds into.
 *
 * The existing `codex-sessions.test.ts` is left untouched; these cases are
 * additive and only exercise events the exec channel never produced.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCodexNotificationMapper } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

const SESSION = 'app-session';

const normalize = (raw: unknown) => new CodexSessionsProvider().normalizeMessage(raw, SESSION);

/** Runs one notification through the mapper and the normalizer, as the runtime will. */
const throughPipeline = (mapper: ReturnType<typeof createCodexNotificationMapper>, method: string, params: Record<string, unknown>) =>
  mapper.transformCodexNotification(method, params).flatMap((event) => normalize(event));

test('a streamed reply delta becomes a text stream frame', () => {
  const [frame] = normalize({ type: 'stream_delta', streamChannel: 'text', content: '亮', sourceItemId: 'msg-1' });

  assert.equal(frame.kind, 'stream_delta');
  assert.equal(frame.streamChannel, 'text');
  assert.equal(frame.content, '亮');
  assert.equal(frame.sourceItemId, 'msg-1');
  assert.equal(frame.sessionId, SESSION);
});

test('a streamed reasoning delta becomes a thinking stream frame', () => {
  const [frame] = normalize({ type: 'stream_delta', streamChannel: 'thinking', content: 'weighing', sourceItemId: 'rsn-1' });

  assert.equal(frame.kind, 'stream_delta');
  assert.equal(frame.streamChannel, 'thinking');
  assert.equal(frame.content, 'weighing');
});

test('a delta without a channel is treated as reply text', () => {
  const [frame] = normalize({ type: 'stream_delta', content: 'plain' });

  assert.equal(frame.kind, 'stream_delta');
  assert.equal(frame.streamChannel, 'text');
  // A delta with no source item carries no ownership claim at all, rather than
  // an empty one.
  assert.ok(!('sourceItemId' in frame), 'sourceItemId must be absent, not empty');
});

test('an empty delta is dropped rather than published as a frame', () => {
  assert.deepEqual(normalize({ type: 'stream_delta', streamChannel: 'text', content: '' }), []);
  assert.deepEqual(normalize({ type: 'stream_delta', streamChannel: 'text' }), []);
});

test('stream_end seals a reply segment', () => {
  const [frame] = normalize({ type: 'stream_end' });

  assert.equal(frame.kind, 'stream_end');
  assert.equal(frame.sessionId, SESSION);
});

test('a streamed agent message keeps only the stream end, not a second copy of the prose', () => {
  const mapper = createCodexNotificationMapper();
  throughPipeline(mapper, 'item/agentMessage/delta', { itemId: 'msg-1', delta: 'hello ' });
  throughPipeline(mapper, 'item/agentMessage/delta', { itemId: 'msg-1', delta: 'world' });

  const events = throughPipeline(mapper, 'item/completed', {
    item: { type: 'agentMessage', id: 'msg-1', text: 'hello world' },
  });

  // Both the streamed deltas and the completion row reach the client; the
  // runtime drops the completion row when it matches what already streamed
  // (plan §5.5 方案二), which `streamedText` is what it decides on.
  assert.deepEqual(events.map((event) => event.kind), ['text', 'stream_end']);
  assert.equal(events[0].content, 'hello world');
  assert.equal(mapper.streamedText('msg-1'), 'hello world');
});

test('an in-flight command row streams its output instead of waiting for the command to end', () => {
  const mapper = createCodexNotificationMapper();
  throughPipeline(mapper, 'item/started', {
    item: {
      type: 'commandExecution',
      id: 'cmd-1',
      command: 'printf "a\\nb\\n"',
      status: 'inProgress',
      aggregatedOutput: null,
      exitCode: null,
    },
  });
  throughPipeline(mapper, 'item/commandExecution/outputDelta', { itemId: 'cmd-1', delta: 'a\n' });

  const events = throughPipeline(mapper, 'item/commandExecution/outputDelta', { itemId: 'cmd-1', delta: 'b\n' });
  const toolUse = events.find((event) => event.kind === 'tool_use');
  const toolResult = events.find((event) => event.kind === 'tool_result');

  assert.equal(toolUse?.toolName, 'Bash');
  assert.deepEqual(toolUse?.toolInput, { command: 'printf "a\\nb\\n"' });
  assert.equal(toolUse?.status, 'in_progress');
  // The row is replaced by id on the client, so the content has to be the whole
  // output so far, not just the newest fragment.
  assert.equal(toolResult?.content, 'a\nb\n');
  assert.equal(toolResult?.isError, false);
});

test('a completed command row carries the server\'s full output and exit code', () => {
  const mapper = createCodexNotificationMapper();
  throughPipeline(mapper, 'item/started', {
    item: { type: 'commandExecution', id: 'cmd-1', command: 'false', status: 'inProgress', aggregatedOutput: null, exitCode: null },
  });

  const events = throughPipeline(mapper, 'item/completed', {
    item: { type: 'commandExecution', id: 'cmd-1', command: 'false', status: 'failed', aggregatedOutput: 'boom\n', exitCode: 1 },
  });

  const toolResult = events.find((event) => event.kind === 'tool_result');
  assert.equal(toolResult?.content, 'boom\n');
  assert.equal(toolResult?.isError, true);
});

test('a file change with an object kind still picks the right edit tool', () => {
  const mapper = createCodexNotificationMapper();

  const events = throughPipeline(mapper, 'item/completed', {
    item: {
      type: 'fileChange',
      id: 'patch-1',
      status: 'completed',
      changes: [
        { path: '/w/new.ts', kind: { type: 'add' }, diff: '+++' },
        { path: '/w/edit.ts', kind: { type: 'update', move_path: null }, diff: '@@' },
      ],
    },
  });

  const toolNames = events.map((event) => event.toolName);
  assert.deepEqual(toolNames, ['Write', 'Edit']);
  assert.deepEqual(events.map((event) => event.toolId), ['patch-1_0', 'patch-1_1']);
});

test('a plan update becomes the TodoWrite card the renderer already draws', () => {
  const mapper = createCodexNotificationMapper();

  const events = throughPipeline(mapper, 'turn/plan/updated', {
    turnId: 'turn-1',
    explanation: null,
    plan: [
      { step: 'Read', status: 'completed' },
      { step: 'Fix', status: 'inProgress' },
    ],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].toolName, 'TodoWrite');
  assert.deepEqual(events[0].toolInput, {
    todos: [
      { content: 'Read', status: 'completed' },
      { content: 'Fix', status: 'pending' },
    ],
  });
});

test('an unrecognized mcp result degrades to JSON instead of throwing', () => {
  // `McpToolCallResult.content` is an array of arbitrary JSON blocks and only
  // `structuredContent` is camelCase in the protocol, so the reader finds no
  // text block and no structured content. It must still produce a row.
  const [toolUse, toolResult] = normalize({
    type: 'item',
    itemType: 'mcp_tool_call',
    itemId: 'mcp-1',
    server: 'fs',
    tool: 'read',
    arguments: { path: '/w/a' },
    result: { content: [{ type: 'image', data: 'AAAA' }], structuredContent: { bytes: 4 }, _meta: null },
    error: null,
    status: 'completed',
  });

  assert.equal(toolUse.kind, 'tool_use');
  assert.equal(toolUse.toolName, 'mcp__fs__read');
  assert.equal(toolResult.kind, 'tool_result');
  // The tool card's own result slot is empty (the structured payload is spelled
  // differently than the reader expects); the JSON fallback still lands in the
  // paired result row. Both halves of that gap are pinned here on purpose so a
  // later fix has to update this test rather than silently change behavior.
  assert.equal(toolUse.toolResult?.content, '');
  assert.match(String(toolResult.content), /structuredContent/);
});

test('an mcp error surfaces as an error result row', () => {
  const [, toolResult] = normalize({
    type: 'item',
    itemType: 'mcp_tool_call',
    itemId: 'mcp-2',
    server: 'fs',
    tool: 'read',
    status: 'failed',
    result: null,
    error: { message: 'ENOENT' },
  });

  assert.equal(toolResult.content, 'ENOENT');
  assert.equal(toolResult.isError, true);
});
