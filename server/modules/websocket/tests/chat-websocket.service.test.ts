import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { ChatSessionWriter } from '@/modules/websocket/services/chat-session-writer.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import type { AuthenticatedWebSocketRequest, ProviderRuntimeWriter } from '@/shared/types.js';

type MessageHandler = (message: unknown) => void | Promise<void>;

class FakeConnection {
  readyState = 1;
  frames: Array<Record<string, unknown>> = [];
  private messageHandler: MessageHandler | null = null;

  on(event: string, handler: MessageHandler): void {
    if (event === 'message') {
      this.messageHandler = handler;
    }
  }

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }

  async receive(data: Record<string, unknown>): Promise<void> {
    await this.messageHandler?.(Buffer.from(JSON.stringify(data)));
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-websocket-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('chat WebSocket forwards a WorkBuddy task snapshot and terminal event', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-websocket-workbuddy', 'workbuddy', '/workspace/demo');
    const connection = new FakeConnection();

    const runtime = {
      hasRuntime: (provider: string) => provider === 'workbuddy',
      async run(
        _provider: string,
        _command: string,
        _options: Record<string, unknown>,
        writer: ProviderRuntimeWriter,
      ): Promise<void> {
        writer.send({
          id: 'workbuddy-todo-app-websocket-workbuddy',
          sessionId: 'workbuddy-native-session',
          provider: 'workbuddy',
          kind: 'tool_use',
          toolName: 'TodoList',
          toolInput: { items: [{ id: '1', content: '验证 WebSocket 链路', status: 'completed' }] },
          toolId: 'workbuddy-todo-app-websocket-workbuddy',
        });
        writer.send({
          id: 'workbuddy-complete',
          sessionId: 'workbuddy-native-session',
          provider: 'workbuddy',
          kind: 'complete',
          exitCode: 0,
        });
      },
      async abort(): Promise<boolean> {
        return true;
      },
      resolveToolApproval(): void {},
      getPendingApprovalsForSession(): unknown[] {
        return [];
      },
    };

    handleChatConnection(
      connection as never,
      {} as AuthenticatedWebSocketRequest,
      { runtime },
    );
    await connection.receive({
      type: 'chat.send',
      sessionId: 'app-websocket-workbuddy',
      content: '验证任务',
    });

    assert.deepEqual(connection.frames.map((frame) => frame.kind), ['tool_use', 'complete']);
    assert.equal(connection.frames[0]?.sessionId, 'app-websocket-workbuddy');
    assert.equal(connection.frames[0]?.toolName, 'TodoList');
    assert.equal(connection.frames[0]?.seq, 1);
    assert.equal(connection.frames[1]?.sessionId, 'app-websocket-workbuddy');
    assert.equal(connection.frames[1]?.actualSessionId, 'app-websocket-workbuddy');
    assert.equal(connection.frames[1]?.seq, 2);
  });
});

