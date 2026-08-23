import { spawn, type ChildProcess } from 'node:child_process';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  NormalizedMessage,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

import { getDshHarnessRoot } from './dsh-models.provider.js';

// ---------- Minimal ACP (Agent Client Protocol) client over JSON-RPC stdio ----------
//
// Mirrors the automation wire contract the DSH ACP server speaks
// (`@agentclientprotocol/sdk` 0.25.1 + the `examples/acp-agent` composition):
// newline-delimited JSON-RPC on stdio with initialize / session/new /
// session/prompt / session/cancel plus session/update and
// session/request_permission server requests. Kept dependency-free.

type AcpPermissionOption = { optionId: string; kind: string; message?: string };

type AcpClientHandlers = {
  onMessageChunk(sessionId: string, text: string): void;
  onRequestPermission(sessionId: string, options: AcpPermissionOption[]): void;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

/** Minimal Agent Client Protocol client over newline-delimited JSON-RPC stdio. */
class AcpClient {
  private readonly child: ChildProcess;
  private readonly handlers: AcpClientHandlers;
  private buffer = '';
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private closed = false;

  constructor(child: ChildProcess, handlers: AcpClientHandlers) {
    this.child = child;
    this.handlers = handlers;
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => this.receive(chunk));
    child.stderr!.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error(`[DSH ACP] ${text}`);
      }
    });
    child.on('error', (error) => this.shutdown(error));
    child.on('exit', (code) => this.shutdown(
      new Error(`DSH ACP server exited with code ${code ?? 'unknown'}`),
    ));
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf('\n');
      if (line) {
        this.dispatch(line);
      }
    }
  }

  private dispatch(line: string): void {
    let message: AnyRecord;
    try {
      message = JSON.parse(line) as AnyRecord;
    } catch {
      return;
    }

    if (typeof message.id === 'number') {
      const request = this.pending.get(message.id);
      if (!request) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(String(message.error.message ?? 'DSH ACP request failed')));
      } else {
        request.resolve(message.result);
      }
      return;
    }

    if (message.method === 'session/update') {
      const params = message.params as AnyRecord | undefined;
      const update = params?.update as AnyRecord | undefined;
      if (update?.sessionUpdate === 'agent_message_chunk') {
        const content = update.content as AnyRecord | undefined;
        const text = content?.type === 'text' && typeof content.text === 'string'
          ? content.text
          : '';
        if (text && typeof params?.sessionId === 'string') {
          this.handlers.onMessageChunk(params.sessionId, text);
        }
      }
      return;
    }

    if (message.method === 'session/request_permission') {
      const params = message.params as AnyRecord | undefined;
      const options = Array.isArray(params?.options)
        ? (params.options as unknown[]).filter(
          (entry): entry is AcpPermissionOption => typeof (entry as AnyRecord)?.optionId === 'string',
        )
        : [];
      if (typeof params?.sessionId === 'string') {
        this.handlers.onRequestPermission(params.sessionId, options);
      }
      // Skeleton policy: decline every one-shot permission request until the
      // permission gateway is wired to the ACP bridge.
      this.respond(message.id, { outcome: { outcome: 'cancelled' } });
      return;
    }
  }

  private respond(id: unknown, result: unknown): void {
    if (!this.child.stdin!.writable) {
      return;
    }
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  }

  private request(method: string, params: AnyRecord): Promise<any> {
    if (this.closed) {
      return Promise.reject(new Error('DSH ACP server is not running.'));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private shutdown(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }

  async initialize(): Promise<void> {
    await this.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  }

  async newSession(cwd: string): Promise<string> {
    const result = await this.request('session/new', { cwd, mcpServers: [] }) as AnyRecord;
    if (typeof result?.sessionId !== 'string') {
      throw new Error('DSH ACP session/new did not return a session id.');
    }
    return result.sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
    const result = await this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    }) as AnyRecord;
    return { stopReason: typeof result?.stopReason === 'string' ? result.stopReason : 'error' };
  }

  async cancel(sessionId: string): Promise<void> {
    await this.request('session/cancel', { sessionId });
  }

  close(): void {
    this.shutdown(new Error('DSH ACP server closed.'));
    try {
      this.child.stdin!.end();
    } catch {
      // The child may already be gone; ignore.
    }
    setTimeout(() => {
      try {
        this.child.kill('SIGKILL');
      } catch {
        // Already exited.
      }
    }, 2000).unref();
  }
}

