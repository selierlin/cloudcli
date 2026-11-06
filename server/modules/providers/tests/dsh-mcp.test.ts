import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  invalidateDshComposedDocument,
  parseDshMcpServerConfigs,
  readDshComposedMcpServers,
  splitDshMcpServerConfigs,
} from '@/modules/providers/list/dsh/dsh-cordis.provider.js';
import {
  applyDshHomePatchEntryConfig,
  applyDshHomePatchEntryRemoval,
  applyDshManagedMcpBlock,
  DshMcpProvider,
  readDshHomePatchEntries,
} from '@/modules/providers/list/dsh/dsh-mcp.provider.js';

/**
 * DSH mounts MCP servers from its Cordis composition, so the app reads them
 * from the tree `dsh --profile acp --dump-config` prints and writes them into a
 * marked block of the machine-level patch layer that outranks every profile.
 * These tests pin the parsing against recorded serializer output, pin the
 * block writer's byte-preservation rules, and — when the CLI is installed —
 * cover the whole write path from a patch layer back through a fresh dump.
 */

/** The CLI is an external prerequisite: skip the end-to-end cases when it is absent instead of failing. */
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

/** A patch layer the user wrote by hand: the writer must never rewrite these bytes. */
const USER_PATCH = `# my own overrides
- insert:
    - id: mcp-mine
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: mine
        transport: streamable-http
        url: http://127.0.0.1:9999/mcp
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
  // Each case owns a fresh home; a dump cached for the previous one would
  // describe another directory's patch layer.
  invalidateDshComposedDocument();

  try {
    await runTest(dshHome);
  } finally {
    invalidateDshComposedDocument();
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

test('separates the entries CloudCLI owns from the ones the harness supplies', () => {
  const { all, managed } = splitDshMcpServerConfigs({
    'mcp-dbhub': { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'dbhub', transport: 'stdio' } },
    'cloudcli-mcp-own-abc123': { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'own', transport: 'stdio' } },
  });

  assert.deepEqual(Object.keys(all).sort(), ['dbhub', 'own']);
  assert.deepEqual(Object.keys(managed), ['own']);
});

test('reports no servers when the CLI cannot be started', async () => {
  await withDshHome(null, async () => {
    const previousPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const composed = readDshComposedMcpServers();
      assert.equal(composed.ok, false);
      assert.deepEqual(composed, { ok: false, all: {}, managed: {} });
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

test('refuses to rewrite the managed block when the CLI cannot dump', async () => {
  // The dump is the only source of "which entries does CloudCLI own"; without it
  // the writer would rebuild the block from an empty map and delete every entry
  // it was asked to preserve. The gate must fail the request and leave the file
  // byte-identical rather than treat the failure as an empty server list.
  const patch = applyDshManagedMcpBlock(USER_PATCH, {
    kept: { serverName: 'kept', transport: 'stdio', command: 'node' },
  });

  await withDshHome(patch, async (dshHome) => {
    const patchPath = path.join(dshHome, 'cordis.patch.yml');
    const previousPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const provider = new DshMcpProvider();
      const isUnreadable = (error: unknown) =>
        (error as { code?: string } | null)?.code === 'DSH_MCP_UNREADABLE';

      await assert.rejects(
        provider.upsertServer({
          name: 'added',
          scope: 'user',
          transport: 'http',
          url: 'http://127.0.0.1:7777/mcp',
        }),
        isUnreadable,
      );
      await assert.rejects(provider.removeServer({ name: 'kept', scope: 'user' }), isUnreadable);
      assert.equal(await readFile(patchPath, 'utf8'), patch);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

test('appends the managed block after the user content and preserves every byte around it', () => {
  const rendered = applyDshManagedMcpBlock(USER_PATCH, {
    added: { serverName: 'added', transport: 'streamable-http', url: 'http://127.0.0.1:7777/mcp' },
  });

  assert.ok(rendered.startsWith(USER_PATCH), 'the user content must stay untouched');
  assert.match(rendered, /^# >>> cloudcli:mcp begin/m);
  assert.match(rendered, /^# <<< cloudcli:mcp end/m);
  assert.match(rendered, /id: cloudcli-mcp-added-[0-9a-f]{6}/);
  assert.match(rendered, /serverName: "added"/);
  // The guard keeps the entry out of every profile CloudCLI does not boot.
  assert.match(rendered, /disabled: !!js '!\["acp","web"\]\.includes/);

  // Rewriting the same servers is a no-op, so an unchanged list does not churn
  // the file (and therefore does not dirty a dotfiles checkout on every save).
  assert.equal(applyDshManagedMcpBlock(rendered, {
    added: { serverName: 'added', transport: 'streamable-http', url: 'http://127.0.0.1:7777/mcp' },
  }), rendered);
});

test('replaces the block in place and restores the original bytes when it is emptied', () => {
  const once = applyDshManagedMcpBlock(USER_PATCH, {
    a: { serverName: 'a', transport: 'stdio', command: 'node' },
  });
  const twice = applyDshManagedMcpBlock(once, {
    a: { serverName: 'a', transport: 'stdio', command: 'node' },
    b: { serverName: 'b', transport: 'stdio', command: 'node' },
  });

  assert.equal(twice.match(/# >>> cloudcli:mcp begin/g)?.length, 1);
  assert.ok(twice.startsWith(USER_PATCH));

  assert.equal(applyDshManagedMcpBlock(twice, {}), USER_PATCH);
});

test('rewrites only the config body of a user entry, keeping its id, options and comments', () => {
  const patch = `# my own overrides
