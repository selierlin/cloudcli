import assert from 'node:assert/strict';

import { act, render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { McpProject, McpProvider } from '@/shared/types';
import { invalidateMcpServersCache, useMcpServers } from '@/modules/mcp/hooks/useMcpServers';

/**
 * The per-harness page reads its servers through a module-private 30s cache. The
 * MCP matrix writes the same config files, so the exported invalidation is the
 * only thing that keeps that page honest — and it is asserted here by mounting
 * the real hook and counting its requests, because the cache itself is private.
 */

const mocks = vi.hoisted(() => ({
  mcpServers: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock('@/shared/api', () => ({
  api: { providers: { mcpServers: (...args: unknown[]) => mocks.mcpServers(...args) } },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}));

// One stable array: the hook keys its cache off the project list, so a fresh
// `[]` per render would re-run its load effect forever.
const NO_PROJECTS: McpProject[] = [];

/** Mounts the real hook only to populate and observe its module cache. */
function Probe({ provider }: { provider: McpProvider }) {
  useMcpServers({ selectedProvider: provider, currentProjects: NO_PROJECTS });
  return null;
}

/** Lets the hook's load settle; a cache hit issues no request at all. */
const settle = () => act(async () => {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
});

/** Counts the requests one fresh mount makes for `provider`. */
async function readsForMount(provider: McpProvider): Promise<number> {
  const before = mocks.mcpServers.mock.calls.length;
  const { unmount } = render(<Probe provider={provider} />);
  await settle();
  unmount();
  return mocks.mcpServers.mock.calls.length - before;
}

beforeEach(() => {
  mocks.mcpServers.mockReset();
  mocks.mcpServers.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: { provider: 'claude', scope: 'user', servers: [{ name: 'notion' }] },
    }),
  });
  // The cache is module state shared by every test in this file.
  invalidateMcpServersCache();
});

test('serves a repeated mount from the module cache', async () => {
  assert.equal(await readsForMount('claude'), 1);
  assert.equal(await readsForMount('claude'), 0, 'the second mount should not refetch');
});

test('drops only the harness it names', async () => {
  assert.equal(await readsForMount('claude'), 1);

  invalidateMcpServersCache('codex');
  assert.equal(await readsForMount('claude'), 0, 'another harness must not evict this one');

  invalidateMcpServersCache('claude');
  assert.equal(await readsForMount('claude'), 1);
});

test('clears every harness when no harness is named', async () => {
  assert.equal(await readsForMount('claude'), 1);
  assert.equal(await readsForMount('codex'), 1);

  invalidateMcpServersCache();

  assert.equal(await readsForMount('claude'), 1);
  assert.equal(await readsForMount('codex'), 1);
});
