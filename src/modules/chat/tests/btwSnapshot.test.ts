import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';
import {
  BTW_SNAPSHOT_BUDGET_CHARS,
  BTW_SNAPSHOT_MAX_AGE_MS,
  BTW_SNAPSHOT_STORAGE_KEY,
  clearBtwSnapshot,
  extractStreamingSeed,
  readBtwSnapshot,
  trimBtwSnapshotMessages,
  writeBtwSnapshot,
} from '@/modules/chat/utils/btwSnapshot';

/**
 * The drawer's reload snapshot: what it keeps, what it drops, and what it does
 * when `sessionStorage` refuses to take it.
 *
 * The trimming rules carry the most risk — they run on every finished turn and
 * again on `pagehide`, so a reducer that is not a fixed point would eat one
 * more turn per save until the drawer came back empty.
 */

const SESSION_ID = 'btw-1';
const SOURCE_ID = 'source-1';

let clock = 0;

const row = (
  id: string,
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage => {
  clock += 1;
  return {
    id,
    sessionId: SESSION_ID,
    timestamp: new Date(1_700_000_000_000 + clock).toISOString(),
    provider: 'claude',
    kind: 'text',
    ...overrides,
  };
};

const userRow = (id: string, content = 'question'): NormalizedMessage =>
  row(id, { kind: 'text', role: 'user', content });

const assistantRow = (id: string, content = 'answer'): NormalizedMessage =>
  row(id, { kind: 'text', role: 'assistant', content });

const filler = (length: number): string => 'x'.repeat(length);

const baseSnapshot = (messages: NormalizedMessage[]) => ({
  forkSourceSessionId: SOURCE_ID,
  sessionId: SESSION_ID,
  lastSeq: 42,
  anchor: { forkAnchorId: 'anchor-1', messageId: 'message-1' },
  anchorInfo: {
    anchorForkId: 'anchor-1',
    anchorMessageId: 'message-1',
    anchorDegraded: false,
    anchorSource: 'explicit' as const,
  },
  runParams: { provider: 'claude' as const, model: 'claude-sonnet-4', effort: 'high' },
  minimized: true,
  messages,
});

const readRaw = (): Record<string, unknown> | null => {
  const raw = window.sessionStorage.getItem(BTW_SNAPSHOT_STORAGE_KEY);
  return raw ? JSON.parse(raw) as Record<string, unknown> : null;
};

beforeEach(() => {
  window.sessionStorage.clear();
  clock = 0;
});

test('a written snapshot reads back with its id, cut point and in-flight row', () => {
  const messages = [
    userRow('u1', 'why does this fail?'),
    assistantRow('a1'),
    row('__streaming_btw-1', {
      kind: 'stream_delta',
      streamChannel: 'text',
      content: 'half an ans',
    }),
  ];

  writeBtwSnapshot(baseSnapshot(messages));
  const snapshot = readBtwSnapshot();

  assert.ok(snapshot);
  assert.equal(snapshot.sessionId, SESSION_ID);
  assert.equal(snapshot.forkSourceSessionId, SOURCE_ID);
  assert.equal(snapshot.lastSeq, 42);
  assert.deepEqual(snapshot.anchor, { forkAnchorId: 'anchor-1', messageId: 'message-1' });
  assert.equal(snapshot.anchorInfo?.anchorSource, 'explicit');
  assert.deepEqual(snapshot.messages.map((message) => message.id), ['u1', 'a1', '__streaming_btw-1']);
  assert.equal(snapshot.messages[2].content, 'half an ans');
  assert.equal(snapshot.truncated, false);
});

test('an outdated, broken or stale entry reads as nothing and is dropped', () => {
  window.sessionStorage.setItem(BTW_SNAPSHOT_STORAGE_KEY, JSON.stringify({ ...baseSnapshot([]), v: 2 }));
  assert.equal(readBtwSnapshot(), null);
  assert.equal(window.sessionStorage.getItem(BTW_SNAPSHOT_STORAGE_KEY), null);

  window.sessionStorage.setItem(BTW_SNAPSHOT_STORAGE_KEY, '{ not json');
  assert.equal(readBtwSnapshot(), null);

  const now = Date.now();
  writeBtwSnapshot(baseSnapshot([userRow('u1')]));
  assert.equal(readBtwSnapshot(now + BTW_SNAPSHOT_MAX_AGE_MS + 1), null);
  assert.equal(window.sessionStorage.getItem(BTW_SNAPSHOT_STORAGE_KEY), null);

  clearBtwSnapshot();
  assert.equal(readBtwSnapshot(), null);
});

test('an oversized transcript loses whole oldest turns and keeps its tail', () => {
  // 100 turns of ~8 KB is well past the 512 KB budget, so the reducer has to
  // cut — and every cut has to land on a question.
  const messages: NormalizedMessage[] = [];
  for (let i = 0; i < 100; i += 1) {
    messages.push(userRow(`u${i}`, filler(4000)));
    messages.push(assistantRow(`a${i}`, filler(4000)));
  }

  const trimmed = trimBtwSnapshotMessages(messages);

  assert.ok(trimmed.length < messages.length, 'something had to be dropped');
  assert.equal(trimmed[0].role, 'user');
  assert.equal(trimmed[0].kind, 'text');
  // The newest turn is never the one sacrificed to the budget.
  assert.equal(trimmed[trimmed.length - 1].id, 'a99');
  assert.ok(JSON.stringify(trimmed).length <= BTW_SNAPSHOT_BUDGET_CHARS);
});

test('the saved flag says the transcript was cut, and stays cut across saves', () => {
  const messages: NormalizedMessage[] = [];
  for (let i = 0; i < 100; i += 1) {
    messages.push(userRow(`u${i}`, filler(4000)));
    messages.push(assistantRow(`a${i}`, filler(4000)));
  }

  assert.equal(writeBtwSnapshot(baseSnapshot(messages)), true);
  const first = readBtwSnapshot();
  assert.ok(first);
  assert.equal(first.truncated, true);

  // Saving the already-trimmed array must not make the next reload believe
  // nothing was lost: the flag is carried, not recomputed from the new array.
  writeBtwSnapshot({ ...baseSnapshot(first.messages), truncated: first.truncated });
  assert.equal(readBtwSnapshot()?.truncated, true);
});

test('a turn that is still too big loses its heavy payloads, not its tool calls', () => {
  const messages = [
    userRow('u1', 'read the image'),
    row('t1', {
      kind: 'tool_use',
      toolName: 'Read',
      toolInput: { file_path: '/tmp/photo.png' },
      images: [{ name: 'photo.png', data: filler(400_000) }],
      toolResult: {
        content: filler(200_000),
        isError: false,
        toolUseResult: { path: '/tmp/photo.png' },
      },
      toolUseResult: { path: '/tmp/photo.png' },
      subagentTools: [{ name: 'Explore', status: 'done' } as never],
      workflow: { name: 'review' } as never,
    }),
  ];

  const trimmed = trimBtwSnapshotMessages(messages);
  const tool = trimmed.find((message) => message.id === 't1');

  assert.ok(tool, 'the tool row itself stays so the card still says what ran');
  assert.deepEqual(tool.images, [{ name: 'photo.png' }]);
  assert.equal(tool.toolResult?.content, '');
  assert.equal(tool.toolResult?.isError, false);
  assert.equal(tool.toolResult?.toolUseResult, undefined);
  assert.equal(tool.toolUseResult, undefined);
  assert.equal(tool.subagentTools, undefined);
  assert.equal(tool.workflow, undefined);
  assert.equal(tool.toolName, 'Read');
  assert.deepEqual(tool.toolInput, { file_path: '/tmp/photo.png' });
});

test('trimming twice changes nothing, even when one turn is over budget alone', () => {
  const messages = [
    userRow('u1', filler(300_000)),
    assistantRow('a1', filler(300_000)),
    userRow('u2', filler(300_000)),
    assistantRow('a2', filler(300_000)),
  ];

  const once = trimBtwSnapshotMessages(messages);
  const twice = trimBtwSnapshotMessages(once);

  assert.deepEqual(twice, once);
  assert.equal(once[once.length - 1].id, 'a2');
});

test('a transcript without a question keeps its rows instead of being cut to nothing', () => {
  const messages = [
    assistantRow('a1', filler(300_000)),
    assistantRow('a2', filler(300_000)),
  ];

  const trimmed = trimBtwSnapshotMessages(messages);

  assert.deepEqual(trimmed.map((message) => message.id), ['a1', 'a2']);
});

test('a full store degrades to metadata only instead of throwing', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  setItem.mockImplementationOnce(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });

  writeBtwSnapshot(baseSnapshot([userRow('u1', filler(1000))]));

  const raw = readRaw();
  assert.ok(raw);
  assert.equal(raw.sessionId, SESSION_ID);
  assert.deepEqual(raw.messages, []);
});