test('ChatSessionWriter does not log dropped payload contents', () => {
  const connection = new FakeConnection();
  const writer = new ChatSessionWriter({
    connection,
    userId: 1,
    provider: 'workbuddy',
    providerSessionId: null,
    onProviderSessionId: () => {},
    decorateOutboundEvent: (message) => message,
  });
  const diagnostics: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => diagnostics.push(args);

  try {
    writer.send({ secret: 'server-secret-value' });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(connection.frames.length, 0);
  assert.doesNotMatch(JSON.stringify(diagnostics), /server-secret-value/);
  assert.match(JSON.stringify(diagnostics), /payloadType|keys/);
});

test('ChatSessionWriter removes top-level transport credentials but preserves tool output', () => {
  const connection = new FakeConnection();
  const writer = new ChatSessionWriter({
    connection,
    userId: 1,
    provider: 'workbuddy',
    providerSessionId: null,
    onProviderSessionId: () => {},
    decorateOutboundEvent: (message) => message,
  });

  writer.send({
    id: 'outbound-sensitive-fields',
    sessionId: 'native-session',
    timestamp: new Date().toISOString(),
    provider: 'workbuddy',
    kind: 'tool_result',
    content: '正常的工具输出',
    toolResult: { content: '业务结果中的文本' },
    env: { API_KEY: 'server-secret-value' },
    headers: { Authorization: 'Bearer server-secret-value' },
    apiKey: 'server-secret-value',
  });

  assert.equal(connection.frames.length, 1);
  assert.equal(connection.frames[0]?.content, '正常的工具输出');
  assert.deepEqual(connection.frames[0]?.toolResult, { content: '业务结果中的文本' });
  assert.equal(Object.hasOwn(connection.frames[0] as object, 'env'), false);
  assert.equal(Object.hasOwn(connection.frames[0] as object, 'headers'), false);
  assert.equal(Object.hasOwn(connection.frames[0] as object, 'apiKey'), false);
  assert.doesNotMatch(JSON.stringify(connection.frames[0]), /server-secret-value/);
});

test('chat WebSocket preserves WorkBuddy tool and task failure states', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-websocket-workbuddy-failure', 'workbuddy', '/workspace/demo');
    const connection = new FakeConnection();

    const runtime = {
      hasRuntime: (provider: string) => provider === 'workbuddy',
      async run(
        _provider: string,
        _command: string,
        _options: Record<string, unknown>,
        writer: ProviderRuntimeWriter,
      ): Promise<void> {
        writer.send({
          id: 'workbuddy-tool-failure',
          sessionId: 'workbuddy-native-session',
          provider: 'workbuddy',
          kind: 'tool_use',
          toolName: 'Bash',
          toolInput: { command: '失败命令' },
          toolId: 'workbuddy-tool-failure',
          status: 'running',
        });
        writer.send({
          id: 'workbuddy-tool-failure',
          sessionId: 'workbuddy-native-session',
          provider: 'workbuddy',
          kind: 'tool_result',
          toolName: 'Bash',
          toolId: 'workbuddy-tool-failure',
          toolResult: { content: '命令失败', isError: true },
          isError: true,
          status: 'failed',
          isFinal: true,
        });
        writer.send({
          id: 'workbuddy-task-failure',
          sessionId: 'workbuddy-native-session',
          provider: 'workbuddy',
          kind: 'task_notification',
          toolName: 'Task',
          status: 'failed',
          summary: '任务执行失败',
          isFinal: true,
        });
        writer.send({
          id: 'workbuddy-error',
          sessionId: 'workbuddy-native-session',
          provider: 'workbuddy',
          kind: 'error',
          content: '任务执行失败',
          isError: true,
        });
        writer.send({
          id: 'workbuddy-complete-failure',
          sessionId: 'workbuddy-native-session',
          provider: 'workbuddy',
          kind: 'complete',
          exitCode: 1,
        });
      },
      async abort(): Promise<boolean> {
        return true;
      },
      resolveToolApproval(): void {},
      getPendingApprovalsForSession(): unknown[] {
        return [];
      },
    };

    handleChatConnection(
      connection as never,
      {} as AuthenticatedWebSocketRequest,
      { runtime },
    );
    await connection.receive({
      type: 'chat.send',
      sessionId: 'app-websocket-workbuddy-failure',
      content: '执行失败场景',
    });

    assert.deepEqual(connection.frames.map((frame) => frame.kind), [
      'tool_use',
      'tool_result',
      'task_notification',
      'error',
      'complete',
    ]);
    assert.equal(connection.frames[1]?.isError, true);
    assert.equal(connection.frames[1]?.status, 'failed');
    assert.equal(connection.frames[2]?.status, 'failed');
    assert.equal(connection.frames[3]?.isError, true);
    assert.equal(connection.frames[4]?.exitCode, 1);
    assert.deepEqual(connection.frames.map((frame) => frame.seq), [1, 2, 3, 4, 5]);
  });
});

test('chat WebSocket converts an active WorkBuddy abort into one stopped terminal event', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-websocket-workbuddy-abort', 'workbuddy', '/workspace/demo');
    const connection = new FakeConnection();
    let releaseRun: (() => void) | null = null;
    const runBlocked = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });

    const runtime = {
      hasRuntime: (provider: string) => provider === 'workbuddy',
      async run(): Promise<void> {
        await runBlocked;
      },
      async abort(): Promise<boolean> {
        releaseRun?.();
        return true;
      },
      resolveToolApproval(): void {},
      getPendingApprovalsForSession(): unknown[] {
        return [];
      },
    };

    handleChatConnection(
      connection as never,
      {} as AuthenticatedWebSocketRequest,
      { runtime },
    );
    const sendPromise = connection.receive({
      type: 'chat.send',
      sessionId: 'app-websocket-workbuddy-abort',
      content: '执行可取消任务',
    });

    // Let chat.send register the run before sending chat.abort on the same socket.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await connection.receive({
      type: 'chat.abort',
      sessionId: 'app-websocket-workbuddy-abort',
    });
    await sendPromise;

    assert.deepEqual(connection.frames.map((frame) => frame.kind), ['complete']);
    assert.equal(connection.frames[0]?.aborted, true);
    assert.equal(connection.frames[0]?.exitCode, 0);
    assert.equal(connection.frames[0]?.seq, 1);
  });
});
