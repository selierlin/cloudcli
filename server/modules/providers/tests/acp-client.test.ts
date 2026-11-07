import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { AcpClient } from '@/modules/providers/shared/acp/acp.client.js';

/**
 * The client is exercised against a fake ACP child rather than a real
 * `dsh`/`openclaw` binary: the assertion is about the JSON-RPC wiring (which
 * frames are answered, and with what), not about the conversation behind it.
 */
const MOCK_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'acp-client-mock.mjs',
);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `read` until it returns a value, so the assertion does not race the child. */
async function waitFor<T>(read: () => T | undefined, timeoutMs = 4_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the mock ACP child');
    }
    await sleep(10);
  }
}

test('a server request for an unimplemented method is answered with -32601, not dropped', async () => {
  const child = spawn(process.execPath, [MOCK_SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks: string[] = [];
  const client = new AcpClient(child, {
    onMessageChunk: (_sessionId, text) => chunks.push(text),
    onRequestPermission: () => {},
  });

  try {
    // The mock sends its unsupported request under the *same* id as the pending
    // `initialize`, so this also proves a method-bearing frame is never consumed
    // as the answer to a client request: had it been, `initialize` would resolve
    // with `undefined` and no reply would ever reach the child.
    const initResult = await client.initialize() as { protocolVersion?: number };
    assert.equal(initResult.protocolVersion, 1, 'the initialize reply is resolved from its own frame');

    const reply = await waitFor(() => chunks[0]);
    assert.equal(
      reply,
      'rejected:-32601:Method not found: session/fs/read_text_file',
      'an unimplemented server request must come back as a JSON-RPC -32601 error',
    );
  } finally {
    client.close();
  }
});

const PROMPT_MOCK_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'acp-prompt-mock.mjs',
);

test('prompt sends a plain string as one text block and a block list verbatim', async () => {
  const child = spawn(process.execPath, [PROMPT_MOCK_SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks: string[] = [];
  const client = new AcpClient(child, {
    onMessageChunk: (_sessionId, text) => chunks.push(text),
    onRequestPermission: () => {},
  });

  try {
    await client.prompt('acp-1', 'hello');
    assert.deepEqual(JSON.parse(await waitFor(() => chunks[0])), [{ type: 'text', text: 'hello' }]);

    const blocks = [
      { type: 'text' as const, text: 'what is this' },
      { type: 'image' as const, mimeType: 'image/png', data: 'AAAA' },
      { type: 'resource_link' as const, name: 'notes.pdf', uri: 'file:///tmp/notes.pdf' },
    ];
    const { stopReason } = await client.prompt('acp-1', blocks);
    assert.equal(stopReason, 'end_turn');
    assert.deepEqual(JSON.parse(await waitFor(() => chunks[1])), blocks);
  } finally {
    client.close();
  }
});

const CANCEL_MOCK_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'acp-cancel-mock.mjs',
);

test('a cancel the agent never honours still ends the turn without closing the child', async () => {
  const child = spawn(process.execPath, [CANCEL_MOCK_SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks: string[] = [];
  const client = new AcpClient(child, {
    onMessageChunk: (_sessionId, text) => chunks.push(text),
    onRequestPermission: () => {},
  }, { cancelSettleTimeoutMs: 50 });

  try {
    const turn = client.prompt('acp-1', 'ignore-cancel');
    await waitFor(() => chunks[0]);

    assert.equal(client.cancel('acp-1'), true);
    assert.equal(
      (await turn).stopReason,
      'cancelled',
      'an ignored cancel must not leave the turn pending until the prompt timeout',
    );
    assert.equal(client.isClosed, false, 'settling locally must not close the shared child');
  } finally {
    client.close();
  }
});

test('cancel reports when the notification never reached the child', () => {
  const child = spawn(process.execPath, [CANCEL_MOCK_SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new AcpClient(child, {
    onMessageChunk: () => {},
    onRequestPermission: () => {},
  });

  client.close();
  assert.equal(client.cancel('acp-1'), false, 'a closed connection cannot deliver the cancel');
});

test('cancel is a notification: the turn ends cancelled and the connection stays open', async () => {
  const child = spawn(process.execPath, [CANCEL_MOCK_SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks: string[] = [];
  const client = new AcpClient(child, {
    onMessageChunk: (_sessionId, text) => chunks.push(text),
    onRequestPermission: () => {},
  });

  try {
    const turn = client.prompt('acp-1', 'hold');
    await waitFor(() => chunks[0]);

    assert.equal(client.cancel('acp-1'), true);

    assert.equal((await turn).stopReason, 'cancelled', 'the in-flight prompt settles as cancelled');
    const echo = await waitFor(() => chunks.find((text) => text.startsWith('cancel:')));
    const frame = JSON.parse(echo.slice('cancel:'.length)) as Record<string, unknown>;
    assert.equal(frame.method, 'session/cancel');
    assert.equal('id' in frame, false, 'an id turns the cancel into a request the agent answers -32601');
    assert.deepEqual(frame.params, { sessionId: 'acp-1' });
    assert.equal(
      client.isClosed,
      false,
      'one child serves every session, so cancelling one must never close the connection',
    );
  } finally {
    client.close();
  }
});
