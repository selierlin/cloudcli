#!/usr/bin/env node
// Mock of the ZCode CLI in `--prompt ... --output-format stream-json` mode.
// Behavior is selected by MOCK_MODE:
//   success | tool-success | permission-denied | permission-flood |
//   no-trailing-newline | startup-error | hang | streaming-hang
// The emitted events mirror the real 0.16.5 shapes captured from a live run,
// including the top-level (payload-less) terminal `result` event.
// When ZCODE_MOCK_ARGS_FILE is set, the full argv is written there so tests can
// assert the spawn arguments precisely; ZCODE_MOCK_ENV_FILE does the same for
// the model-override environment the runtime injects.
import fs from 'node:fs';

const mode = process.env.MOCK_MODE || 'success';
const args = process.argv.slice(2);
const readArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : null;
};
const prompt = readArg('--prompt') ?? '';
const resumed = readArg('--resume');
const modeArg = readArg('--mode');
const cwd = readArg('--cwd');
const attachments = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--attach') {
    attachments.push(args[i + 1]);
  }
}
const sessionId = resumed || process.env.MOCK_SESSION_ID || 'sess_mock-zcode-session-1';

if (process.env.ZCODE_MOCK_ARGS_FILE) {
  fs.writeFileSync(process.env.ZCODE_MOCK_ARGS_FILE, JSON.stringify(args, null, 2));
}
if (process.env.ZCODE_MOCK_ENV_FILE) {
  const { ZCODE_MODEL, ZCODE_BASE_URL, ZCODE_API_KEY } = process.env;
  fs.writeFileSync(
    process.env.ZCODE_MOCK_ENV_FILE,
    JSON.stringify({ ZCODE_MODEL, ZCODE_BASE_URL, ZCODE_API_KEY }, null, 2),
  );
}

const now = () => Date.now();
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const envelope = (extra) => ({
  eventId: `evt_${Math.random().toString(16).slice(2)}`,
  sessionId,
  timestamp: now(),
  traceId: 'trace-mock',
  turnId: 'turn-mock',
  seq: (envelope.seq = (envelope.seq || 0) + 1),
  ...extra,
});

