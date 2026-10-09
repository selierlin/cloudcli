import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import readline from 'node:readline';

import type { ProviderQuota, ProviderQuotaWindow } from '@/shared/types.js';
import { AppError, readObjectRecord, readOptionalString } from '@/shared/utils.js';

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

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

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
 * Resolves the command line that starts `codex app-server`.
 *
 * `CODEX_APP_SERVER_COMMAND` replaces the launcher script so tests can point at
 * a fake app-server; production always runs the CLI shipped in node_modules —
 * a machine's own `codex` on PATH may be a different version than the protocol
 * this client speaks.
 */
function resolveCodexAppServerCommand(): { command: string; args: string[] } {
  const override = process.env.CODEX_APP_SERVER_COMMAND?.trim();
  if (override) {
    return { command: process.execPath, args: [override, 'app-server'] };
  }
  return { command: process.execPath, args: [resolveCodexLauncher(), 'app-server'] };
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
  run: (call: (method: string, params: unknown) => Promise<unknown>) => Promise<T>,
): Promise<T> {
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
  let exitReason: string | null = null;

  const reader = readline.createInterface({ input: child.stdout });
  reader.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      // Server-to-client notifications and any non-JSON banner are not
      // replies to anything this client asked for.
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

  try {
    // `capabilities` is deliberately empty. `thread/fork` with `lastTurnId` is
    // in the stable protocol; only `beforeTurnId` and the turn-listing methods
    // are gated behind `experimentalApi`, and neither is needed here.
    await call('initialize', {
      clientInfo: { name: 'cloudcli', title: 'CloudCLI', version: '1' },
      capabilities: {},
    });
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);

    return await run(call);
  } catch (error) {
    if (error instanceof AppError && exitReason) {
      throw new AppError(`${error.message}${stderr ? ` — ${stderr.trim().split('\n').slice(-1)[0]}` : ''}`, {
        code: error.code,
        statusCode: error.statusCode,
      });
    }
    throw error;
  } finally {
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
 */
export async function startCodexAppServerConnection(): Promise<CodexAppServerConnection> {
  const { command, args } = resolveCodexAppServerCommand();
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
    return withAppServer(async (call) => {
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
    return withAppServer(async (call) => {
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
};
