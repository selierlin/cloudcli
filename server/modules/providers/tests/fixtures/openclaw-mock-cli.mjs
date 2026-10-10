#!/usr/bin/env node
// Mock of the OpenClaw CLI's one-shot probe subcommands for auth tests.
//
// - `--version`                → prints the version (exit 0), or fails when
//                                MOCK_VERSION_FAIL=1 (present but unrunnable)
// - `models status --json`     → selected by MOCK_AUTH: ready | no_profiles |
//                                missing_in_use | probe_error | garbage
//
// `probe_error` exits non-zero and `garbage` prints invalid JSON; both make the
// auth adapter fall back to `openclaw.json`'s inline provider keys.
const args = process.argv.slice(2);

if (args.includes('--version')) {
  if (process.env.MOCK_VERSION_FAIL === '1') {
    process.stderr.write('boom\n');
    process.exit(7);
  }
  process.stdout.write('1.4.2\n');
  process.exit(0);
}

if (args[0] === 'models' && args[1] === 'status') {
  const mode = process.env.MOCK_AUTH || 'ready';
  if (mode === 'probe_error') {
    process.stderr.write('model store unavailable\n');
    process.exit(1);
  }
  if (mode === 'garbage') {
    process.stdout.write('{not valid json');
    process.exit(0);
  }
  const providers = mode === 'no_profiles'
    ? [{ profiles: {} }]
    : [{ profiles: { apiKey: 2, oauth: 0, token: 0 } }];
  process.stdout.write(JSON.stringify({
    auth: {
      providers,
      missingProvidersInUse: mode === 'missing_in_use' ? ['openai'] : [],
    },
  }));
  process.exit(0);
}

process.stderr.write('unknown command\n');
process.exit(2);
