import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  OpenCodeForkProvider,
  resolveOpenCodeForkCut,
} from '@/modules/providers/list/opencode/opencode-fork.provider.js';
import type { OpenCodeSessionClient } from '@/modules/providers/list/opencode/opencode-session-client.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { IProviderFork } from '@/shared/interfaces.js';

type ForkRequest = { providerSessionId: string; messageId?: string };

function stubClient(calls: ForkRequest[]): OpenCodeSessionClient {
  return {
    forkSession: async (input: ForkRequest) => {
      calls.push(input);
      return 'native-child';
    },
  } as unknown as OpenCodeSessionClient;
}

// ---------------------------------------------------------------- cut mapping

test('the fork cut lands on the anchor\'s successor so the copy keeps the anchor', () => {
  assert.equal(resolveOpenCodeForkCut(['m1', 'm2', 'm3'], 'm2'), 'm3');
});

test('forking from the last message copies the whole conversation', () => {
  assert.equal(resolveOpenCodeForkCut(['m1', 'm2', 'm3'], 'm3'), undefined);
});

test('an anchor that is no longer in the session is refused rather than guessed', () => {
  assert.throws(
    () => resolveOpenCodeForkCut(['m1', 'm2'], 'gone'),
    (error: Error & { code?: string }) => error.code === 'FORK_ANCHOR_NOT_FOUND',
  );
});

// -------------------------------------------------------------- fork provider

test('the provider maps the anchor through and reports a null artifact', async () => {
  const calls: ForkRequest[] = [];
  const provider = new OpenCodeForkProvider(stubClient(calls), () => ['m1', 'm2', 'm3']);

  const result = await provider.forkSession({
    providerSessionId: 'native-source',
    jsonlPath: null,
    projectPath: '/tmp',
    upToAnchorId: 'm2',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].providerSessionId, 'native-source');
  assert.equal(calls[0].messageId, 'm3');
  assert.deepEqual(result, { providerSessionId: 'native-child', jsonlPath: null });
});

test('forking without an anchor copies the whole session without reading message ids', async () => {
  const calls: ForkRequest[] = [];
  const provider = new OpenCodeForkProvider(stubClient(calls), () => {
    throw new Error('message ids must not be read for a whole-session fork');
  });

  await provider.forkSession({ providerSessionId: 'native-source', jsonlPath: null, projectPath: '/tmp' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].messageId, undefined);
});

test('an anchor at the tail asks for the whole session', async () => {
  const calls: ForkRequest[] = [];
  const provider = new OpenCodeForkProvider(stubClient(calls), () => ['m1', 'm2']);

  await provider.forkSession({
    providerSessionId: 'native-source',
    jsonlPath: null,
    projectPath: '/tmp',
    upToAnchorId: 'm2',
  });

  assert.equal(calls[0].messageId, undefined);
});

test('an unknown anchor is refused before any server is started', async () => {
  const calls: ForkRequest[] = [];
  const provider = new OpenCodeForkProvider(stubClient(calls), () => ['m1', 'm2']);

  await assert.rejects(
    () => provider.forkSession({
      providerSessionId: 'native-source',
      jsonlPath: null,
      projectPath: '/tmp',
      upToAnchorId: 'gone',
    }),
    (error: Error & { code?: string }) => error.code === 'FORK_ANCHOR_NOT_FOUND',
  );
  assert.equal(calls.length, 0);
});

// ----------------------------------------------------------- service contract

async function withDatabase(run: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'opencode-fork-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'app.db');
  await initializeDatabase();
  try {
    await run();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function withStubbedOpenCodeFork(run: () => Promise<void>): Promise<void> {
  const opencode = providerRegistry.resolveProvider('opencode') as { fork?: IProviderFork };
  const realFork = opencode.fork;
  Object.defineProperty(opencode, 'fork', {
    value: {
      forkSession: async () => ({ providerSessionId: 'native-oc-child', jsonlPath: null }),
    } as IProviderFork,
    configurable: true,
    writable: true,
  });
  try {
    await run();
  } finally {
    Object.defineProperty(opencode, 'fork', { value: realFork, configurable: true, writable: true });
  }
}

test('a store-backed session with no transcript file can still be forked', async () => {
  await withDatabase(async () => {
    const now = new Date().toISOString();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'opencode-project-'));
    try {
      // OpenCode indexes sessions into one shared database, so the app row has
      // no jsonl_path — the case the shared guard used to reject outright.
      sessionsDb.createSession('native-oc-source', 'opencode', directory, 'Original', now, now, null);

      await withStubbedOpenCodeFork(async () => {
        const result = await sessionsService.forkSessionById('native-oc-source', { upToAnchorId: 'msg_2' });

        const forked = sessionsDb.getSessionById(result.sessionId);
        assert.ok(forked);
        assert.equal(forked?.provider_session_id, 'native-oc-child');
        assert.equal(forked?.jsonl_path, null);
        assert.equal(forked?.forked_from_session_id, 'native-oc-source');
        assert.equal(forked?.custom_name, 'Original (fork)');
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test('an OpenCode session that never ran cannot be forked', async () => {
  await withDatabase(async () => {
    sessionsDb.createAppSession('oc-never-ran', 'opencode', '/tmp', 'Never ran');

    await assert.rejects(
      () => sessionsService.forkSessionById('oc-never-ran'),
      (error: Error & { code?: string }) => error.code === 'FORK_SOURCE_NOT_READY',
    );
  });
});

test('OpenCode advertises session forking', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('opencode').supportsSessionForking, true);
});