- insert:
    # the servers I run myself
    - id: mcp-mine
      name: '@deepseek-ai/dsh-mcp-client'
      disabled: !!js "ctx.get('profileContext')?.name === 'probe'"
      config:
        serverName: mine
        transport: streamable-http
        url: http://127.0.0.1:9999/mcp
        headers:
          Authorization: 'Bearer old'
`;

  const entries = readDshHomePatchEntries(patch);
  assert.deepEqual(entries.map((entry) => entry.name), ['mine']);

  const edited = applyDshHomePatchEntryConfig(patch, 'mine', {
    serverName: 'mine',
    transport: 'streamable-http',
    url: 'http://127.0.0.1:1234/mcp',
    headers: { Authorization: 'Bearer new' },
  });

  // The item's identity and its loader guard are bytes CloudCLI never renders,
  // so they have to survive untouched; only the mapping under `config:` moves.
  assert.equal(edited, `# my own overrides
- insert:
    # the servers I run myself
    - id: mcp-mine
      name: '@deepseek-ai/dsh-mcp-client'
      disabled: !!js "ctx.get('profileContext')?.name === 'probe'"
      config:
        serverName: "mine"
        transport: "streamable-http"
        url: "http://127.0.0.1:1234/mcp"
        headers:
          "Authorization": "Bearer new"
`);

  assert.equal(applyDshHomePatchEntryConfig(patch, 'absent', {}), null);
});

test('leaves the managed block out of the user-entry scan and removes an entry with its own comment', () => {
  const withBlock = applyDshManagedMcpBlock(USER_PATCH, {
    added: { serverName: 'added', transport: 'stdio', command: 'node' },
  });
  assert.deepEqual(readDshHomePatchEntries(withBlock).map((entry) => entry.name), ['mine']);

  // The file-level comment is at the list's own indent, not the item's, so it is
  // not part of the entry and stays behind.
  assert.equal(applyDshHomePatchEntryRemoval(USER_PATCH, 'mine'), '# my own overrides\n- insert:\n');
});

test('writes a new server, edits a user entry in place, and restores the file on delete', {
  skip: !DSH_INSTALLED,
}, async () => {
  await withDshHome(USER_PATCH, async (dshHome) => {
    const patchPath = path.join(dshHome, 'cordis.patch.yml');
    const provider = new DshMcpProvider();

    // Every entry in this file is now reachable: the user's own rows are edited
    // where they are, so nothing here is reported as externally managed.
    assert.deepEqual(provider.listExternallyManagedNames(), []);

    const saved = await provider.upsertServer({
      name: 'added',
      scope: 'user',
      transport: 'http',
      url: 'http://127.0.0.1:7777/mcp',
    });
    assert.equal(saved.name, 'added');
    assert.equal(saved.transport, 'http');

    const composed = readDshComposedMcpServers();
    assert.equal(composed.ok, true);
    assert.deepEqual(Object.keys(composed.managed), ['added']);
    assert.deepEqual(Object.keys(composed.all).sort(), ['added', 'mine']);

    // The listed rows name where each definition lives, so the settings list can
    // tell the user's hand-written entry from the one the matrix owns.
    const listed = await provider.listServersForScope('user');
    assert.deepEqual(
      listed.map((server) => [server.name, server.origin]).sort(),
      [['added', 'app'], ['mine', 'homePatch']],
    );

    // The new server went into the marked block, not into the user's own entry.
    const written = await readFile(patchPath, 'utf8');
    assert.ok(written.startsWith(USER_PATCH));

    // Editing the user's entry keeps it in place: same loader id, new endpoint.
    const edited = await provider.upsertServer({
      name: 'mine',
      scope: 'user',
      transport: 'http',
      url: 'http://127.0.0.1:1234/mcp',
    });
    assert.equal(edited.url, 'http://127.0.0.1:1234/mcp');

    const afterEdit = await readFile(patchPath, 'utf8');
    assert.match(afterEdit, /- id: mcp-mine/);
    assert.match(afterEdit, /url: "http:\/\/127\.0\.0\.1:1234\/mcp"/);
    assert.doesNotMatch(afterEdit, /9999/);

    const reread = readDshComposedMcpServers();
    assert.equal((reread.all.mine as { url?: string }).url, 'http://127.0.0.1:1234/mcp');
    // It is still the user's entry, not a copy CloudCLI now owns.
    assert.equal(reread.managed.mine, undefined);

    assert.deepEqual(await provider.removeServer({ name: 'added', scope: 'user' }), {
      removed: true,
      provider: 'dsh',
      name: 'added',
      scope: 'user',
    });
    // Deleting the user's entry deletes the definition itself; there is nothing
    // left to project into, so the switch and the file agree.
    assert.deepEqual(await provider.removeServer({ name: 'mine', scope: 'user' }), {
      removed: true,
      provider: 'dsh',
      name: 'mine',
      scope: 'user',
    });
    assert.equal(await readFile(patchPath, 'utf8'), '# my own overrides\n- insert:\n');

    // A name nothing declares is not an error: the catalog still has to be able
    // to clear its own switch for a row whose definition is already gone.
    assert.deepEqual(await provider.removeServer({ name: 'mine', scope: 'user' }), {
      removed: false,
      provider: 'dsh',
      name: 'mine',
      scope: 'user',
    });
  });
});

test('every write keeps its own timestamped backup and the oldest ones are pruned', {
  skip: !DSH_INSTALLED,
}, async () => {
  await withDshHome(USER_PATCH, async (dshHome) => {
    const provider = new DshMcpProvider();
    // Seven writes, so pruning has something to drop: one slot would have left
    // only the last intermediate state and lost the file as it stood before
    // CloudCLI ever touched it.
    for (let round = 0; round < 7; round += 1) {
      await provider.upsertServer({
        name: 'added',
        scope: 'user',
        transport: 'http',
        url: `http://127.0.0.1:${7000 + round}/mcp`,
      });
    }

    const backups = (await readdir(dshHome))
      .filter((name) => /^cordis\.patch\.yml\.cloudcli-.+\.bak$/u.test(name))
      .sort();
    assert.equal(backups.length, 5);

    // The surviving backups are the newest five, and the newest of them still
    // holds the state the last write replaced.
    const newest = await readFile(path.join(dshHome, backups.at(-1) ?? ''), 'utf8');
    assert.match(newest, /http:\/\/127\.0\.0\.1:7005\/mcp/u);
  });
});

