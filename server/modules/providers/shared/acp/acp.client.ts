import type { ChildProcess } from 'node:child_process';

import type { AnyRecord } from '@/shared/types.js';

// ---------- Minimal Agent Client Protocol (ACP) client ----------
//
// Newline-delimited JSON-RPC over a child process's stdio, mirroring the
// automation wire contract both DSH (`dsh --profile acp`) and OpenClaw
// (`openclaw acp`) speak — both are built on `@agentclientprotocol/sdk`, whose
// main protocol version is 1.
//
// Client → server requests: initialize / session/new / session/prompt /
// session/cancel / session/load. Server → client requests:
// session/request_permission. Server → client notifications: session/update
// (sessionUpdate: agent_message_chunk / agent_thought_chunk / tool_call /
// tool_call_update / available_commands_update / ...).
//
// Kept dependency-free on purpose: the SDK pulls a larger surface than the
// handful of frames these adapters need.

export type AcpPermissionOption = {
  optionId: string;
  kind: string;
  name?: string;
  message?: string;
};

export type AcpToolCallUpdate = {
  toolCallId: string;
  toolName: string;
  input?: unknown;
};

export type AcpPermissionRequest = {
  options: AcpPermissionOption[];
  toolCallId?: string;
};

export type AcpPermissionOutcome =
  | { outcome: 'cancelled' }
  | { outcome: 'selected'; optionId: string };

export type AcpPermissionResponder = (outcome: AcpPermissionOutcome) => void;

export type AcpClientHandlers = {
  onMessageChunk(sessionId: string, text: string, messageId?: string): void;
  /** Reasoning traces stream on their own channel; absent means the child never sends one. */
  onThoughtChunk?(sessionId: string, text: string, messageId?: string): void;
  onToolCall?(sessionId: string, toolCall: AcpToolCallUpdate): void;
  /** `tool_call_update` frames carry status/output; absent means the child never sends one. */
  onToolCallUpdate?(sessionId: string, update: AnyRecord): void;
  onRequestPermission(
    sessionId: string,
    request: AcpPermissionRequest,
    respond: AcpPermissionResponder,
  ): void;
  /** Invoked once the child exits or the client is closed, so the runtime can drop the cached server. */
  onClose?(): void;
};