test('the streaming seed is the prose the reload interrupted', () => {
  const seed = extractStreamingSeed([
    userRow('u1'),
    row('__streaming_thinking_btw-1', {
      kind: 'stream_delta',
      streamChannel: 'thinking',
      content: 'thinking so far',
    }),
    row('__streaming_btw-1', {
      kind: 'stream_delta',
      streamChannel: 'text',
      content: 'partial answer',
    }),
  ]);

  assert.deepEqual(seed, { text: 'partial answer', thinking: 'thinking so far', provider: 'claude' });
  assert.equal(extractStreamingSeed([userRow('u1'), assistantRow('a1')]), null);
});

test('the frozen run parameters survive the reload, and an older snapshot reads as none', () => {
  writeBtwSnapshot(baseSnapshot([userRow('u1')]));
  assert.deepEqual(readBtwSnapshot()?.runParams, {
    provider: 'claude',
    model: 'claude-sonnet-4',
    effort: 'high',
  });

  // A tab that saved this snapshot before the field existed still has a usable
  // copy id: the missing parameters must not invalidate the whole entry.
  const { runParams: _dropped, ...legacy } = baseSnapshot([userRow('u1')]);
  window.sessionStorage.setItem(BTW_SNAPSHOT_STORAGE_KEY, JSON.stringify({ ...legacy, v: 1, savedAt: Date.now() }));
  const snapshot = readBtwSnapshot();
  assert.ok(snapshot, 'a legacy snapshot stays restorable');
  assert.equal(snapshot.runParams, null);
});
