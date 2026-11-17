import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import readline from 'node:readline';

import type { ProviderQuota, ProviderQuotaWindow } from '@/shared/types.js';
import type { CodexConfigOverrides } from '@/shared/codex-config.js';
import { toCodexConfigArgs } from '@/shared/codex-config.js';
import {
  AppError,
  SIDE_CONVERSATION_BOUNDARY_PROMPT,
  SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS,
  SIDE_QUESTION_ANSWER_SEPARATOR,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/**
 * Minimal JSON-RPC client for `codex app-server`.
 *
 * Codex ships two entry points and they expose different things. `codex exec`
 * — reached through `@openai/codex-sdk`, which this app no longer depends on —
 * is a one-shot channel whose whole surface is `startThread` and `resumeThread`;
 * there is no way to branch a thread or to resume one partway. The same
 * binary's `app-server` subcommand speaks JSON-RPC and does have that
 * primitive, `thread/fork`, which is what the Codex IDE clients build their
 * own "fork" and "edit an earlier message" on top of.
 *
 * So this is a second transport to the same CLI, opened only for the
 * operations the SDK cannot express. Everything else still goes through the
 * SDK.
 */

/** How long a single request may take before the child is killed. */
const REQUEST_TIMEOUT_MS = 30_000;

/** How long the app-server gets to exit on SIGTERM before it is force-killed. */
const SHUTDOWN_GRACE_MS = 2_000;

/**
 * How long a side-question turn may run before it is given up on. Not
 * measured like `REQUEST_TIMEOUT_MS`: a side question is a model turn, not a
 * handshake request, and can legitimately run for minutes on a hard
 * question. 5 minutes is a generous ceiling against a turn that never sends
 * `turn/completed` (a hung child, a provider bug) rather than a tuned value.
 */
const SIDE_QUESTION_TURN_TIMEOUT_MS = 5 * 60_000;

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/** A line from the app-server: a reply to us, a notification, or a server request. */
type JsonRpcLine = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/** Handler for a notification the app-server sent us (never a reply). */
type NotificationHandler = (method: string, params: unknown) => void;

/**
 * One fork of a Codex thread.
 *
 * `path` is returned by the server rather than reconstructed: the rollout
 * lands in today's date directory, not next to the file it was copied from,
 * so deriving it from the source path would be wrong roughly every day.
 */
export type CodexThreadFork = {
  threadId: string;
  path: string;
};

/**
 * The part of the `account/rateLimits/read` reply this app reads.
 *
 * Declared structurally rather than imported from the generated protocol
 * types: those travel with the CLI package while this shape has to keep
 * compiling when a field the server no longer sends goes missing.
 */
type CodexRateLimitWindow = {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
};

type CodexAccountRateLimits = {
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
  credits?: { hasCredits?: boolean | null; balance?: string | null } | null;
  planType?: string | null;
};

/**
 * Resolves the `codex` launcher shipped in node_modules.
 *
 * Deliberately not the `codex` on PATH: a machine can have a second, older
 * install, and the protocol this speaks is only guaranteed against the
 * version this package depends on.
 */
function resolveCodexLauncher(): string {
  const require_ = createRequire(import.meta.url);
  try {
    return require_.resolve('@openai/codex/bin/codex.js');
  } catch {
    throw new AppError('The Codex CLI package is not installed, so Codex conversations cannot be branched.', {
      code: 'CODEX_APP_SERVER_UNAVAILABLE',
      statusCode: 501,
    });
  }
}

/**
 * Feature switches every app-server we spawn runs with.
 *
 * Codex 0.164 resolves its plugin catalog and the `codex_apps` MCP server over
 * `chatgpt_base_url` before a turn starts. On a Codex home that points that base
 * URL at a dead endpoint (the usual arrangement for third-party providers), each
 * of those calls burns a retry budget — measured at 9.1s of the 13.7s turn, with
 * the model itself answering in 4.7s. Without them the same turn spends 3.0s
 * before the request leaves. Local plugin tools are lost as a side effect; that
 * is the trade this client makes so a turn is not dominated by a catalog fetch
 * it can never complete.
 */
const APP_SERVER_FEATURE_FLAGS = ['--disable', 'apps', '--disable', 'plugins'];

/**
 * Resolves the command line that starts `codex app-server`.
 *
 * `CODEX_APP_SERVER_COMMAND` replaces the launcher script so tests can point at
 * a fake app-server; production always runs the CLI shipped in node_modules —
 * a machine's own `codex` on PATH may be a different version than the protocol
 * this client speaks.
 */
function resolveCodexAppServerCommand(extraArgs: readonly string[] = []): { command: string; args: string[] } {
  const tail = [...APP_SERVER_FEATURE_FLAGS, ...extraArgs];
  const override = process.env.CODEX_APP_SERVER_COMMAND?.trim();
  if (override) {
    return { command: process.execPath, args: [override, 'app-server', ...tail] };
  }
  return { command: process.execPath, args: [codexAppServer.resolveLauncher(), 'app-server', ...tail] };
}

/**
 * Runs one exchange against a freshly spawned `codex app-server`.
 *
 * A process per operation rather than a pooled long-lived one: the handshake
 * costs a fraction of a second, forking happens at most once per user action,
 * and a shared child would need lifecycle handling — restarts, back-pressure,
 * a crash taking every pending fork with it — for no measurable gain next to
 * the model turn that follows.
 */
async function withAppServer<T>(
  run: (helpers: {
    call: (method: string, params: unknown) => Promise<unknown>;
    /** Registers a handler for every notification (no `id`) the app-server sends. Returns a function that removes it. */
    onNotification: (handler: NotificationHandler) => () => void;
    /**
     * Registers a handler for the child exiting or erroring. Separate from
     * `call()`'s own rejection: a waiter that is not sitting on a pending
     * request (e.g. `askSideQuestion` waiting on a `turn/completed`
     * notification) would otherwise only learn the child is gone once its
     * own timeout fires, minutes later.
     */
    onExit: (handler: (reason: string) => void) => () => void;
  }) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  // The command keeps this fork's `CODEX_APP_SERVER_COMMAND` override and
  // feature switches, while the launcher itself is resolved through the
  // exported object so tests can replace `codexAppServer.resolveLauncher`
  // with a fake app-server the same way they already replace `forkThread`.
  const spawnSpec = resolveCodexAppServerCommand();
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // The server logs sandbox and skill warnings to stderr on every start. They
  // are not failures and drowning the app log in them helps nobody, so stderr
  // is only kept around to explain a spawn that dies.
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-2000);
  });

  let nextRequestId = 1;
  const pending = new Map<number, (response: JsonRpcResponse) => void>();
  const notificationListeners = new Set<NotificationHandler>();
  let exitReason: string | null = null;

  const onNotification = (handler: NotificationHandler): (() => void) => {
    notificationListeners.add(handler);
    return () => notificationListeners.delete(handler);
  };

  const exitListeners = new Set<(reason: string) => void>();
  const onExit = (handler: (reason: string) => void): (() => void) => {
    exitListeners.add(handler);
    return () => exitListeners.delete(handler);
  };

  const reader = readline.createInterface({ input: child.stdout });
  reader.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    let message: JsonRpcLine;
    try {
      message = JSON.parse(line) as JsonRpcLine;
    } catch {
      // Any non-JSON banner is not a reply to anything this client asked for.
      return;
    }

    // A line with `method` is never a reply, even when its `id` happens to
    // match one of our own pending requests (the app-server reuses our
    // `turn/start` id when it turns around and asks *us* something).
    if (typeof message.method === 'string') {
      if (typeof message.id === 'number') {
        // A server request (`item/tool/requestUserInput`,
        // `mcpServer/elicitation/request`, `item/tool/call`, …) that
        // `approvalPolicy: 'never'` does not suppress. A side question has no
        // one to answer it, so it is rejected at once rather than left
        // pending — an unanswered one stalls the turn that is waiting on it.
        child.stdin?.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Side questions do not support interactive requests.' },
        })}\n`);
        return;
      }
      for (const handler of notificationListeners) {
        handler(message.method, message.params);
      }
      return;
    }

    if (typeof message.id !== 'number') {
      return;
    }
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });

  const failPending = (reason: string) => {
    exitReason = reason;
    for (const resolve of pending.values()) {
      resolve({ error: { message: reason } });
    }
    pending.clear();
    for (const listener of exitListeners) {
      listener(reason);
    }
  };

  child.on('error', (error) => failPending(error.message));
  child.on('exit', (code, signal) => {
    failPending(`codex app-server exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`);
  });
  // A child that dies mid-request leaves its pipes broken, and the next write
  // raises EPIPE on the stream rather than at the call site. Without a
  // listener that is an unhandled 'error' event, which takes the whole server
  // down over one failed fork.
  child.stdin?.on('error', (error) => failPending(error.message));
  child.stdout?.on('error', (error) => failPending(error.message));
  child.stderr?.on('error', () => {});

  const call = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (exitReason) {
        reject(new AppError(`Codex app-server is not running: ${exitReason}`, {
          code: 'CODEX_APP_SERVER_UNAVAILABLE',
          statusCode: 502,
        }));
        return;
      }

      const id = nextRequestId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new AppError(`Codex app-server did not answer "${method}" within ${REQUEST_TIMEOUT_MS}ms.`, {
          code: 'CODEX_APP_SERVER_TIMEOUT',
          statusCode: 504,
        }));
      }, REQUEST_TIMEOUT_MS);

      pending.set(id, (response) => {
        clearTimeout(timer);
        if (response.error) {
          reject(new AppError(response.error.message || `Codex app-server rejected "${method}".`, {
            code: 'CODEX_APP_SERVER_ERROR',
            statusCode: 502,
            details: { method, rpcCode: response.error.code },
          }));
          return;
        }
        resolve(response.result);
      });

      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  // Attached before `initialize`: `run` adds its own abort listener only
  // once the handshake has returned, so a dismiss while `initialize` hangs
  // would otherwise leave the child up until REQUEST_TIMEOUT_MS. Killing it
  // fails that pending call through the exit handler above.
  const killOnAbort = () => child.kill();
  signal?.addEventListener('abort', killOnAbort, { once: true });

  try {
    // `capabilities` is deliberately empty. `thread/fork` with `lastTurnId` is
    // in the stable protocol; only `beforeTurnId` and the turn-listing methods
    // are gated behind `experimentalApi`, and neither is needed here.
    await call('initialize', {
      clientInfo: { name: 'cloudcli', title: 'CloudCLI', version: '1' },
      capabilities: {},
    });
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);

    return await run({ call, onNotification, onExit });
  } catch (error) {
    if (error instanceof AppError && exitReason) {
      throw new AppError(`${error.message}${stderr ? ` — ${stderr.trim().split('\n').slice(-1)[0]}` : ''}`, {
        code: error.code,
        statusCode: error.statusCode,
      });
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', killOnAbort);
    reader.close();
    child.kill();
  }
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Waits for a child to exit, or reports that it did not within `timeoutMs`. */
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

/**
 * One live `codex app-server` process, spoken to as newline-delimited JSON-RPC.
 *
 * The one-shot {@link withAppServer} is enough for fork and quota, which are
 * request-then-die. A conversation is not: a turn emits notifications for as
 * long as it runs, and the app-server asks the client back mid-turn. So this
 * connection stays open across a whole turn and sorts every frame it reads into
 * one of three shapes:
 *
 *  - `{id, result|error}` → a reply to a request this side made;
 *  - `{id, method, params}` → a reverse request the server makes to the client;
 *  - `{method, params}` (no `id`) → a notification.
 *
 * Consumed by the Codex runtime (`codex-runtime.provider.ts`) once turns run
 * over app-server instead of the SDK.
 */
export class CodexAppServerConnection {
  private buffer = '';
  private sequence = 0;
  private stopping = false;
  private settled = false;
  private stderr = '';
  private readonly pending = new Map<number, PendingRequest>();
  private notificationHandler: ((method: string, params: unknown) => void) | null = null;
  private serverRequestHandler: ((id: number, method: string, params: unknown) => void) | null = null;
  private exitHandler: ((reason: string) => void) | null = null;

  constructor(private readonly child: ChildProcess) {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.onData(chunk));
    // stderr is kept only to explain a process that dies: the server logs
    // sandbox and skill warnings on every start that are not failures.
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-2000);
    });
    // A child that dies mid-request leaves its pipes broken, and the next write
    // raises EPIPE on the stream rather than at the call site. Without listeners
    // that is an unhandled 'error' event, which takes the whole server down.
    child.stdin?.on('error', () => {});
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    child.on('error', (error) => this.failAll(`codex app-server could not start: ${error.message}`));
    child.on('exit', (code, signal) => {
      this.failAll(`codex app-server exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`);
    });
  }

  /** Recent stderr, used to explain a connection that died. */
  get stderrTail(): string {
    return this.stderr;
  }

  /**
   * The child's process id, or undefined once it has exited. Callers that kill
   * the connection by hand (abort) use it to confirm the process is gone.
   */
  get pid(): number | undefined {
    return this.child.pid;
  }

  /** Registers the handler for notifications (frames with a `method` but no `id`). */
  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandler = handler;
  }

  /** Registers the handler for reverse requests the server makes mid-turn. */
  onServerRequest(handler: (id: number, method: string, params: unknown) => void): void {
    this.serverRequestHandler = handler;
  }

  /** Registers a handler for an unexpected end of the process. */
  onExit(handler: (reason: string) => void): void {
    this.exitHandler = handler;
  }

  /**
   * Completes the JSON-RPC handshake. Call once, before any request.
   *
   * `experimentalApi: false`: nothing here needs the experimental surface.
   * `requestAttestation: false` (required as of Codex 0.156.1): do not let the
   * server ask this client to generate an attestation — it has no way to, and
   * the request would only be refused.
   */
  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'cloudcli', title: 'CloudCLI', version: '1' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.write({ jsonrpc: '2.0', method: 'initialized', params: {} });
  }

  /** Sends one request and resolves with its `result`. */
  request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.settled) {
        reject(new AppError(`Codex app-server is not running.${this.stderrTail ? ` ${this.stderrTail.trim().split('\n').slice(-1)[0]}` : ''}`, {
          code: 'CODEX_APP_SERVER_UNAVAILABLE',
          statusCode: 502,
        }));
        return;
      }

      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError(`Codex app-server did not answer "${method}" within ${timeoutMs}ms.`, {
          code: 'CODEX_APP_SERVER_TIMEOUT',
          statusCode: 504,
        }));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Answers a reverse request with a result. */
  respond(id: number, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  /** Answers a reverse request with a JSON-RPC error. */
  respondError(id: number, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  /** SIGTERM, a grace period, then SIGKILL — the process always ends up gone. */
  async stop(): Promise<void> {
    const { child } = this;
    this.stopping = true;
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    child.kill('SIGTERM');
    if (await waitForExit(child, SHUTDOWN_GRACE_MS)) {
      return;
    }
    child.kill('SIGKILL');
    await waitForExit(child, SHUTDOWN_GRACE_MS);
  }

  private write(frame: unknown): void {
    try {
      this.child.stdin?.write(`${JSON.stringify(frame)}\n`);
    } catch {
      // A closed stdin means the process is gone; the exit handler reports it.
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.trim()) {
        this.handleLine(line);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      // Non-JSON banners on stdout are not frames; ignore them.
      return;
    }
    const record = readObjectRecord(frame);
    if (!record) {
      return;
    }

    const method = readOptionalString(record.method);
    const id = typeof record.id === 'number' ? record.id : undefined;

    if (method) {
      if (id === undefined) {
        this.notificationHandler?.(method, record.params);
        return;
      }
      if (this.serverRequestHandler) {
        this.serverRequestHandler(id, method, record.params);
        return;
      }
      // With no handler, refuse explicitly: an unanswered reverse request
      // makes the app-server wait forever, which reads as a hang rather than
      // as a capability this client does not have.
      this.respondError(id, -32601, `CloudCLI does not implement ${method}.`);
      return;
    }

    if (id === undefined) {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (record.error !== undefined) {
      const error = readObjectRecord(record.error);
      pending.reject(new AppError(readOptionalString(error?.message) || 'Codex app-server rejected the request.', {
        code: 'CODEX_APP_SERVER_ERROR',
        statusCode: 502,
        details: { rpcCode: error?.code },
      }));
      return;
    }
    pending.resolve(record.result);
  }

  private failAll(reason: string): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new AppError(reason, { code: 'CODEX_APP_SERVER_UNAVAILABLE', statusCode: 502 }));
    }
    this.pending.clear();
    if (!this.stopping) {
      this.exitHandler?.(reason);
    }
  }
}

/**
 * Whether a notification belongs to the turn a connection is currently driving.
 *
 * One connection drives one thread and one active turn, but the protocol can
 * still deliver frames that are not that turn's: `thread/started` on the
 * new-session path, and — if a resume response's history ever leaks into the
 * stream — whole past turns, which carry a different `turnId` under the same
 * `threadId`. Those are dropped. Frames naming neither id are kept, since they
 * cannot belong to another turn.
 *
 * Pure so the runtime can assert it table-driven.
 */
export function isCodexNotificationForActiveTurn(
  params: unknown,
  active: { threadId?: string; turnId?: string },
): boolean {
  const record = readObjectRecord(params);
  if (!record) {
    return true;
  }
  const threadId = readOptionalString(record.threadId);
  if (threadId && active.threadId && threadId !== active.threadId) {
    return false;
  }
  const turnId = readOptionalString(record.turnId);
  if (turnId && active.turnId && turnId !== active.turnId) {
    return false;
  }
  return true;
}

/**
 * Starts a `codex app-server` process and completes the handshake.
 *
 * A process per turn rather than a pooled daemon: it matches the lifecycle the
 * SDK path already has (one `codex exec` per turn) and needs no restart,
 * back-pressure, or crash-recovery story. Consumed by the Codex runtime.
 *
 * `configOverrides` (the selected profile) is passed on the command line, not
 * only in `thread/start`: Codex 0.166 resolves the provider a turn runs on from
 * the process configuration and rejects a thread whose recorded provider differs
 * (`modelProviderMismatch`), so the profile has to be in effect from startup.
 */
export async function startCodexAppServerConnection(
  configOverrides?: CodexConfigOverrides | null,
): Promise<CodexAppServerConnection> {
  const configArgs = configOverrides ? toCodexConfigArgs(configOverrides) : [];
  const { command, args } = resolveCodexAppServerCommand(configArgs);
  const child = spawn(command, args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const connection = new CodexAppServerConnection(child);
  try {
    await connection.initialize();
  } catch (error) {
    await connection.stop();
    throw error;
  }
  return connection;
}

/**
 * Normalizes one reported window, or drops it when the server sent no usable
 * percentage. A window without a consumption figure has nothing to render, and
 * keeping it would force every consumer to guard the same field.
 */
function toQuotaWindow(raw: CodexRateLimitWindow | null | undefined): ProviderQuotaWindow | null {
  if (!raw || typeof raw.usedPercent !== 'number' || !Number.isFinite(raw.usedPercent)) {
    return null;
  }
  return {
    usedPercent: raw.usedPercent,
    windowMinutes: typeof raw.windowDurationMins === 'number' ? raw.windowDurationMins : null,
    resetsAt: typeof raw.resetsAt === 'number' ? raw.resetsAt : null,
  };
}

export const codexAppServer = {
  /**
   * Resolves the `codex` launcher shipped in node_modules.
   *
   * Deliberately not the `codex` on PATH: a machine can have a second, older
   * install, and the protocol this speaks is only guaranteed against the
   * version this package depends on. A property on the exported object
   * rather than a module function so tests can swap in a fake app-server
   * script, the same seam `forkThread` already uses.
   */
  resolveLauncher(): string {
    return resolveCodexLauncher();
  },

  /**
   * Copies a thread into a new one that ends at `lastTurnId`, or copies the
   * whole thread when it is omitted.
   *
   * `lastTurnId` is inclusive of the turn it names, which is the same
   * convention the app's edit anchor uses ("the last row to keep").
   *
   * `cwd` decides the working directory recorded in the copy's `session_meta`,
   * and that field is what the session indexer keys a session's project off —
   * omitting it would file every fork under whatever directory this server
   * happens to be running from.
   */
  async forkThread(input: {
    threadId: string;
    lastTurnId?: string;
    cwd: string;
  }): Promise<CodexThreadFork> {
    return withAppServer(async ({ call }) => {
      const result = await call('thread/fork', {
        threadId: input.threadId,
        ...(input.lastTurnId ? { lastTurnId: input.lastTurnId } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
      }) as { thread?: { id?: unknown; path?: unknown } } | undefined;

      const threadId = typeof result?.thread?.id === 'string' ? result.thread.id : '';
      const path = typeof result?.thread?.path === 'string' ? result.thread.path : '';
      if (!threadId || !path) {
        throw new AppError('Codex reported a fork without a thread id or transcript path.', {
          code: 'FORK_FAILED',
          statusCode: 502,
        });
      }

      // Confirmed rather than trusted: both callers are about to point a
      // database row at this file, and a row naming a transcript that is not
      // there is a session that can never be opened.
      try {
        await stat(path);
      } catch {
        throw new AppError('Codex reported a fork but wrote no transcript for it.', {
          code: 'FORK_FAILED',
          statusCode: 502,
        });
      }

      return { threadId, path };
    });
  },

  /**
   * Reads the signed-in account's rolling rate limits.
   *
   * This is the call Codex's own `/status` uses, so the numbers agree with what
   * the CLI shows its user, and reading it consumes no quota. Used by
   * providerQuotaService to back the settings-page quota panel.
   */
  async readQuota(): Promise<ProviderQuota> {
    return withAppServer(async ({ call }) => {
      const result = await call('account/rateLimits/read', {}) as
        | { rateLimits?: CodexAccountRateLimits | null }
        | undefined;

      const snapshot = result?.rateLimits ?? null;
      if (!snapshot) {
        throw new AppError('Codex returned no rate-limit snapshot for this account.', {
          code: 'CODEX_QUOTA_UNAVAILABLE',
          statusCode: 502,
        });
      }

      // `primary` is the burst window and `secondary` the long one. A plan may
      // report only one of them, and the order is what labels them in the UI.
      const windows = [toQuotaWindow(snapshot.primary), toQuotaWindow(snapshot.secondary)]
        .filter((window): window is ProviderQuotaWindow => window !== null);

      // A zero balance is the normal state on plans without prepaid credits,
      // and showing "0" there reads as an exhausted budget.
      const credits = snapshot.credits?.hasCredits && typeof snapshot.credits.balance === 'string'
        ? snapshot.credits.balance
        : null;

      return {
        provider: 'codex',
        windows,
        planType: typeof snapshot.planType === 'string' ? snapshot.planType : null,
        credits,
        // Codex reports a balance without the capacity behind it, so the
        // breakdown and the paid flag stay unreported rather than being
        // reconstructed from a figure the app-server never sent.
        creditsUsed: null,
        creditsTotal: null,
        isPaidAccount: null,
        fetchedAt: Date.now(),
      };
    });
  },

  /**
   * Asks one question on an ephemeral, read-only fork of `threadId` and
   * resolves the concatenated answer. Used by `codexRuntime.askSideQuestion`
   * (`codex-runtime.provider.ts`) to answer a side question without touching
   * the parent thread.
   *
   * `ephemeral: true` keeps the fork off disk; `excludeTurns: true` only
   * leaves `thread.turns` out of the `thread/fork` response — this fork is
   * never listed anywhere, so there is nothing else for it to exclude.
   * `sandbox: 'read-only'` and `approvalPolicy: 'never'` keep it from
   * mutating anything while it has no one to approve a request. The turn
   * itself is the boundary prompt followed by the question, exactly as
   * Codex's own side-conversation support sends it.
   *
   * `config` carries a per-server `enabled: false` for every MCP server
   * `config/read` names, so the fork starts none of them. Measured against
   * the real 0.156.1 binary: `thread/fork`'s `config` deep-merges into the
   * base config rather than replacing a table wholesale, so `{ mcp_servers:
   * {} }` is a no-op — the fork still starts every configured server. Each
   * server does carry an `enabled` field (also seen through `config/read`,
   * not in the generated protocol types), and setting it `false` per name
   * skips that server with no startup attempt at all: no
   * `mcpServer/startupStatus/updated` notification, nothing spawned, nothing
   * dialled. The names come from this same app-server connection rather than
   * from the user's `~/.codex/config.toml` on disk, and only the names are
   * read — never a value, since an MCP entry can carry a token.
   *
   * `config/read` is sent with `cwd: input.cwd`, for the same reason
   * `thread/fork` below gets it: without it the app-server only reads the
   * user-level config, never `<project>/.codex/config.toml` of a trusted
   * project, so a project-only MCP server or app would never be named here
   * and would stay on in the fork. A probe against the real binary showed
   * `config/read {}` omits project entries while `config/read {cwd}` lists
   * them.
   *
   * Three more tools that reach outside the `read-only` sandbox get switched
   * off the same way, each measured against the real 0.156.1 binary with a
   * throwaway `CODEX_HOME` (codex-read-only-tools, second half):
   * - `config: { web_search: 'disabled' }` — `Config.web_search` is a
   *   `WebSearchMode`; `thread/start`/`thread/fork` accept `'disabled'`
   *   without error, and an invalid value (`'nope'`) is rejected with
   *   "unknown variant `nope`, expected one of `disabled`, `cached`,
   *   `indexed`, `live`", so the field is real and the value lands.
   * - `config: { apps: { _default: { enabled: false }, ...per-app } }` —
   *   `AppsConfig`'s `_default: AppsDefaultConfig | null` is the fallback
   *   applied to every connector that has no per-app entry, and `enabled:
   *   false` there is accepted (while `enabled: 'nope'` is rejected with
   *   "invalid type: string \"nope\", expected a boolean in
   *   `apps._default.enabled`", proof the override reaches that exact
   *   field). `_default` alone is not enough: `app_is_enabled`
   *   (codex-rs/connectors/src/app_tool_policy.rs:107 at rust-v0.166.0)
   *   prefers a per-app `[apps.<id>]` entry over `_default` when one exists,
   *   and `AppConfig.enabled` defaults to `true` — so a user's own `github`
   *   table, with or without an explicit `enabled` key, would keep that
   *   connector on in the fork unless every app name `config/read` reports
   *   also gets its own `enabled: false`.
   * - `disabledPluginIds` on the `turn/start` below — `plugin/list` needs no
   *   auth offline and lists every installed marketplace's plugins;
   *   `TurnStartParams.disabledPluginIds` "replaces this thread's disabled
   *   plugin IDs", so every id it reports is passed there. A `plugin/list`
   *   that errors (or would need auth) is treated as "no plugins" rather
   *   than failing the side question — nothing is disabled that could not be
   *   named, but the question still gets asked.
   * - `config: { features: { plugins: false } }` — the app-server README
   *   says of `disabledPluginIds` "Saving this selection does not yet filter
   *   plugin capabilities", and a probe against the real 0.166.0 binary
   *   (throwaway `CODEX_HOME`, one local plugin shipping an MCP server and a
   *   skill) showed why that matters: with `disabledPluginIds` alone the
   *   plugin's tool and skill stayed out of the fork's model request, but its
   *   MCP server process still started in the fork. With this override the
   *   fork started no plugin MCP server, exposed no plugin tool and injected
   *   no plugin skill, with or without `disabledPluginIds`, while the parent
   *   thread kept all three. It is the master switch the fork's own config
   *   reads (`Feature::Plugins`, which `PluginsManager::plugins_for_config`
   *   checks first), so it needs no plugin ids and also holds when
   *   `plugin/list` fails. `plugins: { _default: { enabled: false } }`
   *   alone did not stop the server: a per-plugin `enabled = true`, which
   *   `plugin/install` writes, overrides `_default` (`allows_plugin`,
   *   codex-rs/config/src/types.rs at rust-v0.166.0).
   */
  async askSideQuestion(
    input: { threadId: string; cwd: string; model: string; question: string; signal: AbortSignal },
    onDelta: (text: string) => void,
  ): Promise<string> {
    const abortedError = () => new AppError('The side question was aborted.', {
      code: 'CODEX_SIDE_QUESTION_ABORTED',
      statusCode: 499,
    });

    if (input.signal.aborted) {
      throw abortedError();
    }

    return withAppServer(async ({ call, onNotification, onExit }) => {
      // Reads the config layer stack the same way `thread/fork` below will
      // see it — `cwd` is what makes `config/read` fold in the project
      // layer — and turns each MCP server and app it names off by name, the
      // way the doc comment above explains.
      const configOverridesOff = async (): Promise<{
        mcpServers: Record<string, unknown>;
        apps: Record<string, unknown>;
      }> => {
        const configResult = await call('config/read', input.cwd ? { cwd: input.cwd } : {}) as {
          config?: { mcp_servers?: Record<string, unknown>; apps?: Record<string, unknown> };
        } | undefined;
        const mcpServerNames = Object.keys(configResult?.config?.mcp_servers ?? {});
        const appNames = Object.keys(configResult?.config?.apps ?? {});
        return {
          mcpServers: Object.fromEntries(mcpServerNames.map((name) => [name, { enabled: false }])),
          apps: Object.fromEntries(
            [...new Set([...appNames, '_default'])].map((name) => [name, { enabled: false }]),
          ),
        };
      };

      // `plugin/list` can fail offline (no auth, no network) and that is not
      // a reason to refuse the side question — it just means there is
      // nothing to name in `disabledPluginIds`, same as a user with no
      // plugins installed.
      const pluginIdsOff = async (): Promise<string[]> => {
        try {
          const result = await call('plugin/list', {}) as {
            marketplaces?: Array<{ plugins?: Array<{ id?: unknown }> }>;
          } | undefined;
          const ids: string[] = [];
          for (const marketplace of result?.marketplaces ?? []) {
            for (const plugin of marketplace.plugins ?? []) {
              if (typeof plugin?.id === 'string') {
                ids.push(plugin.id);
              }
            }
          }
          return ids;
        } catch {
          return [];
        }
      };

      return new Promise<string>((resolve, reject) => {
        let text = '';
        // Deltas are optional and `item/completed` is the final item, so an
        // agent message that never streamed is taken from there instead.
        const streamedItemIds = new Set<string>();
        // Codex often writes a progress note ("I'll read math.js…") and the
        // answer as two agentMessage items. A new item id after text already
        // sent starts a new paragraph. A delta without an item id is taken as
        // part of the current item: a seam guessed wrong would split a word.
        let currentItemId: string | null = null;
        const appendAgentText = (itemId: string | null, chunk: string) => {
          if (text && itemId !== null && currentItemId !== null && itemId !== currentItemId) {
            text += SIDE_QUESTION_ANSWER_SEPARATOR;
            onDelta(SIDE_QUESTION_ANSWER_SEPARATOR);
          }
          if (itemId !== null) {
            currentItemId = itemId;
          }
          text += chunk;
          onDelta(chunk);
        };
        let settled = false;
        let removeNotificationListener: (() => void) | null = null;
        let removeExitListener: (() => void) | null = null;

        const timer = setTimeout(() => {
          settle(() => reject(new AppError(
            `Codex side question did not complete within ${SIDE_QUESTION_TURN_TIMEOUT_MS}ms.`,
            { code: 'CODEX_SIDE_QUESTION_TIMEOUT', statusCode: 504 },
          )));
        }, SIDE_QUESTION_TURN_TIMEOUT_MS);

        const onAbort = () => {
          settle(() => reject(abortedError()));
        };
        // Attached before `config/read` and `thread/fork` go out, so a
        // dismiss while they are in flight is caught the same way as one
        // during the turn itself. A dismiss during `initialize`, before this
        // runs, is `withAppServer`'s: it kills the child.
        input.signal.addEventListener('abort', onAbort);

        function settle(action: () => void) {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          input.signal.removeEventListener('abort', onAbort);
          removeNotificationListener?.();
          removeExitListener?.();
          action();
        }

        if (input.signal.aborted) {
          settle(() => reject(abortedError()));
          return;
        }

        let pluginIds: string[] = [];

        Promise.all([configOverridesOff(), pluginIdsOff()]).then(([{ mcpServers, apps }, ids]) => {
          pluginIds = ids;
          if (settled) {
            // Aborted, or already timed out, while config/read or
            // plugin/list was in flight.
            return;
          }
          return call('thread/fork', {
            threadId: input.threadId,
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(input.model ? { model: input.model } : {}),
            ephemeral: true,
            sandbox: 'read-only',
            approvalPolicy: 'never',
            developerInstructions: SIDE_CONVERSATION_DEVELOPER_INSTRUCTIONS,
            excludeTurns: true,
            config: {
              mcp_servers: mcpServers,
              web_search: 'disabled',
              apps,
              features: { plugins: false },
            },
          });
        }).then((forkResult) => {
          if (settled) {
            // Aborted, or already timed out, while the fork request was in flight.
            return;
          }

          const typedForkResult = forkResult as { thread?: { id?: unknown } } | undefined;
          const forkThreadId = typeof typedForkResult?.thread?.id === 'string' ? typedForkResult.thread.id : '';
          if (!forkThreadId) {
            settle(() => reject(new AppError('Codex reported a side-question fork without a thread id.', {
              code: 'FORK_FAILED',
              statusCode: 502,
            })));
            return;
          }

          // From here on the turn waiter sits on a notification, not a
          // pending `call()`, so a child that exits mid-turn would otherwise
          // only be noticed once `SIDE_QUESTION_TURN_TIMEOUT_MS` elapses.
          removeExitListener = onExit((reason) => {
            settle(() => reject(new AppError(
              `Codex exited before the side-question turn finished (${reason}).`,
              { code: 'CODEX_SIDE_QUESTION_FAILED', statusCode: 502 },
            )));
          });

          removeNotificationListener = onNotification((method, params) => {
            const notificationParams = params as {
              threadId?: unknown;
              itemId?: unknown;
              delta?: unknown;
              item?: { type?: unknown; id?: unknown; text?: unknown };
              turn?: { status?: unknown; error?: { message?: unknown } };
            } | undefined;
            // Another thread's deltas (e.g. the one this fork was copied from)
            // arrive on the same connection; only this fork's own notifications
            // belong to this question.
            if (notificationParams?.threadId !== forkThreadId) {
              return;
            }

            if (method === 'item/agentMessage/delta') {
              const delta = typeof notificationParams.delta === 'string' ? notificationParams.delta : '';
              if (delta) {
                const itemId = typeof notificationParams.itemId === 'string' ? notificationParams.itemId : null;
                if (itemId !== null) {
                  streamedItemIds.add(itemId);
                }
                appendAgentText(itemId, delta);
              }
              return;
            }

            if (method === 'item/completed') {
              const item = notificationParams.item;
              if (
                item?.type === 'agentMessage'
                && typeof item.text === 'string' && item.text
                && !(typeof item.id === 'string' && streamedItemIds.has(item.id))
              ) {
                appendAgentText(typeof item.id === 'string' ? item.id : null, item.text);
              }
              return;
            }

            if (method === 'turn/completed') {
              const status = notificationParams.turn?.status;
              if (status === 'completed') {
                settle(() => resolve(text));
                return;
              }
              const message = typeof notificationParams.turn?.error?.message === 'string'
                ? notificationParams.turn.error.message
                : `Codex side-question turn ${String(status)}.`;
              settle(() => reject(new AppError(message, { code: 'CODEX_SIDE_QUESTION_FAILED', statusCode: 502 })));
            }
          });

          if (settled) {
            return;
          }

          call('turn/start', {
            threadId: forkThreadId,
            disabledPluginIds: pluginIds,
            input: [
              { type: 'text', text: SIDE_CONVERSATION_BOUNDARY_PROMPT, text_elements: [] },
              { type: 'text', text: input.question, text_elements: [] },
            ],
          }).catch((error) => {
            settle(() => reject(error));
          });
        }).catch((error) => {
          settle(() => reject(error));
        });
      });
    }, input.signal).catch((error: unknown) => {
      // A dismiss during `initialize` surfaces as the killed child's exit;
      // report it as the abort it was.
      throw input.signal.aborted ? abortedError() : error;
    });
  },
};