test('a write keeps the patch layer mode instead of narrowing it to 0600', {
  skip: !DSH_INSTALLED,
}, async () => {
  await withDshHome(USER_PATCH, async (dshHome) => {
    const patchPath = path.join(dshHome, 'cordis.patch.yml');
    // A stow-managed dotfile is usually world-readable; a rename that installs
    // a 0600 inode would make it unreadable for everyone else on the machine.
    await chmod(patchPath, 0o644);

    await new DshMcpProvider().upsertServer({
      name: 'added',
      scope: 'user',
      transport: 'http',
      url: 'http://127.0.0.1:7777/mcp',
    });

    assert.equal((await stat(patchPath)).mode & 0o777, 0o644);
  });
});

test('a write that carries credentials narrows the patch layer to 0600', {
  skip: !DSH_INSTALLED,
}, async () => {
  // The token lives in the user-authored entry, outside the managed block: the
  // cap has to look at the whole document, not just what CloudCLI owns.
  await withDshHome(`- insert:
    - id: mcp-token
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: tokened
        transport: streamable-http
        url: http://127.0.0.1:9999/mcp
        headers:
          Authorization: 'Bearer secret-token'
`, async (dshHome) => {
    const patchPath = path.join(dshHome, 'cordis.patch.yml');
    await chmod(patchPath, 0o644);

    await new DshMcpProvider().upsertServer({
      name: 'added',
      scope: 'user',
      transport: 'http',
      url: 'http://127.0.0.1:7777/mcp',
    });

    assert.equal((await stat(patchPath)).mode & 0o777, 0o600);
  });
});

test('the credential cap narrows but never widens an existing mode', {
  skip: !DSH_INSTALLED,
}, async () => {
  await withDshHome(`- insert:
    - id: mcp-token
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: tokened
        transport: streamable-http
        url: http://127.0.0.1:9999/mcp
        headers:
          Authorization: 'Bearer secret-token'
`, async (dshHome) => {
    const patchPath = path.join(dshHome, 'cordis.patch.yml');
    // Already stricter than the cap: 0400 must survive the write untouched.
    await chmod(patchPath, 0o400);

    await new DshMcpProvider().upsertServer({
      name: 'added',
      scope: 'user',
      transport: 'http',
      url: 'http://127.0.0.1:7777/mcp',
    });

    assert.equal((await stat(patchPath)).mode & 0o777, 0o400);
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
