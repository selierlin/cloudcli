#!/usr/bin/env node
// Mock of `codex app-server` (newline-delimited JSON-RPC over stdio), used by
// codex-app-server-client.test.ts and codex-runtime.test.ts. It is spawned as
// `node <this> app-server`, so the argv is ignored.
//
// CODEX_MOCK_MODE selects behavior:
//   normal         answer every request; echo unexpected frames as notifications
//   scripted       after turn/start, emit notifications, a reverse request, then
//                  turn/completed once the reverse request is answered
//   runtime        after turn/start, play CODEX_MOCK_SCRIPT (a whole turn); see below
//   banner         write a non-JSON banner to stdout and a line to stderr first
//   hang           never answer the method named by CODEX_MOCK_HANG_METHOD
//   exit-on-turn   exit(1) on turn/start without answering it
//   ignore-sigterm ignore SIGTERM, so stop() must escalate to SIGKILL
//
// CODEX_MOCK_SCRIPT selects the turn `runtime` mode plays:
//   text           one assistant message streamed as deltas, then usage + completion
//   tool           prose, a shell command with two output deltas, then a second
//                  assistant message (two prose segments either side of the tool)
//   reasoning      the echoed user turn, a two-block reasoning trace, then a reply
//   plan           a plan update, then completion
//   fail           an error notification and a failed turn
//   retry          a retryable error, then a normal completion
//   exit           answer turn/start, then die without completing the turn
//   hang           answer turn/start, emit one delta, then wait to be killed
//
// Frames the client sends that are not answers to a request of ours (chiefly
// the `initialized` notification and its replies to our reverse requests) are
// echoed back as `mock/observed` notifications, so tests can assert what the
// client actually wrote. Every request we answer is echoed as `mock/request`
// with its params, so tests can assert what the client actually asked for
// (`excludeTurns`, an image input item, `turn/interrupt`).
import readline from 'node:readline';
import { appendFileSync } from 'node:fs';

const mode = process.env.CODEX_MOCK_MODE || 'normal';
const script = process.env.CODEX_MOCK_SCRIPT || 'text';
const hangMethod = process.env.CODEX_MOCK_HANG_METHOD || '';
// Every request the client makes is appended here, so a test can assert the
// wire format (the runtime consumes the `mock/request` notification itself).
const logPath = process.env.CODEX_MOCK_LOG || '';
const REVERSE_REQUEST_ID = 900;
const TURN_ID = 'mock-turn-1';
// Notifications must name the thread the client is driving, which for a resume
// is the id the client asked for.
let activeThreadId = 'mock-thread-1';

const logRequest = (method, params) => {
  if (!logPath) {
    return;
  }
  try {
    appendFileSync(logPath, `${JSON.stringify({ method, params })}\n`);
  } catch {
    // A test that is not reading the log must not break the mock.
  }
};

const write = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
const respond = (id, result) => write({ jsonrpc: '2.0', id, result });
const notify = (method, params) => write({ jsonrpc: '2.0', method, params });
const item = (payload) => ({ threadId: activeThreadId, turnId: TURN_ID, item: { threadId: activeThreadId, turnId: TURN_ID, ...payload } });

if (mode === 'banner') {
  process.stdout.write('codex app-server: starting (this line is not JSON)\n');
  process.stderr.write('mock stderr: sandbox warning\n');
}

if (mode === 'ignore-sigterm') {
  process.on('SIGTERM', () => {});
}

const answerMethod = (method, params) => {
  switch (method) {
    case 'thread/start':
      return { thread: { id: activeThreadId, path: '/tmp/codex-mock-rollout.jsonl' } };
    case 'thread/resume':
      // The client drives the id it asked for; later notifications must name it.
      activeThreadId = params?.threadId ?? activeThreadId;
      return { thread: { id: activeThreadId } };
    case 'turn/start':
      return { turn: { id: TURN_ID, status: 'inProgress' } };
    case 'turn/interrupt':
      return {};
    default:
      return {};
  }
};

const runScriptedTurn = () => {
  notify('thread/started', { threadId: activeThreadId });
  notify('item/agentMessage/delta', {
    threadId: activeThreadId,
    turnId: TURN_ID,
    itemId: 'item-1',
    delta: 'hello',
  });
  // A reverse request: the client must answer it, and its answer is echoed back
  // so the test can assert either the client's handler or the default refusal.
  write({
    jsonrpc: '2.0',
    id: REVERSE_REQUEST_ID,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: activeThreadId, turnId: TURN_ID, itemId: 'item-2' },
  });
};

const completeTurn = () => notify('turn/completed', {
  threadId: activeThreadId,
  turnId: TURN_ID,
  turn: { id: TURN_ID, status: 'completed' },
});

const emitTokenUsage = () => notify('thread/tokenUsage/updated', {
  threadId: activeThreadId,
  turnId: TURN_ID,
  tokenUsage: {
    total: {
      totalTokens: 220,
      inputTokens: 120,
      cachedInputTokens: 30,
      cacheWriteInputTokens: 10,
      outputTokens: 40,
      reasoningOutputTokens: 60,
    },
    modelContextWindow: 128000,
  },
});

