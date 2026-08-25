import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  NormalizedMessage,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

import { getDshHarnessRoot, getDshSessionsRoot } from './dsh-models.provider.js';

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
  /** Invoked once the child exits or the client is closed, so the runtime can drop the cached server. */
  onClose?(): void;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  /** Optional timeout that rejects the request if the ACP child never responds. */
  timer?: ReturnType<typeof setTimeout>;
};

/** Default bounds so a hung ACP child cannot wedge runs, aborts, or the WS handler forever. */
const REQUEST_TIMEOUT_MS = 10_000;
const PROMPT_TIMEOUT_MS = Number(process.env.DSH_PROMPT_TIMEOUT_MS) || 3_600_000;

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
      if (request.timer) {
        clearTimeout(request.timer);
      }
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

  private request(method: string, params: AnyRecord, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any> {
    if (this.closed) {
      return Promise.reject(new Error('DSH ACP server is not running.'));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DSH ACP request "${method}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
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
      if (request.timer) {
        clearTimeout(request.timer);
      }
      request.reject(error);
    }
    this.pending.clear();
    this.handlers.onClose?.();
  }

  /** True once the child has exited or the client was closed. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Force-terminates the child synchronously (used on process exit to avoid orphans). */
  killSync(): void {
    try {
      this.child.kill('SIGKILL');
    } catch {
      // Already exited.
    }
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
    // The turn can legitimately run for minutes; the timeout only guards
    // against a hung child so the run cannot wedge forever.
    const result = await this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    }, PROMPT_TIMEOUT_MS) as AnyRecord;
    return { stopReason: typeof result?.stopReason === 'string' ? result.stopReason : 'error' };
  }

  async cancel(sessionId: string): Promise<void> {
    try {
      await this.request('session/cancel', { sessionId });
    } catch (error) {
      // The ACP server is unresponsive; force it down so the hung prompt
      // rejects and the caller's abort() unblocks instead of waiting forever.
      this.close();
      throw error;
    }
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
/** In-flight ACP spawn+initialize, so concurrent first runs share one child process. */
let acpServerPromise: Promise<AcpServerState> | null = null;
/** ACP session id → in-flight run, for routing agent_message_chunk to the right writer. */
const activeRuns = new Map<string, ActiveRun>();

let shutdownHooksRegistered = false;

/**
 * Registers a process-exit hook that force-kills the ACP child. Without it a
 * server restart would leave the ACP process orphaned (reparented, still
 * running). Registered once; the hook is synchronous because Node `exit`
 * handlers must not be async.
 */
function registerProcessShutdownHook(): void {
  if (shutdownHooksRegistered) {
    return;
  }
  shutdownHooksRegistered = true;
  process.on('exit', () => {
    if (acpServer) {
      try {
        acpServer.client.killSync();
      } catch {
        // Best-effort cleanup during exit.
      }
      acpServer = null;
    }
  });
}

/**
 * Registers a cloudcli-created ACP session with the DSH Desktop workspace
 * registry (`<harness>/storages/workspace.json`) so the Desktop UI groups it
 * under the matching project instead of "ungrouped".
 *
 * The Desktop app only attaches sessions it created itself (session/create and
 * session/fork); sessions created by external ACP processes land in its
 * session directory but never in a workspace. This mirrors the Desktop's own
 * attach rule — the session cwd must equal the workspace path — and writes
 * atomically (temp file + rename). Any parse/format/mismatch failure is
 * skipped so a future Desktop registry format upgrade can never break a run.
 */
function registerSessionWithDesktopWorkspace(acpSessionId: string, cwd: string): void {
  try {
    const workspaceFile = path.join(path.dirname(getDshSessionsRoot()), 'storages', 'workspace.json');
    if (!fs.existsSync(workspaceFile)) {
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(workspaceFile, 'utf8')) as AnyRecord;
    const workspaces = parsed?.tables?.workspaces as AnyRecord | undefined;
    if (!workspaces) {
      return;
    }
    const normalizePath = (value: string): string => value.replace(/[\\/]+$/, '');
    const targetCwd = normalizePath(cwd);
    for (const entry of Object.values(workspaces)) {
      const workspace = entry as AnyRecord | undefined;
      const workspacePath = typeof workspace?.path === 'string' ? workspace.path : '';
      if (!workspace || !workspacePath || normalizePath(workspacePath) !== targetCwd) {
        continue;
      }
      const sessionIds = Array.isArray(workspace.sessionIds)
        ? (workspace.sessionIds as unknown[]).filter((id): id is string => typeof id === 'string')
        : [];
      if (sessionIds.includes(acpSessionId)) {
        return;
      }
      workspace.sessionIds = [acpSessionId, ...sessionIds];
      const temporaryFile = `${workspaceFile}.tmp`;
      fs.writeFileSync(temporaryFile, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryFile, workspaceFile);
      console.log(`[DSH] registered session ${acpSessionId} with desktop workspace "${workspacePath}"`);
      return;
    }
  } catch (error) {
    console.warn('[DSH] desktop workspace registration skipped:', error instanceof Error ? error.message : String(error));
  }
}

/** Lazily spawns the DSH ACP server process and negotiates the protocol. */
async function ensureAcpServer(): Promise<AcpServerState> {
  // A dead server (crashed child / closed client) must never be handed out:
  // drop the cache so the next call spawns a fresh ACP process.
  if (acpServer && acpServer.client.isClosed) {
    acpServer = null;
  }
  if (acpServer) {
    return acpServer;
  }
  // Reuse the in-flight spawn for concurrent first runs so only one ACP
  // child is ever created; otherwise every caller spawns its own process and
  // all but the last become unmanaged orphans.
  if (acpServerPromise) {
    return acpServerPromise;
  }

  registerProcessShutdownHook();

  const harnessRoot = getDshHarnessRoot();
  // The ACP server is a separate node process; do not leak the parent tsx
  // loader's tsconfig hint (it resolves relative to the harness root and would
  // break `node --import tsx` inside the child).
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.TSX_TSCONFIG_PATH;
  // The ACP composition reads this variable to override its persistence root
  // (examples/acp-agent/cordis.yml), which is how cloudcli sessions become
  // visible in the DSH Desktop app.
  childEnv.DSH_SNAPSHOT_SESSIONS_ROOT = getDshSessionsRoot();
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
    // The child crashed or was closed: drop the cached server so the next run
    // spawns a fresh process instead of reusing a dead one.
    onClose: () => {
      if (acpServer?.client === client) {
        acpServer = null;
      }
    },
  });

  acpServerPromise = (async () => {
    try {
      await client.initialize();
    } catch (error) {
      client.close();
      throw error;
    }
    const state: AcpServerState = { client, sessionByApp: new Map() };
    acpServer = state;
    return state;
  })();

  try {
    return await acpServerPromise;
  } finally {
    acpServerPromise = null;
  }
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
      let existing = server.sessionByApp.get(appSessionId);
      if (!existing) {
        // The in-memory mapping is lost when the ACP server restarts (crash or
        // process restart). Rebuild it from the persisted provider session id so
        // a resumed conversation continues its thread instead of starting fresh.
        const persisted = context.resolveProviderSessionId(appSessionId);
        if (persisted) {
          server.sessionByApp.set(appSessionId, persisted);
          existing = persisted;
        }
      }
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
        // Register the session with the DSH Desktop workspace registry so the
        // Desktop UI groups it under the matching project instead of "ungrouped".
        registerSessionWithDesktopWorkspace(acpSessionId, cwd);
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
