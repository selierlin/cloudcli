import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';
import { CodexProviderAuth } from '@/modules/providers/list/codex/codex-auth.provider.js';
import { CursorProviderAuth } from '@/modules/providers/list/cursor/cursor-auth.provider.js';
import type { IProviderAuth } from '@/shared/interfaces.js';

// The shared probe runs `<command> --version` through cross-spawn, which reports
// a missing binary on the result instead of throwing, so `installed` has to come
// from that result. Each case is exercised with PATH pointing at a temporary
// directory whose only content is either nothing or a stub launcher, which keeps
// the test independent of the host.
//
// Codex is the exception: chats run the `@openai/codex` package resolved from
// node_modules by the SDK, so a `codex` on PATH is neither required nor
// consulted. It is covered by its own test below.
type ProviderCase = {
  command: string;
  create: () => IProviderAuth;
};

const PROVIDER_CASES: ProviderCase[] = [
  { command: 'cursor-agent', create: () => new CursorProviderAuth() },
  { command: 'claude', create: () => new ClaudeProviderAuth() },
];

/**
 * Runs `fn` with PATH pointing at a temporary directory, restoring PATH and
 * removing the directory afterwards. An explicit CLAUDE_CLI_PATH is cleared so
 * the Claude probe has to resolve its launcher through PATH like the others.
 */
const withPathDir = async (populate: (dir: string) => Promise<void>, fn: () => Promise<void>) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'provider-installed-test-'));
  const originalPath = process.env.PATH;
  const originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;

  try {
    await populate(dir);
    process.env.PATH = dir;
    delete process.env.CLAUDE_CLI_PATH;
    await fn();
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalClaudeCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    }
    await rm(dir, { recursive: true, force: true });
  }
};

// Windows resolves launchers through PATHEXT rather than a shebang script, so
// the stub launcher below only models a real installation on POSIX hosts.
const skipOnWindows = process.platform === 'win32';

for (const { command, create } of PROVIDER_CASES) {
  test(`getStatus: ${command} absent from PATH reports installed false`, async () => {
    await withPathDir(async () => {}, async () => {
      const status = await create().getStatus();

      assert.equal(status.installed, false);
    });
  });

  test(
    `getStatus: ${command} present on PATH reports installed true`,
    { skip: skipOnWindows },
    async () => {
      await withPathDir(
        async (dir) => {
          await writeFile(path.join(dir, command), '#!/bin/sh\necho 1.0.0\n', { mode: 0o755 });
        },
        async () => {
          const status = await create().getStatus();

          assert.equal(status.installed, true);
        },
      );
    },
  );
}

// Codex resolves its launcher from the `@openai/codex` dependency, which the SDK
// loads out of node_modules, so PATH plays no part. Asserting the positive case
// is what pins that contract: a probe that went back to PATH would answer false
// here, and a missing dependency would answer false even with a codex on PATH.
test('getStatus: codex reports installed with no codex on PATH', async () => {
  await withPathDir(async () => {}, async () => {
    const status = await new CodexProviderAuth().getStatus();

    assert.equal(status.installed, true);
  });
});
