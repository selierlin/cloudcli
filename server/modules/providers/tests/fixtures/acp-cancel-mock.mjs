// ACP child that models cancellation the way the protocol defines it.
//
// `session/cancel` is a *notification*: the agent answers nothing, settles the
// in-flight `session/prompt` with stopReason "cancelled", and keeps serving.
// The cancel frame is echoed back as a chunk so the test can assert what the
// client actually put on the wire — including that it carried no id, which
// would otherwise turn it into a request the agent rejects with -32601.
//
// A prompt containing `ignore-cancel` models an agent that never honours the
// notification, so the client has to end that turn by itself.

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const chunk = (sessionId, text) => send({
  jsonrpc: '2.0',
  method: 'session/update',
  params: {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  },
});

// Acp session id → the prompt request id still waiting to be settled.
const pendingPrompts = new Map();
// Sessions whose prompt text asked the agent to ignore cancellation, so the
// client has to end the turn on its own.
const ignoredCancel = new Set();

const handle = (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
    return;
  }

  if (message.method === 'session/prompt') {
    chunk(message.params.sessionId, 'start');
    pendingPrompts.set(message.params.sessionId, message.id);
    if (String(message.params?.prompt?.[0]?.text ?? '').includes('ignore-cancel')) {
      ignoredCancel.add(message.params.sessionId);
    }
    return;
  }

  if (message.method === 'session/cancel') {
    chunk(message.params.sessionId, `cancel:${JSON.stringify(message)}`);
    if (ignoredCancel.has(message.params.sessionId)) {
      return;
    }
    const promptId = pendingPrompts.get(message.params.sessionId);
    if (promptId !== undefined) {
      pendingPrompts.delete(message.params.sessionId);
      send({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'cancelled' } });
    }
  }
};

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  buffer += data;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (line) {
      handle(line);
    }
  }
});
