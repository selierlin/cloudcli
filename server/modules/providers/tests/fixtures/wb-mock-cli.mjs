#!/usr/bin/env node
// Mock of the WorkBuddy (codebuddy) stream-json CLI for runtime tests.
// Behavior is selected by MOCK_MODE: success | error.
const mode = process.env.MOCK_MODE || 'success';
const args = process.argv.slice(2);
const readArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : null;
};
const prompt = readArg('-p') || '';
const resumed = readArg('--resume');
const permMode = readArg('--permission-mode');
const model = readArg('--model');
const sid = 'mock-session-123';

const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
emit({ type: 'system', subtype: 'init', session_id: sid, tools: [] });
if (mode === 'hang') {
  // Stay alive until the test kills the process (abort coverage).
  setInterval(() => {}, 1000);
} else if (mode === 'error') {
  emit({ type: 'result', subtype: 'error', is_error: true, session_id: sid, result: 'mock failure' });
} else if (mode === 'error-event') {
  // A fatal engine error surfaces as a single error event with no follow-up.
  emit({ type: 'error', error: 'No conversation found with session ID: mock-session' });
} else if (mode === 'no-trailing-newline') {
  emit({
    type: 'assistant',
    session_id: sid,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'final line without newline' }],
    },
  });
  // The terminal result event is written without a trailing newline; the
  // runtime must flush the partial line on process close.
  process.stdout.write(JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: sid,
    result: 'ok',
  }));
} else {
  emit({
    type: 'assistant',
    session_id: sid,
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'mock thinking' },
        {
          type: 'text',
          text: (
            resumed
              ? `RESUMED:${resumed}:${prompt}`
              : `OK:${prompt}:perm=${permMode ?? 'none'}`
          ) + (model ? ` MODEL:${model}` : '') + (process.env.CODEBUDDY_CONFIG_DIR ? ` CFG:${process.env.CODEBUDDY_CONFIG_DIR}` : ''),
        },
      ],
    },
  });
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: 'ok' });
}