// ---------- Process and session lifecycle ----------

type AcpServerState = {
  client: AcpClient;
  /** App session id → ACP session id (kept alive for the connection lifetime). */
  sessionByApp: Map<string, string>;
};

/** Upper bound on live app→ACP session mappings so a long-lived server cannot grow without limit. */
const MAX_SESSION_MAPPINGS = 256;

/** Evicts the oldest mappings once the cap is exceeded. The mapping is kept
 *  for the whole server lifetime on purpose: dropping it at the end of a run
 *  would cut the ACP conversation's context, since the harness keeps the
 *  per-session state keyed by the ACP session id. */
function trimSessionMappings(sessionByApp: Map<string, string>): void {
  while (sessionByApp.size > MAX_SESSION_MAPPINGS) {
    const oldest = sessionByApp.keys().next().value;
    if (typeof oldest !== 'string') {
      break;
    }
    sessionByApp.delete(oldest);
  }
}

type ActiveRun = {
  writer: ProviderRuntimeWriter;
  appSessionId: string;
  normalize: (raw: unknown, sessionId: string | null) => NormalizedMessage[];
};

let acpServer: AcpServerState | null = null;
/** ACP session id → in-flight run, for routing agent_message_chunk to the right writer. */
const activeRuns = new Map<string, ActiveRun>();

/** Lazily spawns the DSH ACP server process and negotiates the protocol. */
async function ensureAcpServer(): Promise<AcpServerState> {
  if (acpServer) {
    return acpServer;
  }

  const harnessRoot = getDshHarnessRoot();
  // The ACP server is a separate node process; do not leak the parent tsx
  // loader's tsconfig hint (it resolves relative to the harness root and would
  // break `node --import tsx` inside the child).
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.TSX_TSCONFIG_PATH;
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'packages/examples/acp-demo/src/bin.ts', '--config', 'examples/acp-agent/cordis.yml'],
    {
      cwd: harnessRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    },
  );

  const client = new AcpClient(child, {
    onMessageChunk: (acpSessionId, text) => {
      const run = activeRuns.get(acpSessionId);
      if (!run) {
        return;
      }
      for (const message of run.normalize({ type: 'agent_message_chunk', content: text }, run.appSessionId)) {
        run.writer.send(message);
      }
    },
    onRequestPermission: (acpSessionId) => {
      console.warn(`[DSH] auto-declining permission request for session ${acpSessionId}`);
    },
  });

  try {
    await client.initialize();
  } catch (error) {
    client.close();
    throw error;
  }

  acpServer = { client, sessionByApp: new Map() };
  return acpServer;
}

