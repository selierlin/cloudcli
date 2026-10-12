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
