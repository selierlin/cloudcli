import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import {
  configureSessionPresence,
  forgetConnection,
  watchSession,
} from '@/modules/websocket/services/session-presence.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * Who is watching a session decides when an aside copy may be reclaimed.
 *
 * The two properties that keep this safe are both invisible from the outside:
 * a session watched by several sockets is idle only when the *last* one leaves,
 * and a socket that comes back inside the grace period cancels the reclaim —
 * otherwise a reconnect would delete the transcript under an open drawer.
 */

const GRACE_MS = 20;

const delay = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Record<string, unknown>);
  return socket;
}

test('a session is idle only when its last watcher leaves', async () => {
  const idle: string[] = [];
  configureSessionPresence({ graceMs: GRACE_MS, onIdle: (sessionId) => idle.push(sessionId) });

  try {
    const firstTab = {};
    const secondTab = {};
    watchSession(firstTab, 'aside-1');
    watchSession(secondTab, 'aside-1');

    forgetConnection(firstTab);
    await delay(GRACE_MS * 4);
    assert.deepEqual(idle, [], 'the second tab still watches the copy');

    forgetConnection(secondTab);
    await delay(GRACE_MS * 4);
    assert.deepEqual(idle, ['aside-1']);
  } finally {
    configureSessionPresence(null);
  }
});

test('a socket that re-subscribes inside the grace period cancels the reclaim', async () => {
  const idle: string[] = [];
  configureSessionPresence({ graceMs: GRACE_MS, onIdle: (sessionId) => idle.push(sessionId) });

  try {
    const droppedTab = {};
    watchSession(droppedTab, 'aside-1');
    forgetConnection(droppedTab);

    // Represents the reconnecting tab: same session, new socket.
    watchSession({}, 'aside-1');
    await delay(GRACE_MS * 4);

    assert.deepEqual(idle, [], 'a re-subscribe must cancel the pending reclaim');
  } finally {
    configureSessionPresence(null);
  }
});

test('every session a closed socket watched goes idle, and only once', async () => {
  const idle: string[] = [];
  configureSessionPresence({ graceMs: GRACE_MS, onIdle: (sessionId) => idle.push(sessionId) });

  try {
    const tab = {};
    watchSession(tab, 'aside-1');
    watchSession(tab, 'aside-2');
    // A duplicate subscribe (session switch back and forth) must not queue a
    // second notification for the same session.
    watchSession(tab, 'aside-1');

    forgetConnection(tab);
    forgetConnection(tab);
    await delay(GRACE_MS * 4);

    assert.deepEqual(idle.sort(), ['aside-1', 'aside-2']);
  } finally {
    configureSessionPresence(null);
  }
});

test('a chat socket becomes a watcher on subscribe and stops on close', async () => {
  await withIsolatedDatabase(async () => {
    const idle: string[] = [];
    configureSessionPresence({ graceMs: GRACE_MS, onIdle: (sessionId) => idle.push(sessionId) });

    try {
      const socket = createFakeSocket();
      handleChatConnection(
        socket as never,
        { user: { id: 1 } } as never,
        {
          runtime: {
            hasBackgroundWork: () => false,
            getPendingApprovalsForSession: () => [],
          },
        } as never,
      );

      socket.emit('message', JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId: 'aside-9', lastSeq: 0 }] }));
      await delay(GRACE_MS * 4);
      assert.deepEqual(idle, [], 'a subscribed session is not idle');

      socket.emit('close');
      await delay(GRACE_MS * 4);
      assert.deepEqual(idle, ['aside-9']);
    } finally {
      connectedClients.clear();
      configureSessionPresence(null);
    }
  });
});

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-presence-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