/** Provider registry runtime adapter driving the DSH ACP server. */
export const dshRuntime: IProviderRuntime = {
  async run(command, options, writer, context) {
    const appSessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
    if (!appSessionId) {
      writer.send(createCompleteMessage({ provider: 'dsh', sessionId: null, exitCode: 1 }));
      return;
    }

    const sessionName = typeof options.sessionSummary === 'string'
      ? options.sessionSummary
      : undefined;
    const userId = writer.userId ?? null;

    // Server startup and session creation live inside the try so a failed
    // spawn or session/new surfaces as a normalized error + complete instead
    // of an unhandled rejection that drops the chat's message stream.
    let server: AcpServerState | null = null;
    let acpSessionId: string | null = null;
    try {
      server = await ensureAcpServer();
      const existing = server.sessionByApp.get(appSessionId);
      if (existing) {
        acpSessionId = existing;
      } else {
        const cwd = typeof options.cwd === 'string' && options.cwd
          ? options.cwd
          : typeof options.projectPath === 'string' && options.projectPath
            ? options.projectPath
            : process.cwd();
        acpSessionId = await server.client.newSession(cwd);
        server.sessionByApp.set(appSessionId, acpSessionId);
        trimSessionMappings(server.sessionByApp);
        // Announce the provider-native (ACP) session id so the chat writer maps
        // it to the app session row. History reads later resolve the JSONL log
        // file through this id.
        writer.send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: acpSessionId,
          sessionId: appSessionId,
          provider: 'dsh',
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writer.send(createNormalizedMessage({
        kind: 'error',
        content: message,
        sessionId: appSessionId,
        provider: 'dsh',
      }));
      writer.send(createCompleteMessage({ provider: 'dsh', sessionId: appSessionId, exitCode: 1 }));
      notifyRunFailed({ userId, provider: 'dsh', sessionId: appSessionId, sessionName, error: message });
      return;
    }
    // The successful branch above always assigns both.
    if (!server || !acpSessionId) {
      return;
    }

    // A single ACP session can drive only one turn at a time; reject a second
    // run instead of silently replacing the in-flight run's stream writer.
    if (activeRuns.has(acpSessionId)) {
      writer.send(createNormalizedMessage({
        kind: 'error',
        content: 'This session already has a running task.',
        sessionId: appSessionId,
        provider: 'dsh',
      }));
      writer.send(createCompleteMessage({
        provider: 'dsh',
        sessionId: appSessionId,
        actualSessionId: acpSessionId,
        exitCode: 1,
      }));
      return;
    }

    activeRuns.set(acpSessionId, {
      writer,
      appSessionId,
      normalize: (raw, sessionId) => context.normalizeMessage(raw, sessionId),
    });

    try {
      const { stopReason } = await server.client.prompt(acpSessionId, command);
      if (stopReason === 'cancelled') {
        writer.send(createCompleteMessage({
          provider: 'dsh',
          sessionId: appSessionId,
          actualSessionId: acpSessionId,
          exitCode: 0,
          aborted: true,
        }));
        notifyRunStopped({ userId, provider: 'dsh', sessionId: appSessionId, sessionName, stopReason: 'aborted' });
        return;
      }
      // ACP stop reasons other than refusal/unknown mean the turn finished
      // normally: `end_turn` (complete) or a resource limit was hit
      // (`max_tokens` / `max_turn_requests`), which is not a failure.
      if (stopReason === 'end_turn' || stopReason === 'max_tokens' || stopReason === 'max_turn_requests') {
        writer.send(createCompleteMessage({
          provider: 'dsh',
          sessionId: appSessionId,
          actualSessionId: acpSessionId,
          exitCode: 0,
        }));
        notifyRunStopped({ userId, provider: 'dsh', sessionId: appSessionId, sessionName, stopReason: 'completed' });
        return;
      }
      writer.send(createCompleteMessage({
        provider: 'dsh',
        sessionId: appSessionId,
        actualSessionId: acpSessionId,
        exitCode: 1,
      }));
      notifyRunFailed({ userId, provider: 'dsh', sessionId: appSessionId, sessionName, error: `DSH turn ended with ${stopReason}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writer.send(createNormalizedMessage({
        kind: 'error',
        content: message,
        sessionId: appSessionId,
        provider: 'dsh',
      }));
      writer.send(createCompleteMessage({
        provider: 'dsh',
        sessionId: appSessionId,
        actualSessionId: acpSessionId,
        exitCode: 1,
      }));
      notifyRunFailed({ userId, provider: 'dsh', sessionId: appSessionId, sessionName, error: message });
    } finally {
      activeRuns.delete(acpSessionId);
    }
  },

  async abort(sessionId: string): Promise<boolean> {
    const server = acpServer;
    if (!server) {
      return false;
    }
    const acpSessionId = server.sessionByApp.get(sessionId);
    if (!acpSessionId) {
      return false;
    }
    try {
      await server.client.cancel(acpSessionId);
      return true;
    } catch {
      return false;
    }
  },
};

/** Drops the ACP server process and all live session mappings (used by tests). */
export function resetDshRuntimeForTests(): void {
  if (acpServer) {
    acpServer.client.close();
    acpServer = null;
  }
  activeRuns.clear();
}
