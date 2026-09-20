import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseDshMcpServerConfigs,
  readDshComposedMcpServerConfigs,
} from '@/modules/providers/list/dsh/dsh-cordis.provider.js';
import { DshMcpProvider } from '@/modules/providers/list/dsh/dsh-mcp.provider.js';

/**
 * DSH keeps its MCP servers inside its own composition, so the app lists them
 * read-only from the composed tree `dsh --profile acp --dump-config` prints.
 * These tests pin the parsing against recorded serializer output, then cover
 * the degradation path and, when the CLI is installed, the whole read path from
 * a composed patch layer to the sanitized response entries.
 */

/** The CLI is an external prerequisite: skip the end-to-end case when it is absent instead of failing. */
const DSH_INSTALLED = spawnSync('dsh', ['--version']).status === 0;

/** Recorded shape of the dump: provenance comments, quoted package names, folded scalars and `!!js` expressions. */
const COMPOSED_DUMP = `# == @deepseek-ai/dsh-base
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
- id: acp
  name: '@deepseek-ai/dsh-acp'
  inject:
    - acpAppStartup
  config:
    provider: volcano-ark
    model: deepseek-v4-flash
- id: session-telemetry-otel
  name: '@deepseek-ai/dsh-session-telemetry-otel'
  config:
    mode: !!js process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'
    exporter:
      url: !!js >-
        process.env.DSH_TELEMETRY_OTLP_URL ??
        'https://example.com/v1/logs'
      retry:
        - 1000
        - 5000
# == /home/dev/.dsh/cordis.patch.yml
- id: mcp-dbhub
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: dbhub
    transport: streamable-http
    url: http://127.0.0.1:8880/mcp
    headers: {}
- id: mcp-openviking
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: openviking
    transport: streamable-http
    url: https://ov.example.com/mcp
    headers:
      Authorization: >-
        Bearer
        dG9rZW4tdmFsdWU
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args:
      - '-y'
      - '@modelcontextprotocol/server-github'
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN
- id: mcp-disabled
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: true
  config:
    serverName: disabled
    transport: stdio
    command: node
- id: mcp-unknown-transport
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: weird
    transport: websocket
    url: ws://example.com/mcp
`;

/** Runs a test body with `DSH_HOME` pointed at a fresh temp directory. */
async function withDshHome(
  cordisPatch: string | null,
  runTest: (dshHome: string) => void | Promise<void>,
): Promise<void> {
  const previousDshHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-mcp-test-'));
  process.env.DSH_HOME = dshHome;
  if (cordisPatch !== null) {
    await writeFile(path.join(dshHome, 'cordis.patch.yml'), cordisPatch, 'utf8');
  }

  try {
    await runTest(dshHome);
  } finally {
    if (previousDshHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousDshHome;
    }
    await rm(dshHome, { recursive: true, force: true });
  }
}

test('keeps only the MCP client entries, keyed by server name', () => {
  const configs = parseDshMcpServerConfigs(COMPOSED_DUMP);

  assert.deepEqual(Object.keys(configs), ['dbhub', 'openviking', 'github', 'weird']);

  const dbhub = configs.dbhub as Record<string, unknown>;
  assert.equal(dbhub.transport, 'streamable-http');
  assert.equal(dbhub.url, 'http://127.0.0.1:8880/mcp');
});

test('joins folded scalars and keeps harness-side expressions verbatim', () => {
  const configs = parseDshMcpServerConfigs(COMPOSED_DUMP);

  const openviking = configs.openviking as Record<string, unknown>;
  assert.deepEqual(openviking.headers, { Authorization: 'Bearer dG9rZW4tdmFsdWU' });

  const github = configs.github as Record<string, unknown>;
  assert.equal(github.command, 'npx');
  assert.deepEqual(github.args, ['-y', '@modelcontextprotocol/server-github']);
  assert.deepEqual(github.env, { GITHUB_TOKEN: 'process.env.GITHUB_TOKEN' });
});

test('reads disabled entries and non-MCP plugins as absent', () => {
  const configs = parseDshMcpServerConfigs(COMPOSED_DUMP);

  assert.equal(configs.disabled, undefined);
  assert.equal(configs.timer, undefined);
  assert.equal(configs.acp, undefined);
});

test('keeps scanning past entries that hold tagged and block scalars', () => {
  // `!!js >-` and a list nested under a config key both sit before the MCP
  // entries in a real profile; misreading either one drops everything after it,
  // which is how the read path silently reported no servers at all.
  const telemetryOnly = COMPOSED_DUMP.split('# == /home/dev/.dsh/cordis.patch.yml')[0];

  assert.deepEqual(Object.keys(parseDshMcpServerConfigs(COMPOSED_DUMP)), [
    'dbhub',
    'openviking',
    'github',
    'weird',
  ]);
  assert.deepEqual(parseDshMcpServerConfigs(telemetryOnly), {});
});

test('returns no servers for input that is not a composed entry list', () => {
  for (const document of ['', '\n# only comments\n', '[]\n', 'not: a sequence\n', '- just-a-scalar\n']) {
    assert.deepEqual(parseDshMcpServerConfigs(document), {}, `document: ${JSON.stringify(document)}`);
  }
});

test('reports no servers when the CLI cannot be started', async () => {
  await withDshHome(null, async () => {
    const previousPath = process.env.PATH;
    process.env.PATH = '';
    try {
      assert.deepEqual(readDshComposedMcpServerConfigs(), {});
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

test('lists the servers the harness composes for the booted profile', { skip: !DSH_INSTALLED }, async () => {
  await withDshHome(`
- insert:
    - id: mcp-internal-http
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: internal
        transport: streamable-http
        url: http://127.0.0.1:8880/mcp
        headers:
          Authorization: 'Bearer secret-token'
    - id: mcp-internal-stdio
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: files
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem']
    - id: mcp-internal-off
      name: '@deepseek-ai/dsh-mcp-client'
      disabled: true
      config:
        serverName: off
        transport: stdio
        command: node
`, async () => {
    const provider = new DshMcpProvider();

    const servers = await provider.listServersForScope('user');
    assert.deepEqual(servers.map((server) => server.name), ['internal', 'files']);

    const [http, stdio] = servers;
    assert.equal(http.transport, 'http');
    assert.equal(http.scope, 'user');
    assert.equal(http.url, 'http://127.0.0.1:8880/mcp');
    // Secrets never leave the process, even though the harness config holds them.
    assert.deepEqual(http.headers, { Authorization: '<redacted>' });

    assert.equal(stdio.transport, 'stdio');
    assert.equal(stdio.command, 'npx');
    assert.deepEqual(stdio.args, ['-y', '@modelcontextprotocol/server-filesystem']);

    // DSH has no per-project MCP scope, so project listings stay empty instead
    // of repeating the same servers once per workspace.
    assert.deepEqual(await provider.listServersForScope('project'), []);
  });
});
