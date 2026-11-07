import type { ChildProcess } from 'node:child_process';

import type { AnyRecord } from '@/shared/types.js';

// ---------- Minimal Agent Client Protocol (ACP) client ----------
//
// Newline-delimited JSON-RPC over a child process's stdio, mirroring the
// automation wire contract both DSH (`dsh --profile acp`) and OpenClaw
// (`openclaw acp`) speak — both are built on `@agentclientprotocol/sdk`, whose
// main protocol version is 1.
//
// Client → server requests: initialize / session/new / session/resume /
// session/prompt / session/cancel / session/load. Server → client requests:
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

/**
 * One entry of an ACP `session/prompt` payload.
 *
 * `image.data` must be canonical base64 — the DSH server decodes it, re-encodes
 * it, and rejects the turn when the two strings differ. `resource_link` is the
 * only way to hand a non-image file across: the server renders it into the text
 * the model reads, while `resource` (inline bytes) is refused.
 */
export type AcpPromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'resource_link'; name: string; uri: string };

/**
 * One JSON-RPC error returned by the ACP child.
 *
 * DSH reports every failed `session/resume` as the same opaque `Internal error`
 * and puts the real cause in `error.data.details` (e.g. `first frame is not
 * exactly one header line`). Keeping `details` on the error lets a caller
 * surface that cause without parsing a free-form message that changes between
 * releases.
 */
export class AcpRequestError extends Error {
  readonly code?: number;
  readonly details?: string;

  constructor(message: string, options: { code?: number; details?: string } = {}) {
    super(message);
    this.name = 'AcpRequestError';
    this.code = options.code;
    this.details = options.details;
  }
}

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
  /** Bounds how long a cancelled turn may stay unsettled before it is ended locally. */
  cancelSettleTimeoutMs?: number;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  /** Optional timeout that rejects the request if the ACP child never responds. */
  timer?: ReturnType<typeof setTimeout>;
  /** Deadline armed by `cancel`; cleared when the child settles the turn itself. */
  cancelSettleTimer?: ReturnType<typeof setTimeout>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 3_600_000;
/**
 * How long a cancelled turn may stay unsettled before the client settles it
 * itself. `session/cancel` is a notification, so an agent that does not honour
 * it leaves `session/prompt` pending until `promptTimeoutMs` — an hour of a
 * spinner after the user pressed stop.
 */
const DEFAULT_CANCEL_SETTLE_TIMEOUT_MS = 30_000;
/** Upper bound on cached per-session config-option lists for one ACP child. */
const MAX_CONFIG_OPTION_SESSIONS = 256;

/** Minimal Agent Client Protocol client over newline-delimited JSON-RPC stdio. */
export class AcpClient {
  private readonly child: ChildProcess;
  private readonly handlers: AcpClientHandlers;
  private readonly logPrefix: string;
  private readonly requestTimeoutMs: number;
  private readonly promptTimeoutMs: number;
  private readonly cancelSettleTimeoutMs: number;
  private buffer = '';
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  /** ACP session id → the `session/prompt` request id still waiting on it. */
  private readonly promptIdBySession = new Map<string, number>();
  /**
   * Latest standard config-option state per ACP session, captured from
   * `session/new` and every `session/set_config_option` reply. Consumers need
   * the advertised choices to map a harness-native selection onto an opaque
   * config value; ACP has no standalone "get config" request.
   */
  private readonly configOptionsBySession = new Map<string, unknown[]>();
  private closed = false;
  /** Newest stderr line, surfaced in the exit error so a failed handshake is diagnosable. */
  private lastStderrLine: string | null = null;

