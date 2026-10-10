// Mock of `openclaw acp`: a tiny ACP bridge over NDJSON stdio that exercises the
// runtime's streaming / tool / permission / cancel paths. The behaviour is
// picked by a keyword in the prompt text so one fixture covers every case.
//
// Spawned as `<binary> acp`; argv is ignored.

let cancelPromptId = null;
let cancelSessionId = null;
let permissionId = null;
let permissionPromptId = null;
let permissionSessionId = null;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const update = (sessionId, patch) => send({
  jsonrpc: '2.0',
  method: 'session/update',
  params: { sessionId, update: patch },
});
const chunk = (sessionId, text) => update(sessionId, {
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text },
});
const thought = (sessionId, text) => update(sessionId, {
  sessionUpdate: 'agent_thought_chunk',
  content: { type: 'text', text },
});

function handle(line) {
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

  if (message.method === 'session/new') {
    send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-1' } });
    return;
  }

  if (message.method === 'session/prompt') {
    const sessionId = message.params.sessionId;
    const text = message.params?.prompt?.[0]?.text ?? '';

    if (text.includes('cancel')) {
      chunk(sessionId, '开始');
      cancelPromptId = message.id;
      cancelSessionId = sessionId;
      return;
    }

    if (text.includes('permission')) {
      update(sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'bash',
        rawInput: { command: 'rm -rf /tmp/x' },
      });
      permissionId = 9001;
      permissionPromptId = message.id;
      permissionSessionId = sessionId;
      send({
        jsonrpc: '2.0',
        id: permissionId,
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: { toolCallId: 't1' },
          options: [
            { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
            { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
          ],
        },
      });
      return;
    }

    if (text.includes('tool')) {
      update(sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'bash',
        rawInput: { command: 'ls' },
      });
      update(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        rawOutput: 'file-a\nfile-b',
      });
      chunk(sessionId, '工具');
      chunk(sessionId, '完成');
      send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
      return;
    }

    if (text.includes('think')) {
      thought(sessionId, '想想');
      thought(sessionId, '…');
      chunk(sessionId, '答案');
      send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
      return;
    }

    chunk(sessionId, '第一段');
    chunk(sessionId, '第二段');
    send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
    return;
  }

  if (message.method === 'session/cancel') {
    if (cancelPromptId !== null) {
      send({ jsonrpc: '2.0', id: cancelPromptId, result: { stopReason: 'cancelled' } });
      cancelPromptId = null;
    }
    send({ jsonrpc: '2.0', id: message.id, result: {} });
    return;
  }

  if (message.id === permissionId) {
    const outcome = message.result?.outcome ?? {};
    chunk(
      permissionSessionId ?? 'acp-1',
      `perm:${outcome.outcome}:${outcome.optionId ?? ''}`,
    );
    send({ jsonrpc: '2.0', id: permissionPromptId, result: { stopReason: 'end_turn' } });
    permissionId = null;
    permissionPromptId = null;
  }
}

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
