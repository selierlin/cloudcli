import assert from 'node:assert/strict';

import { test } from 'vitest';

import { MCP_PROVIDER_NAMES } from '@/shared/constants';
import type { McpGlobalImpactEntry, McpProvider } from '@/shared/types';
import { getGlobalMcpImpact } from '@/modules/mcp/utils/mcpGlobalImpact';

const supportedProviders = (impact: McpGlobalImpactEntry[]): McpProvider[] => (
  impact.filter((entry) => entry.supported).map((entry) => entry.provider)
);

const skipReason = (impact: McpGlobalImpactEntry[], provider: McpProvider) => {
  const entry = impact.find((candidate) => candidate.provider === provider);
  return entry && !entry.supported ? entry.reason : undefined;
};

test('getGlobalMcpImpact: reports every MCP provider in the canonical provider order', () => {
  const impact = getGlobalMcpImpact('project', 'stdio');

  assert.deepEqual(impact.map((entry) => entry.provider), Object.keys(MCP_PROVIDER_NAMES));
});

test('getGlobalMcpImpact: excludes providers that manage their own MCP or have none', () => {
  const impact = getGlobalMcpImpact('project', 'stdio');

  assert.equal(skipReason(impact, 'dsh'), 'harnessManaged');
  assert.equal(skipReason(impact, 'pi'), 'noNativeSupport');
  assert.deepEqual(
    supportedProviders(impact),
    ['claude', 'cursor', 'codex', 'opencode', 'workbuddy', 'zcode'],
  );
});

test('getGlobalMcpImpact: skips providers that do not accept the chosen transport', () => {
  const impact = getGlobalMcpImpact('project', 'sse');

  assert.deepEqual(supportedProviders(impact), ['claude', 'workbuddy', 'zcode']);
  for (const provider of ['cursor', 'codex', 'opencode'] as const) {
    assert.equal(skipReason(impact, provider), 'transportUnsupported');
  }
});

test('getGlobalMcpImpact: skips providers that do not accept the chosen scope', () => {
  const impact = getGlobalMcpImpact('local', 'http');

  assert.deepEqual(supportedProviders(impact), ['claude', 'workbuddy']);
  for (const provider of ['cursor', 'codex', 'opencode', 'zcode'] as const) {
    assert.equal(skipReason(impact, provider), 'scopeUnsupported');
  }
});
