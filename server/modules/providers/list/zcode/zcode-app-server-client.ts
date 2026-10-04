import type { ChildProcess } from 'node:child_process';

import spawn from 'cross-spawn';

import { resolveZcodeCommand } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import { AppError, readObjectRecord, readOptionalString } from '@/shared/utils.js';

/** How long a single app-server round trip (resume, fork) may take. */
const REQUEST_TIMEOUT_MS = 30_000;
/** How long the app-server gets to exit on SIGTERM before it is force-killed. */
const SHUTDOWN_GRACE_MS = 2_000;

/** The method ZCode calls back on the client while it materialises a session. */
const RUNTIME_PREFERENCES_METHOD = 'session/requestRuntimePreferences';

/**
 * The answer to {@link RUNTIME_PREFERENCES_METHOD}.
 *
 * ZCode asks the client which runtime preferences to apply; the schema is
 * strict, so these are exactly the fields it accepts. Headless CloudCLI wants
 * no autonomy surprises: memory off, model-side search off, and
 * ask-user-question auto-resolution on (there is no UI here to answer one).
 */
const RUNTIME_PREFERENCES = {
  nativeSearchEnhancementsEnabled: false,
  memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: true,
} as const;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Reads a JSON frame's `id`, which the protocol sends as a string or number. */
function readFrameId(value: unknown): string | undefined {
  if (typeof value === 'string' && value) {
    return value;
  }
  return typeof value === 'number' ? String(value) : undefined;
}

/** Renders an app-server `{code, message}` error into one operator-facing line. */
function describeProtocolError(error: unknown): string {
  const record = readObjectRecord(error);
  const message = readOptionalString(record?.message);
  const code = record?.code;
  if (message) {
    return typeof code === 'number' || typeof code === 'string' ? `${message} (code ${code})` : message;
  }
  return 'ZCode refused the request.';
}

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
 * One live `zcode app-server --stdio` process, spoken to as newline-delimited
 * JSON frames with the protocol's own envelope (`{id, method, params}` — there
 * is no `jsonrpc` field).
 *
 * Two frame shapes arrive: answers to requests this side made (carrying
 * `result`/`error`), and reverse requests the app-server makes to the client
 * (carrying `method`). Only the latter need answering; unknown ones are refused
 * with the JSON-RPC "method not found" code, which the app-server treats as a
 * compatibility fallback.
 */
class ZcodeAppServerConnection {
  private buffer = '';
  private sequence = 0;
  private settled = false;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly child: ChildProcess) {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.onData(chunk));
    child.on('error', (error) => {
      this.failAll(new AppError(`The ZCode app-server could not start: ${error.message}`, {
        code: 'FORK_FAILED',
        statusCode: 502,
      }));
    });
    child.on('exit', (code) => {
      this.failAll(new AppError(`The ZCode app-server exited before answering (code ${code ?? 'null'}).`, {
        code: 'FORK_FAILED',
        statusCode: 502,
      }));
    });
  }

  /** Sends one request and resolves with its `result`. */
  request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.settled) {
        reject(new AppError('The ZCode app-server is no longer running.', { code: 'FORK_FAILED', statusCode: 502 }));
        return;
      }
      const id = `cloudcli-${++this.sequence}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError(`ZCode did not answer ${method} in time.`, { code: 'FORK_FAILED', statusCode: 502 }));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  async stop(): Promise<void> {
    const { child } = this;
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
      return;
    }
    const record = readObjectRecord(frame);
    if (!record) {
      return;
    }

    const method = readOptionalString(record.method);
    if (method) {
      // A frame carrying `method` is a request from the app-server, not an
      // answer to one of ours.
      const id = readFrameId(record.id);
      if (id !== undefined) {
        this.answerReverseRequest(id, method);
      }
      return;
    }

    const id = readFrameId(record.id);
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
      pending.reject(new AppError(describeProtocolError(record.error), { code: 'FORK_FAILED', statusCode: 502 }));
      return;
    }
    pending.resolve(record.result);
  }

  private answerReverseRequest(id: string, method: string): void {
    if (method === RUNTIME_PREFERENCES_METHOD) {
      this.write({ id, result: RUNTIME_PREFERENCES });
      return;
    }
    this.write({ id, error: { code: -32601, message: `CloudCLI does not implement ${method}.` } });
  }

  private failAll(error: Error): void {
    this.settled = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

/**
 * Drives a throwaway `zcode app-server --stdio` process for the one operation
 * the one-shot `--prompt` CLI cannot express: forking a session at a message.
 *
 * ZCode's app-server refuses to fork a session it has not loaded ("Session is
 * not active"), so each fork resumes the source in this process and then asks
 * it to fork — the app-server makes the copy itself, remapping message ids, and
 * the process is torn down as soon as the result is in.
 */
export class ZcodeAppServerClient {
  /**
   * Copies the session up to and including `messageId` into a new session and
   * returns the child's provider-native id.
   */
  async forkSession(input: {
    providerSessionId: string;
    messageId: string;
  }): Promise<{ providerSessionId: string; response: string }> {
    const connection = this.startServer();
    try {
      await connection.request('session/resume', { sessionId: input.providerSessionId });
      const result = await connection.request('session/fork', {
        sessionId: input.providerSessionId,
        target: { kind: 'message', messageId: input.messageId },
      });

      const record = readObjectRecord(result);
      const providerSessionId = readOptionalString(record?.forkedSessionId);
      if (!providerSessionId) {
        throw new AppError('ZCode forked the session but returned no session id.', {
          code: 'FORK_FAILED',
          statusCode: 502,
        });
      }
      return {
        providerSessionId,
        response: readOptionalString(record?.response) ?? '',
      };
    } finally {
      await connection.stop();
    }
  }

  private startServer(): ZcodeAppServerConnection {
    const resolution = resolveZcodeCommand();
    if (!resolution.command) {
      throw new AppError('The ZCode CLI could not be found.', { code: 'FORK_FAILED', statusCode: 502 });
    }
    const child = spawn(resolution.command, [...resolution.baseArgs, 'app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // `resolution.env` carries the bundled CLI's provider-config hint; without
      // it the CLI cannot locate its built-in provider catalog.
      env: { ...process.env, ...resolution.env },
    });
    return new ZcodeAppServerConnection(child);
  }
}

export const zcodeAppServerClient = new ZcodeAppServerClient();