export type AcpClientOptions = {
  /** Prefix for stderr lines relayed to the server log (e.g. `DSH ACP`). */
  logPrefix?: string;
  /** Bounds on non-prompt requests so a hung child cannot wedge a run. */
  requestTimeoutMs?: number;
  /** Bounds on a single prompt turn (turns legitimately run for minutes). */
  promptTimeoutMs?: number;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  /** Optional timeout that rejects the request if the ACP child never responds. */
  timer?: ReturnType<typeof setTimeout>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 3_600_000;

/** Minimal Agent Client Protocol client over newline-delimited JSON-RPC stdio. */
export class AcpClient {
  private readonly child: ChildProcess;
  private readonly handlers: AcpClientHandlers;
  private readonly logPrefix: string;
  private readonly requestTimeoutMs: number;
  private readonly promptTimeoutMs: number;
  private buffer = '';
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private closed = false;
  /** Newest stderr line, surfaced in the exit error so a failed handshake is diagnosable. */
  private lastStderrLine: string | null = null;

  constructor(child: ChildProcess, handlers: AcpClientHandlers, options: AcpClientOptions = {}) {
    this.child = child;
    this.handlers = handlers;
    this.logPrefix = options.logPrefix ?? 'ACP';
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.promptTimeoutMs = options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => this.receive(chunk));
    child.stderr!.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString().trim();
      if (text) {
        this.lastStderrLine = text.split('\n').filter(Boolean).pop() ?? text;
        console.error(`[${this.logPrefix}] ${text}`);
      }
    });
    child.on('error', (error) => this.shutdown(error));
    child.on('exit', (code) => this.shutdown(this.exitError(code)));
  }

  /** Builds the error a child exit surfaces, appending the last stderr line when there is one. */
  private exitError(code: number | null): Error {
    const base = `${this.logPrefix} server exited with code ${code ?? 'unknown'}`;
    return new Error(this.lastStderrLine ? `${base}: ${this.lastStderrLine}` : base);
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

    // Server-initiated requests also carry a numeric JSON-RPC id, so methods
    // must be routed before pending client-request responses are resolved.
    if (message.method === 'session/update') {
      const params = message.params as AnyRecord | undefined;
      const update = params?.update as AnyRecord | undefined;
      const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : null;
      if (sessionId && update?.sessionUpdate === 'agent_message_chunk') {
        const text = this.readChunkText(update);
        if (text) {
          this.handlers.onMessageChunk(sessionId, text, this.readMessageId(update));
        }
      }
      if (sessionId && update?.sessionUpdate === 'agent_thought_chunk' && this.handlers.onThoughtChunk) {
        const text = this.readChunkText(update);
        if (text) {
          this.handlers.onThoughtChunk(sessionId, text, this.readMessageId(update));
        }
      }
      if (
        sessionId
        && update?.sessionUpdate === 'tool_call'
        && typeof update.toolCallId === 'string'
        && this.handlers.onToolCall
      ) {
        this.handlers.onToolCall(sessionId, {
          toolCallId: update.toolCallId,
          toolName: typeof update.title === 'string' ? update.title : 'UnknownTool',
          input: update.rawInput,
        });
      }
      if (
        sessionId
        && update?.sessionUpdate === 'tool_call_update'
        && typeof update.toolCallId === 'string'
        && this.handlers.onToolCallUpdate
      ) {
        this.handlers.onToolCallUpdate(sessionId, update);
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
      const toolCall = params?.toolCall as AnyRecord | undefined;
      const request: AcpPermissionRequest = {
        options,
        toolCallId: typeof toolCall?.toolCallId === 'string' ? toolCall.toolCallId : undefined,
      };
      const respond: AcpPermissionResponder = (outcome) => {
        this.respond(message.id, { outcome });
      };
      if (typeof params?.sessionId === 'string') {
        try {
          this.handlers.onRequestPermission(params.sessionId, request, respond);
        } catch {
          respond({ outcome: 'cancelled' });
        }
      } else {
        respond({ outcome: 'cancelled' });
      }
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
        request.reject(new Error(String((message.error as AnyRecord).message ?? `${this.logPrefix} request failed`)));
      } else {
        request.resolve(message.result);
      }
    }
  }

  /** Reads a text delta from an ACP chunk, tolerating the two content shapes seen in the wild. */
  private readChunkText(update: AnyRecord): string {
    const content = update.content as AnyRecord | undefined;
    if (content?.type === 'text' && typeof content.text === 'string') {
      return content.text;
    }
    return typeof update.text === 'string' ? update.text : '';
  }

  private readMessageId(update: AnyRecord): string | undefined {
    return typeof update.messageId === 'string' && update.messageId ? update.messageId : undefined;
  }

  private respond(id: unknown, result: unknown): void {
    if (!this.child.stdin!.writable) {
      return;
    }
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  }

  private request(method: string, params: AnyRecord, timeoutMs = this.requestTimeoutMs): Promise<any> {
    if (this.closed) {
      return Promise.reject(new Error(`${this.logPrefix} server is not running.`));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.logPrefix} request "${method}" timed out after ${timeoutMs}ms.`));
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

  async initialize(protocolVersion = 1, clientCapabilities: AnyRecord = {}): Promise<AnyRecord> {
    return this.request('initialize', { protocolVersion, clientCapabilities });
  }

  /**
   * Creates (or, when `meta.sessionKey` names an existing session, re-attaches
   * to) one ACP session and returns its ACP session id. `meta` is passed through
   * as `_meta` so a provider can route the request to a provider-native session.
   */
  async newSession(
    cwd: string,
    extra: { mcpServers?: unknown[]; meta?: AnyRecord } = {},
  ): Promise<string> {
    const params: AnyRecord = { cwd, mcpServers: extra.mcpServers ?? [] };
    if (extra.meta) {
      params._meta = extra.meta;
    }
    const result = await this.request('session/new', params) as AnyRecord;
    if (typeof result?.sessionId !== 'string') {
      throw new Error(`${this.logPrefix} session/new did not return a session id.`);
    }
    return result.sessionId;
  }

  async prompt(sessionId: string, text: string, timeoutMs = this.promptTimeoutMs): Promise<{ stopReason: string }> {
    // The turn can legitimately run for minutes; the timeout only guards
    // against a hung child so the run cannot wedge forever.
    const result = await this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    }, timeoutMs) as AnyRecord;
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
    this.shutdown(new Error(`${this.logPrefix} server closed.`));
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
