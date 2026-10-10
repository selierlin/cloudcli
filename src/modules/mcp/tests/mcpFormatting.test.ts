import assert from 'node:assert/strict';

import { test } from 'vitest';

import { MCP_CATALOG_FORM_PROVIDER } from '@/shared/constants';
import type { McpFormState, ProviderMcpServer } from '@/shared/types';
import { createJsonInputFromServer, parseJsonMcpPayload } from '@/modules/mcp/utils/mcpFormatting';

const formWithJson = (jsonInput: string): McpFormState => ({
  name: 'grafana',
  scope: 'user',
  workspacePath: '',
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
  cwd: '',
  url: '',
  headers: {},
  envVars: [],
  bearerTokenEnvVar: '',
  envHttpHeaders: {},
  importMode: 'json',
  jsonInput,
});

test('createJsonInputFromServer: renders a stdio server the submit parser round-trips', () => {
  const server: ProviderMcpServer = {
    provider: 'claude',
    name: 'grafana',
    scope: 'user',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-grafana', '--disable-write'],
    env: { GRAFANA_URL: '<redacted>', GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE: '<redacted>' },
    cwd: '.',
  };

  const json = createJsonInputFromServer(server);
  const rendered = JSON.parse(json);
  assert.equal(rendered.type, 'stdio');
  assert.equal(rendered.command, 'uvx');
  assert.deepEqual(rendered.args, ['mcp-grafana', '--disable-write']);
  assert.deepEqual(rendered.env, { GRAFANA_URL: '<redacted>', GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE: '<redacted>' });
  assert.equal(rendered.cwd, '.');

  // The redaction marker must survive the round-trip verbatim so the API can
  // restore the stored secret on save instead of persisting the placeholder.
  const payload = parseJsonMcpPayload(MCP_CATALOG_FORM_PROVIDER, formWithJson(json), {
    supportedTransports: ['stdio', 'http', 'sse'],
    supportsWorkingDirectory: true,
    includeProviderSpecificFields: true,
  });
  assert.equal(payload.transport, 'stdio');
  assert.equal(payload.command, 'uvx');
  assert.deepEqual(payload.args, ['mcp-grafana', '--disable-write']);
  assert.deepEqual(payload.env, { GRAFANA_URL: '<redacted>', GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE: '<redacted>' });
});

test('createJsonInputFromServer: renders an http server with url and headers', () => {
  const server: ProviderMcpServer = {
    provider: 'claude',
    name: 'github',
    scope: 'user',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: '<redacted>', 'X-MCP-Readonly': 'true' },
  };

  const rendered = JSON.parse(createJsonInputFromServer(server));
  assert.equal(rendered.type, 'http');
  assert.equal(rendered.url, 'https://api.githubcopilot.com/mcp/');
  assert.deepEqual(rendered.headers, { Authorization: '<redacted>', 'X-MCP-Readonly': 'true' });
  assert.equal(rendered.command, undefined);
});
