#!/usr/bin/env node
// Mock of the WorkBuddy (codebuddy) stream-json CLI for runtime tests.
// Behavior is selected by MOCK_MODE: success | error | error-event |
// no-trailing-newline | hang.
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

const useStreamInput = readArg('--input-format') === 'stream-json';

const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

// When the runtime carries attachments it switches to stream-json input: the
// prompt text and any image/document content blocks arrive as one JSON user
// message on stdin instead of a `-p` argv prompt. Parse it so the echo below
// proves the runtime serialized the blocks correctly.
let effectivePrompt = prompt;
let stdinSummary = '';
if (useStreamInput) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const line = Buffer.concat(chunks).toString('utf8').trim();
  try {
    const parsed = JSON.parse(line);
    const content = Array.isArray(parsed?.message?.content) ? parsed.message.content : [];
    effectivePrompt = content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    const imageCount = content.filter((block) => block.type === 'image').length;
    const documentCount = content.filter((block) => block.type === 'document').length;
    stdinSummary = ` STDIN:${imageCount}img:${documentCount}file`;
  } catch {
    effectivePrompt = '<unparseable stdin>';
  }
}

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
              ? `RESUMED:${resumed}:${effectivePrompt}`
              : `OK:${effectivePrompt}:perm=${permMode ?? 'none'}`
          ) + (model ? ` MODEL:${model}` : '') + (process.env.CODEBUDDY_CONFIG_DIR ? ` CFG:${process.env.CODEBUDDY_CONFIG_DIR}` : '') + stdinSummary,
        },
      ],
    },
  });
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: 'ok' });
}