  constructor(child: ChildProcess, handlers: AcpClientHandlers, options: AcpClientOptions = {}) {
    this.child = child;
    this.handlers = handlers;
    this.logPrefix = options.logPrefix ?? 'ACP';
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.promptTimeoutMs = options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
    this.cancelSettleTimeoutMs = options.cancelSettleTimeoutMs ?? DEFAULT_CANCEL_SETTLE_TIMEOUT_MS;
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

    // Any other frame carrying a `method` is a server→client request or
    // notification the client does not implement. A notification (no id) is
    // simply ignored, but a request MUST be answered: JSON-RPC 2.0 reserves
    // -32601 for an unknown method, and staying silent leaves the child
    // awaiting a reply to its request forever. This branch also keeps such a
    // frame out of the response path below, where its id would otherwise be
    // mistaken for the answer to a client request.
    if (typeof message.method === 'string') {
      if (message.id !== undefined && message.id !== null) {
        this.respondMethodNotFound(message.id, message.method);
      }
      return;
    }

    if (typeof message.id === 'number') {
      const request = this.settle(message.id);
      if (!request) {
        return;
      }
      if (message.error) {
        const error = message.error as AnyRecord;
        const data = error.data as AnyRecord | undefined;
        request.reject(new AcpRequestError(
          String(error.message ?? `${this.logPrefix} request failed`),
          {
            code: typeof error.code === 'number' ? error.code : undefined,
            details: typeof data?.details === 'string' ? data.details : undefined,
          },
        ));
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

  /** Writes one client→server notification: a frame with no id, which the agent never answers. */
  private notify(method: string, params: AnyRecord): boolean {
    if (this.closed || !this.child.stdin!.writable) {
      return false;
    }
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    return true;
  }

  /** Answers a server→client request the client does not implement; JSON-RPC 2.0 requires this. */
  private respondMethodNotFound(id: unknown, method: string): void {
    if (!this.child.stdin!.writable) {
      return;
    }
    const error = { code: -32601, message: `Method not found: ${method}` };
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, error })}\n`);
  }

  private request(
    method: string,
    params: AnyRecord,
    timeoutMs = this.requestTimeoutMs,
    /** Receives the id before the frame is written, for callers that must track it (cancel). */
    onWrite?: (id: number) => void,
  ): Promise<any> {
    if (this.closed) {
      return Promise.reject(new Error(`${this.logPrefix} server is not running.`));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(id)?.reject(new Error(
          `${this.logPrefix} request "${method}" timed out after ${timeoutMs}ms.`,
        ));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      onWrite?.(id);
      try {
        this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (error) {
        this.settle(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Removes one request from `pending` and cancels every deadline attached to
   * it. All settlement paths (reply, timeout, shutdown, local cancel) go
   * through here: a deadline left armed holds its request alive and keeps the
   * event loop busy for as long as it was set for.
   */
  private settle(id: number): PendingRequest | undefined {
    const request = this.pending.get(id);
    if (!request) {
      return undefined;
    }
    this.pending.delete(id);
    if (request.timer) {
      clearTimeout(request.timer);
    }
    if (request.cancelSettleTimer) {
      clearTimeout(request.cancelSettleTimer);
    }
    return request;
  }

  private shutdown(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const id of [...this.pending.keys()]) {
      this.settle(id)?.reject(error);
    }
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
    this.rememberConfigOptions(result.sessionId, result.configOptions);
    return result.sessionId;
  }

  /**
   * Re-attaches the server to a session it persisted earlier, so a restarted
   * child can continue an existing conversation instead of starting empty.
   * Used by the DSH runtime when the in-memory session table was lost (child
   * crash or CloudCLI restart).
   *
   * The ACP session id is supplied by the caller rather than returned, because
   * servers resume under their own id. Servers reject ids they are already
   * serving, so callers must track which ids this child has already created or
   * resumed.
   */
  async resumeSession(
    sessionId: string,
    cwd: string,
    extra: { mcpServers?: unknown[] } = {},
  ): Promise<void> {
    const result = await this.request('session/resume', {
      sessionId,
      cwd,
      mcpServers: extra.mcpServers ?? [],
    }) as AnyRecord;
    this.rememberConfigOptions(sessionId, result?.configOptions);
  }

  /**
   * Releases one session on the ACP side so the child stops holding its log
   * open. Used when a hidden copy (btw) or an edited-away session is deleted:
   * leaving it live lets the harness keep appending to a log this app is about
   * to remove, which the watcher then re-indexes.
   *
   * Servers answer an id they are not serving with an error; callers treat
   * that as "already gone" rather than a failure.
   */
  async closeSession(sessionId: string): Promise<void> {
    await this.request('session/close', { sessionId });
    this.configOptionsBySession.delete(sessionId);
  }

  /**
   * Returns the config-option state advertised for one session, or `undefined`
   * when the server has not reported any. Used by the DSH runtime to translate
   * a model id into the server's own opaque selection value.
   */
  getSessionConfigOptions(sessionId: string): unknown[] | undefined {
    return this.configOptionsBySession.get(sessionId);
  }

  /**
   * Applies one standard config option to a session and caches the returned
   * state. Used by the DSH runtime to make the model picked in CloudCLI the
   * model the harness actually routes the next turn to.
   */
  async setConfigOption(sessionId: string, configId: string, value: unknown): Promise<unknown[]> {
    const result = await this.request('session/set_config_option', {
      sessionId,
      configId,
      value,
    }) as AnyRecord;
    this.rememberConfigOptions(sessionId, result?.configOptions);
    return this.configOptionsBySession.get(sessionId) ?? [];
  }

  /** Stores the config-option list from a session response, ignoring malformed payloads. */
  private rememberConfigOptions(sessionId: string, configOptions: unknown): void {
    if (!Array.isArray(configOptions)) {
      return;
    }
    if (!this.configOptionsBySession.has(sessionId)) {
      const oldest = this.configOptionsBySession.keys().next().value;
      if (this.configOptionsBySession.size >= MAX_CONFIG_OPTION_SESSIONS && typeof oldest === 'string') {
        this.configOptionsBySession.delete(oldest);
      }
    }
    this.configOptionsBySession.set(sessionId, configOptions);
  }

  /**
   * Sends one turn. `prompt` is either plain text or the ACP content-block list;
   * a server that did not advertise `promptCapabilities.image` rejects an image
   * block outright, so callers decide whether to include them.
   */
  async prompt(
    sessionId: string,
    prompt: string | AcpPromptBlock[],
    timeoutMs = this.promptTimeoutMs,
  ): Promise<{ stopReason: string }> {
    let promptId: number | undefined;
    try {
      // The turn can legitimately run for minutes; the timeout only guards
      // against a hung child so the run cannot wedge forever.
      const result = await this.request('session/prompt', {
        sessionId,
        prompt: typeof prompt === 'string' ? [{ type: 'text', text: prompt }] : prompt,
      }, timeoutMs, (id) => {
        promptId = id;
        this.promptIdBySession.set(sessionId, id);
      }) as AnyRecord;
      return { stopReason: typeof result?.stopReason === 'string' ? result.stopReason : 'error' };
    } finally {
      // Only drop the mapping this turn owns: a later turn on the same session
      // may already have replaced it.
      if (promptId !== undefined && this.promptIdBySession.get(sessionId) === promptId) {
        this.promptIdBySession.delete(sessionId);
      }
    }
  }

  /**
   * Cancels one session's in-flight turn.
   *
   * ACP defines `session/cancel` as a notification: the agent answers nothing
   * and instead settles the pending `session/prompt` with stopReason
   * `cancelled`. Sending it as a request makes the agent reply -32601, and the
   * connection must survive that: one child serves every session, so closing it
   * would abort the runs that were never cancelled.
   *
   * A cancelled notification can still be ignored (an agent that does not
   * implement it, or one wedged in a tool call). That turn would otherwise sit
   * in `pending` until `promptTimeoutMs` — an hour — while the chat already
   * reports itself stopped, so the client settles it locally after
   * `cancelSettleTimeoutMs`. Returns false when the notification never reached
   * the child (already closed / stdin gone).
   */
  cancel(sessionId: string): boolean {
    const promptId = this.promptIdBySession.get(sessionId);
    const sent = this.notify('session/cancel', { sessionId });
    const request = promptId === undefined ? undefined : this.pending.get(promptId);
    if (promptId !== undefined && request && !request.cancelSettleTimer) {
      const timer = setTimeout(() => {
        // Same settlement the agent would have sent: `prompt()` resolves and
        // both runtimes turn `cancelled` into an aborted completion. Anything
        // the child sends for this id afterwards is ignored (the id is gone
        // from `pending`), and late chunks are dropped because the runtime has
        // already dropped the run.
        this.settle(promptId)?.resolve({ stopReason: 'cancelled' });
      }, this.cancelSettleTimeoutMs);
      timer.unref();
      request.cancelSettleTimer = timer;
    }
    return sent;
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