const playRuntimeScript = () => {
  switch (script) {
    case 'text':
      notify('thread/started', { threadId: activeThreadId });
      notify('item/started', item({ id: 'item-1', type: 'agentMessage', text: '' }));
      notify('item/agentMessage/delta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'item-1', delta: 'Hello' });
      notify('item/agentMessage/delta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'item-1', delta: ', ' });
      notify('item/agentMessage/delta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'item-1', delta: 'world' });
      notify('item/completed', item({ id: 'item-1', type: 'agentMessage', text: 'Hello, world' }));
      emitTokenUsage();
      completeTurn();
      return;

    case 'tool':
      notify('item/started', item({ id: 'item-1', type: 'agentMessage', text: '' }));
      notify('item/agentMessage/delta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'item-1', delta: 'First' });
      notify('item/completed', item({ id: 'item-1', type: 'agentMessage', text: 'First' }));
      notify('item/started', item({ id: 'cmd-1', type: 'commandExecution', command: 'ls', status: 'inProgress' }));
      notify('item/commandExecution/outputDelta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'cmd-1', delta: 'a\n' });
      notify('item/commandExecution/outputDelta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'cmd-1', delta: 'b\n' });
      notify('item/completed', item({
        id: 'cmd-1',
        type: 'commandExecution',
        command: 'ls',
        aggregatedOutput: 'a\nb\n',
        exitCode: 0,
        status: 'completed',
      }));
      notify('item/started', item({ id: 'item-2', type: 'agentMessage', text: '' }));
      notify('item/agentMessage/delta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'item-2', delta: 'Second' });
      notify('item/completed', item({ id: 'item-2', type: 'agentMessage', text: 'Second' }));
      completeTurn();
      return;

    case 'reasoning':
      // The turn's own user input is echoed back as an item; it must not become
      // a row. Taken from a real run (`item/started` + `item/completed`).
      notify('item/started', item({ id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'hi', text_elements: [] }] }));
      notify('item/completed', item({ id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'hi', text_elements: [] }] }));
      // A two-block reasoning trace: the completed row joins the blocks with a
      // newline, so the streamed text has to insert the same separator or the
      // completed row would not be recognised as already streamed.
      notify('item/started', item({ id: 'rs-1', type: 'reasoning', summary: [], content: [] }));
      notify('item/reasoning/summaryTextDelta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'rs-1', delta: 'part one', summaryIndex: 0 });
      notify('item/reasoning/summaryTextDelta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'rs-1', delta: 'part two', summaryIndex: 1 });
      notify('item/completed', item({ id: 'rs-1', type: 'reasoning', summary: ['part one', 'part two'], content: [] }));
      notify('item/started', item({ id: 'item-1', type: 'agentMessage', text: '' }));
      notify('item/agentMessage/delta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'item-1', delta: 'ok' });
      notify('item/completed', item({ id: 'item-1', type: 'agentMessage', text: 'ok' }));
      completeTurn();
      return;

    case 'plan':
      notify('turn/plan/updated', {
        threadId: activeThreadId,
        turnId: TURN_ID,
        plan: [
          { step: 'gather', status: 'completed' },
          { step: 'analyse', status: 'inProgress' },
          { step: 'report', status: 'pending' },
        ],
      });
      completeTurn();
      return;

    case 'fail':
      notify('error', {
        threadId: activeThreadId,
        turnId: TURN_ID,
        willRetry: false,
        error: { message: 'model exploded' },
      });
      notify('turn/completed', {
        threadId: activeThreadId,
        turnId: TURN_ID,
        turn: { id: TURN_ID, status: 'failed', error: { message: 'model exploded' } },
      });
      return;

    case 'retry':
      notify('error', {
        threadId: activeThreadId,
        turnId: TURN_ID,
        willRetry: true,
        error: { message: 'transient blip' },
      });
      notify('item/started', item({ id: 'item-1', type: 'agentMessage', text: '' }));
      notify('item/agentMessage/delta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'item-1', delta: 'recovered' });
      notify('item/completed', item({ id: 'item-1', type: 'agentMessage', text: 'recovered' }));
      completeTurn();
      return;

    case 'exit':
      process.exit(1);
      return;

    case 'hang':
      notify('item/started', item({ id: 'item-1', type: 'agentMessage', text: '' }));
      notify('item/agentMessage/delta', { threadId: activeThreadId, turnId: TURN_ID, itemId: 'item-1', delta: 'partial' });
      // Never completes: the client has to end this by aborting.
      return;

    default:
      completeTurn();
      return;
  }
};

const onFrame = (frame) => {
  if (frame.method) {
    if (frame.method === 'initialize') {
      if (mode === 'hang' && hangMethod === 'initialize') {
        return;
      }
      respond(frame.id, { userAgent: 'codex-mock/1.0' });
      return;
    }
    if (frame.id === undefined) {
      // A notification from the client (e.g. `initialized`).
      notify('mock/observed', { frame });
      return;
    }
    if (mode === 'hang' && hangMethod === frame.method) {
      return;
    }
    if (mode === 'exit-on-turn' && frame.method === 'turn/start') {
      process.exit(1);
    }
    // Logged before the reply, deliberately. A client that reacts to the reply
    // by killing this process (abort sends `turn/interrupt` then stops the
    // child) can cut the rest of this function off: Node's default SIGTERM
    // disposition terminates the process mid-script, and a request that was
    // answered but never logged would read as "the client never asked".
    logRequest(frame.method, frame.params);
    respond(frame.id, answerMethod(frame.method, frame.params));
    notify('mock/request', { method: frame.method, params: frame.params });
    if (mode === 'scripted' && frame.method === 'turn/start') {
      runScriptedTurn();
    }
    if (mode === 'runtime' && frame.method === 'turn/start') {
      // After the reply, so the client has the turn id before the notifications.
      setImmediate(playRuntimeScript);
    }
    return;
  }

  // No method: an answer to a reverse request (or something unexpected). Echo it.
  notify('mock/observed', { frame });
  if (frame.id === REVERSE_REQUEST_ID) {
    completeTurn();
  }
};

const reader = readline.createInterface({ input: process.stdin });
reader.on('line', (line) => {
  if (!line.trim()) {
    return;
  }
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return;
  }
  onFrame(frame);
});