const title = () => emit(envelope({
  type: 'session.titleUpdated',
  payload: { previousTitle: '', source: 'first_input', title: prompt.slice(0, 60) },
}));
const turnStarted = () => emit(envelope({
  type: 'turn.started',
  payload: { turnNumber: 0, input: prompt, messageId: 'msg_mock_user' },
}));
const sessionUpdated = () => {
  // The real CLI reports whichever model it resolved, including the per-process
  // `ZCODE_MODEL` override the runtime injects.
  const model = process.env.ZCODE_MODEL || 'ark/deepseek-v4-flash';
  const [providerId, ...rest] = model.split('/');
  return emit(envelope({
    type: 'session.updated',
    payload: {
      model,
      modelRef: { providerId, modelId: rest.join('/') || model },
      toolCount: 4,
    },
  }));
};
const streaming = (payload) => emit(envelope({
  type: 'model.streaming',
  payload: { assistantMessageId: 'msg_mock_assistant', done: false, ...payload },
}));
const toolCall = (toolName, input, toolCallId) => streaming({
  kind: 'tool_call',
  toolCallId,
  toolName,
  input,
  delta: '',
});
const toolResult = (toolCallId, content, success) => emit(envelope({
  type: 'tool.updated',
  payload: { toolCallId, kind: 'result', duration: 5, result: { success, content } },
}));
const toolBatch = (toolCallIds, successCount, errorCount) => emit(envelope({
  type: 'tool.updated',
  payload: { kind: 'batch', toolCallIds, successCount, errorCount },
}));
const permissionDenied = (toolName, toolCallId, requestId) => {
  emit(envelope({
    type: 'permission.requested',
    payload: {
      requestId,
      toolCallId,
      toolName,
      riskLevel: 'medium',
      reason: `Tool ${toolName} has side effects and requires approval`,
      input: {},
    },
  }));
  emit(envelope({
    type: 'permission.resolved',
    payload: { requestId, toolCallId, toolName, decision: 'deny', reason: `No permission client configured for ${toolName}` },
  }));
  toolBatch([toolCallId], 0, 1);
};
const turnCompleted = (response, resultType = 'success') => emit(envelope({
  type: 'turn.completed',
  payload: {
    response,
    resultType,
    toolCallCount: 1,
    tokenCount: 120,
    usage: { source: 'provider', inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  },
}));
const result = (response, newline = true) => {
  const line = JSON.stringify({
    type: 'result',
    sessionId,
    traceId: 'trace-mock',
    turnId: 'turn-mock',
    response,
    usage: { source: 'provider', inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 0 },
    eventCount: envelope.seq,
    projection: { status: 'idle', turnCount: 1, totalTokenCount: 120, contextUsed: 120, contextWindow: 1048576 },
  });
  process.stdout.write(newline ? `${line}\n` : line);
};
const text = (value) => {
  streaming({ kind: 'text_start' });
  streaming({ kind: 'text_delta', delta: value });
  streaming({ kind: 'text_end' });
};

title();
turnStarted();
sessionUpdated();

if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (mode === 'streaming-hang') {
  const timer = setInterval(() => streaming({ kind: 'text_delta', delta: 'x' }), 30);
  process.on('SIGTERM', () => {
    clearInterval(timer);
    streaming({ kind: 'text_delta', delta: 'late' });
    setTimeout(() => process.exit(0), 200);
  });
  streaming({ kind: 'text_start' });
  streaming({ kind: 'text_delta', delta: 'x' });
} else if (mode === 'startup-error') {
  process.stderr.write('Error: Session not found: sess_missing (traceId: mock)\n');
  process.exit(1);
} else if (mode === 'permission-denied') {
  streaming({ kind: 'reasoning_start' });
  streaming({ kind: 'reasoning_delta', delta: 'I need to write a file.' });
  toolCall('Write', { file_path: `${cwd}/out.txt`, content: 'hi' }, 'call_denied_1');
  permissionDenied('Write', 'call_denied_1', 'perm_denied_1');
  turnCompleted('I could not write the file.', 'success');
  result('I could not write the file.');
} else if (mode === 'permission-flood') {
  const denials = Math.max(1, Number(process.env.MOCK_DENIALS) || 4);
  for (let i = 1; i <= denials; i += 1) {
    const tool = i % 2 === 0 ? 'Bash' : 'Write';
    const callId = `call_flood_${i}`;
    toolCall(tool, { command: 'echo hi' }, callId);
    permissionDenied(tool, callId, `perm_flood_${i}`);
  }
  turnCompleted('done');
  result('done');
} else if (mode === 'tool-success') {
  streaming({ kind: 'reasoning_start' });
  streaming({ kind: 'reasoning_delta', delta: 'I will run the command.' });
  streaming({ kind: 'reasoning_end' });
  toolCall('Bash', { command: 'echo ZCODE_TOOL_OK' }, 'call_ok_1');
  emit(envelope({ type: 'tool.updated', payload: { toolCallId: 'call_ok_1', toolName: 'Bash', kind: 'scheduled' } }));
  emit(envelope({ type: 'tool.updated', payload: { toolCallId: 'call_ok_1', toolName: 'Bash', startedAt: now(), kind: 'started' } }));
  toolResult('call_ok_1', 'ZCODE_TOOL_OK', true);
  text(`RESUMED:${resumed || 'none'} PROMPT:${prompt} MODE:${modeArg} ATTACH:${attachments.join(',')}`);
  toolBatch(['call_ok_1'], 1, 0);
  turnCompleted(`ZCODE_TOOL_OK (${resumed || 'none'})`);
  result('ZCODE_TOOL_OK');
} else if (mode === 'no-trailing-newline') {
  text(`PROMPT:${prompt}`);
  turnCompleted(`PROMPT:${prompt}`);
  result(`PROMPT:${prompt}`, false);
  process.exit(0);
} else {
  // success
  streaming({ kind: 'start' });
  streaming({ kind: 'reasoning_start' });
  streaming({ kind: 'reasoning_delta', delta: 'thinking about it' });
  streaming({ kind: 'reasoning_end' });
  text(`RESUMED:${resumed || 'none'} PROMPT:${prompt} MODE:${modeArg} ATTACH:${attachments.join(',')}`);
  streaming({ kind: 'finish' });
  const response = resumed ? `RESUMED:${resumed}` : prompt;
  turnCompleted(response);
  result(response);
}

if (mode !== 'hang' && mode !== 'streaming-hang') {
  process.exit(0);
}
