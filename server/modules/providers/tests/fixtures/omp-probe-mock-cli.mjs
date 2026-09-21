#!/usr/bin/env node
// Mock of the OMP CLI's one-shot probe subcommands for auth/model tests.
//
// - `--version`            → prints the version (always exit 0)
// - `config list --json`   → selected by MOCK_AUTH: ready | unconfigured |
//                            probe_error | garbage
// - `models --json`        → selected by MOCK_MODELS: catalog | empty |
//                            probe_error | garbage
//
// OMP has no `auth` subcommand; the auth probe infers "can this machine run a
// turn" from `modelRoles.value.default` in the config listing.
const args = process.argv.slice(2);

if (args.includes('--version')) {
  process.stdout.write('18.2.6\n');
  process.exit(0);
}

if (args[0] === 'models') {
  const mode = process.env.MOCK_MODELS || 'catalog';
  if (mode === 'probe_error') {
    process.stderr.write('model store unavailable\n');
    process.exit(1);
  }
  if (mode === 'garbage') {
    process.stdout.write('{not valid json');
    process.exit(0);
  }
  if (mode === 'empty') {
    process.stdout.write(JSON.stringify({ models: [] }));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    models: [
      {
        provider: 'ark',
        id: 'deepseek-v4-flash',
        selector: 'ark/deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        contextWindow: 128000,
        maxTokens: 8192,
        reasoning: true,
        thinking: ['minimal', 'low', 'medium', 'high'],
        input: ['text'],
        cost: {},
      },
      {
        provider: 'deepseek',
        id: 'deepseek-v4-pro',
        selector: 'deepseek/deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        contextWindow: 128000,
        maxTokens: 8192,
        reasoning: false,
        input: ['text'],
        cost: {},
      },
    ],
  }));
  process.exit(0);
}

if (args[0] === 'config' && args[1] === 'list') {
  const mode = process.env.MOCK_AUTH || 'ready';
  if (mode === 'probe_error') {
    process.stderr.write('config store unavailable\n');
    process.exit(1);
  }
  if (mode === 'garbage') {
    process.stdout.write('{not valid json');
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    modelRoles: {
      value: mode === 'unconfigured' ? {} : { default: 'ark/deepseek-v4-flash' },
    },
  }));
  process.exit(0);
}

process.stderr.write('unknown command\n');
process.exit(2);
