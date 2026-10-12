// Minimal ACP child used to exercise AcpClient's JSON-RPC frame routing.
//
// It answers `initialize`, then — deliberately reusing the client's own pending
// id for the request, so a method-bearing frame can never be mistaken for the
// answer to that request — emits a server→client request whose method the client
// does not implement. Whatever the client sends back for it is relayed as an
// `agent_message_chunk`, which is the only channel the test can observe.

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const handle = (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, method: 'session/fs/read_text_file', params: { path: '/etc/hosts' } });
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
    return;
  }

  // The only other frame this mock ever receives is the client's answer to the
  // request above; an `error` there is what the client's contract requires.
  if (message.error) {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'acp-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `rejected:${message.error.code}:${message.error.message}` },
        },
      },
    });
    return;
  }

  if (message.id !== undefined) {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'acp-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'accepted' } },
      },
    });
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
