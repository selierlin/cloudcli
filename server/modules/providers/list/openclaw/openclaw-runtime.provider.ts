import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { resolveOpenclawCommand } from '@/modules/providers/list/openclaw/openclaw-auth.provider.js';
import {
  getOpenclawDefaultAgentId,
  getOpenclawHomeDir,
} from '@/modules/providers/list/openclaw/openclaw-models.provider.js';
import {
  AcpClient,
  type AcpPermissionOption,
  type AcpPermissionRequest,
  type AcpPermissionResponder,
  type AcpToolCallUpdate,
} from '@/modules/providers/shared/acp/acp.client.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { AnyRecord, NormalizedMessage, ProviderRuntimeWriter } from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

// ---------- Process and session lifecycle ----------
//
// OpenClaw only streams a turn over ACP: `openclaw acp` bridges stdio JSON-RPC
// to the resident Gateway (`ws://127.0.0.1:<port>`). `openclaw agent --json`
// runs a whole turn and prints one payload, so it cannot drive the chat UI. One
// ACP child serves every session; each run attaches its session to the Gateway
// by passing the stored OpenClaw session key (`agent:<agentId>:<key>`) as
// `_meta.sessionKey` on `session/new`. Unlike DSH, OpenClaw's chunk frames carry
// no `messageId`, so the runtime mints a per-segment id and accumulates the
// deltas itself.
//
// The Gateway is NOT started or stopped here — it is a long-lived service the
// user manages. When it is down the ACP child exits immediately and the failure
// surfaces as a run error.

type AcpServerState = {
  client: AcpClient;
  /** App session id → this process's ACP session id (kept for the connection lifetime). */
  sessionByApp: Map<string, string>;
};

/** Upper bound on live app→ACP session mappings so a long-lived server cannot grow without limit. */
const MAX_SESSION_MAPPINGS = 256;

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
  permissionMode: 'default' | 'auto';
  toolCalls: Map<string, AcpToolCallUpdate>;
  /**
   * The run's stable synthetic ids. OpenClaw's `agent_message_chunk` /
   * `agent_thought_chunk` frames carry no `messageId` (unlike DSH), so the
   * runtime mints one per segment and accumulates the deltas itself: the
   * emitted content is the segment's full text so far, and the stable id lets
   * the client upsert one growing row. A tool call seals the current segment so
   * text after it starts a fresh row.
   */
  runId: string;
  textIndex: number;
  thinkingIndex: number;
  textBuffer: string;
  thinkingBuffer: string;
};

type PendingOpenclawPermission = {
  requestId: string;
  appSessionId: string;
  acpSessionId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  receivedAt: Date;
  options: AcpPermissionOption[];
  writer: ProviderRuntimeWriter;
  respond: AcpPermissionResponder;
};

let acpServer: AcpServerState | null = null;
/** In-flight ACP spawn+initialize, so concurrent first runs share one child process. */
let acpServerPromise: Promise<AcpServerState> | null = null;
/** ACP session id → in-flight run, for routing updates and permission requests to the right writer. */
const activeRuns = new Map<string, ActiveRun>();
/** CloudCLI request id → an ACP permission request awaiting a user decision. */
const pendingPermissions = new Map<string, PendingOpenclawPermission>();

const textSegmentId = (run: ActiveRun): string => `openclaw-${run.runId}-text-${run.textIndex}`;
const thinkingSegmentId = (run: ActiveRun): string => `openclaw-${run.runId}-thinking-${run.thinkingIndex}`;

/** Starts a fresh assistant/thinking segment (called when a tool call interrupts the reply). */
function sealSegments(run: ActiveRun): void {
  run.textIndex += 1;
  run.thinkingIndex += 1;
  run.textBuffer = '';
  run.thinkingBuffer = '';
}

/** Records tool-call metadata so a later ACP permission request can name the tool and show its input. */
function handleAcpToolCall(sessionId: string, toolCall: AcpToolCallUpdate): void {
  const run = activeRuns.get(sessionId);
  if (!run) {
    return;
  }
  run.toolCalls.set(toolCall.toolCallId, toolCall);
  // A tool call ends the surrounding text/thinking segment; anything after it
  // is a new row, so the reply reads text → tool → text.
  sealSegments(run);
  for (const message of run.normalize({
    type: 'tool_call',
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    input: toolCall.input,
  }, run.appSessionId)) {
    run.writer.send(message);
  }
}

function handleAcpToolCallUpdate(sessionId: string, update: AnyRecord): void {
  const run = activeRuns.get(sessionId);
  if (!run) {
    return;
  }
  const status = typeof update.status === 'string' ? update.status : '';
  if (status === 'in_progress') {
    return;
  }
  const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : undefined;
  if (!toolCallId) {
    return;
  }
  for (const message of run.normalize({
    type: 'tool_call_update',
    toolCallId,
    status,
    isError: status === 'failed' || status === 'error',
    content: update.content,
    output: update.rawOutput,
  }, run.appSessionId)) {
    run.writer.send(message);
  }
}

/** Picks the ACP option matching a CloudCLI allow/deny decision. */
function selectPermissionOption(
  options: AcpPermissionOption[],
  allow: boolean,
): AcpPermissionOption | undefined {
  const expectedKind = allow ? 'allow_once' : 'reject_once';
  const expectedOptionId = allow ? 'allow-once' : 'deny';
  return options.find((option) => option.kind === expectedKind)
    ?? options.find((option) => option.optionId === expectedOptionId);
}

/** Emits the normalized event that retracts a pending prompt from every attached chat client. */
function sendPermissionRetracted(
  pending: PendingOpenclawPermission,
  kind: 'permission_resolved' | 'permission_cancelled',
  reason?: string,
): void {
  pending.writer.send(createNormalizedMessage({
    kind,
    requestId: pending.requestId,
    reason,
    sessionId: pending.appSessionId,
    provider: 'openclaw',
  }));
}

function cancelPendingPermission(pending: PendingOpenclawPermission, reason: string): void {
  if (!pendingPermissions.has(pending.requestId)) {
    return;
  }
  pendingPermissions.delete(pending.requestId);
  sendPermissionRetracted(pending, 'permission_cancelled', reason);
  pending.respond({ outcome: 'cancelled' });
}

function cancelPendingPermissionsForAcpSession(acpSessionId: string, reason: string): void {
  for (const pending of [...pendingPermissions.values()]) {
    if (pending.acpSessionId === acpSessionId) {
      cancelPendingPermission(pending, reason);
    }
  }
}

function cancelAllPendingPermissions(reason: string): void {
  for (const pending of [...pendingPermissions.values()]) {
    cancelPendingPermission(pending, reason);
  }
}

/** Routes an OpenClaw ACP permission request into the CloudCLI permission gateway. */
function handleAcpPermissionRequest(
  acpSessionId: string,
  request: AcpPermissionRequest,
  respond: AcpPermissionResponder,
): void {
  const run = activeRuns.get(acpSessionId);
  if (!run) {
    respond({ outcome: 'cancelled' });
    return;
  }

  if (run.permissionMode === 'auto') {
    const option = selectPermissionOption(request.options, true);
    respond(option
      ? { outcome: 'selected', optionId: option.optionId }
      : { outcome: 'cancelled' });
    return;
  }

  const toolCall = request.toolCallId ? run.toolCalls.get(request.toolCallId) : undefined;
  const pending: PendingOpenclawPermission = {
    requestId: randomUUID(),
    appSessionId: run.appSessionId,
    acpSessionId,
    toolName: toolCall?.toolName ?? 'OpenClaw permission',
    input: toolCall?.input,
    context: {
      options: request.options,
      toolCallId: request.toolCallId,
    },
    receivedAt: new Date(),
    options: request.options,
    writer: run.writer,
    respond,
  };
  pendingPermissions.set(pending.requestId, pending);
  run.writer.send(createNormalizedMessage({
    kind: 'permission_request',
    requestId: pending.requestId,
    toolName: pending.toolName,
    input: pending.input,
    context: pending.context,
    sessionId: pending.appSessionId,
    provider: 'openclaw',
  }));
}

/** Answers a pending OpenClaw permission request from `chat.permission-response`. */
function resolveOpenclawPermission(
  requestId: string,
  decision: { allow: boolean },
): void {
  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    return;
  }
  const option = selectPermissionOption(pending.options, decision.allow);
  if (!option) {
    cancelPendingPermission(pending, 'Unsupported OpenClaw permission option');
    return;
  }

  pendingPermissions.delete(requestId);
  sendPermissionRetracted(pending, 'permission_resolved');
  pending.respond({ outcome: 'selected', optionId: option.optionId });
}

/** Returns pending OpenClaw prompts in the shape `chat.subscribe` sends to the frontend. */
function listPendingOpenclawPermissions(appSessionId: string): unknown[] {
  return [...pendingPermissions.values()]
    .filter((pending) => pending.appSessionId === appSessionId)
    .map((pending) => ({
      requestId: pending.requestId,
      toolName: pending.toolName,
      input: pending.input,
      context: pending.context,
      sessionId: pending.appSessionId,
      provider: 'openclaw',
      receivedAt: pending.receivedAt,
    }));
}

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

/** Lazily spawns the OpenClaw ACP bridge and negotiates the protocol. */
async function ensureAcpServer(): Promise<AcpServerState> {
  // A dead server (crashed child / closed client) must never be handed out:
  // drop the cache so the next call spawns a fresh ACP process.
  if (acpServer && acpServer.client.isClosed) {
    acpServer = null;
  }
  if (acpServer) {
    return acpServer;
  }
  // Reuse the in-flight spawn for concurrent first runs so only one ACP child
  // is ever created; otherwise every caller spawns its own process.
  if (acpServerPromise) {
    return acpServerPromise;
  }

  registerProcessShutdownHook();

  const { command, baseArgs } = resolveOpenclawCommand();
  if (!command) {
    throw new Error('OpenClaw CLI not found (set OPENCLAW_COMMAND or install OpenClaw).');
  }

  // The ACP bridge reads the user's own harness home (Gateway URL/token, model
  // config, skills). Pin OPENCLAW_STATE_DIR so the child and the session readers
  // in `getOpenclawHomeDir()` agree on the same root.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  childEnv.OPENCLAW_STATE_DIR = getOpenclawHomeDir();
  // `--no-prefix-cwd` stops the bridge prepending `[Working directory: <cwd>]`
  // to every prompt. The session already carries its working directory (the ACP
  // `session/new` cwd and the engine's own Workspace section), so the prefix is
  // redundant and would otherwise be stored on, and shown as part of, the user's
  // message.
  const child = spawn(command, [...baseArgs, 'acp', '--no-prefix-cwd'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv,
  });

  const client = new AcpClient(child, {
    onMessageChunk: (acpSessionId, text) => {
      const run = activeRuns.get(acpSessionId);
      if (!run || !text) {
        return;
      }
      run.textBuffer += text;
      for (const message of run.normalize(
        { type: 'agent_message_chunk', content: run.textBuffer, messageId: textSegmentId(run) },
        run.appSessionId,
      )) {
        run.writer.send(message);
      }
    },
    onThoughtChunk: (acpSessionId, text) => {
      const run = activeRuns.get(acpSessionId);
      if (!run || !text) {
        return;
      }
      run.thinkingBuffer += text;
      for (const message of run.normalize(
        { type: 'agent_thought_chunk', content: run.thinkingBuffer, messageId: thinkingSegmentId(run) },
        run.appSessionId,
      )) {
        run.writer.send(message);
      }
    },
    onToolCall: handleAcpToolCall,
    onToolCallUpdate: handleAcpToolCallUpdate,
    onRequestPermission: handleAcpPermissionRequest,
    // The child crashed or was closed: drop the cached server so the next run
    // spawns a fresh process instead of reusing a dead one.
    onClose: () => {
      cancelAllPendingPermissions('OpenClaw ACP bridge closed');
      if (acpServer?.client === client) {
        acpServer = null;
      }
    },
  }, { logPrefix: 'OpenClaw ACP' });

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

/** Builds a fresh OpenClaw session key (`agent:<agentId>:<uid>`) for a brand-new conversation. */
function createOpenclawSessionKey(): string {
  const agentId = getOpenclawDefaultAgentId() ?? 'main';
  return `agent:${agentId}:${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** Provider registry runtime adapter driving the OpenClaw ACP bridge. */
export const openclawRuntime: IProviderRuntime = {
  async run(command, options, writer, context) {
    const appSessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
    if (!appSessionId) {
      writer.send(createCompleteMessage({ provider: 'openclaw', sessionId: null, exitCode: 1 }));
      return;
    }

    const sessionName = typeof options.sessionSummary === 'string'
      ? options.sessionSummary
      : undefined;
    const userId = writer.userId ?? null;

    // Server startup and session attachment live inside the try so a failed
    // spawn or session/new surfaces as a normalized error + complete instead of
    // an unhandled rejection that drops the chat's message stream.
    let server: AcpServerState | null = null;
    let acpSessionId: string | null = null;
    try {
      server = await ensureAcpServer();
      const existing = server.sessionByApp.get(appSessionId);
      if (existing) {
        acpSessionId = existing;
      } else {
        // The OpenClaw session key is the app's provider session id. A brand-new
        // conversation has none yet, so mint one and announce it; a resumed one
        // re-attaches to the key it already stored.
        const storedKey = context.resolveProviderSessionId(appSessionId);
        const sessionKey = storedKey ?? createOpenclawSessionKey();
        const cwd = typeof options.cwd === 'string' && options.cwd
          ? options.cwd
          : typeof options.projectPath === 'string' && options.projectPath
            ? options.projectPath
            : process.cwd();
        acpSessionId = await server.client.newSession(cwd, { meta: { sessionKey } });
        server.sessionByApp.set(appSessionId, acpSessionId);
        trimSessionMappings(server.sessionByApp);
        if (!storedKey) {
          // Announce the provider-native (OpenClaw) session key so the chat
          // writer maps it to the app session row. History reads later resolve
          // the transcript through this key.
          writer.send(createNormalizedMessage({
            kind: 'session_created',
            newSessionId: sessionKey,
            sessionId: appSessionId,
            provider: 'openclaw',
          }));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writer.send(createNormalizedMessage({
        kind: 'error',
        content: message,
        sessionId: appSessionId,
        provider: 'openclaw',
      }));
      writer.send(createCompleteMessage({ provider: 'openclaw', sessionId: appSessionId, exitCode: 1 }));
      notifyRunFailed({ userId, provider: 'openclaw', sessionId: appSessionId, sessionName, error: message });
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
        provider: 'openclaw',
      }));
      writer.send(createCompleteMessage({
        provider: 'openclaw',
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
      permissionMode: options.permissionMode === 'auto' ? 'auto' : 'default',
      toolCalls: new Map(),
      runId: randomUUID().replace(/-/g, '').slice(0, 12),
      textIndex: 0,
      thinkingIndex: 0,
      textBuffer: '',
      thinkingBuffer: '',
    });

    try {
      const { stopReason } = await server.client.prompt(acpSessionId, command);
      if (stopReason === 'cancelled') {
        writer.send(createCompleteMessage({
          provider: 'openclaw',
          sessionId: appSessionId,
          actualSessionId: acpSessionId,
          exitCode: 0,
          aborted: true,
        }));
        notifyRunStopped({ userId, provider: 'openclaw', sessionId: appSessionId, sessionName, stopReason: 'aborted' });
        return;
      }
      // ACP stop reasons other than refusal/unknown mean the turn finished
      // normally: `end_turn` (complete) or a resource limit was hit
      // (`max_tokens` / `max_turn_requests`), which is not a failure.
      if (stopReason === 'end_turn' || stopReason === 'max_tokens' || stopReason === 'max_turn_requests') {
        writer.send(createCompleteMessage({
          provider: 'openclaw',
          sessionId: appSessionId,
          actualSessionId: acpSessionId,
          exitCode: 0,
        }));
        notifyRunStopped({ userId, provider: 'openclaw', sessionId: appSessionId, sessionName, stopReason: 'completed' });
        return;
      }
      writer.send(createCompleteMessage({
        provider: 'openclaw',
        sessionId: appSessionId,
        actualSessionId: acpSessionId,
        exitCode: 1,
      }));
      notifyRunFailed({ userId, provider: 'openclaw', sessionId: appSessionId, sessionName, error: `OpenClaw turn ended with ${stopReason}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writer.send(createNormalizedMessage({
        kind: 'error',
        content: message,
        sessionId: appSessionId,
        provider: 'openclaw',
      }));
      writer.send(createCompleteMessage({
        provider: 'openclaw',
        sessionId: appSessionId,
        actualSessionId: acpSessionId,
        exitCode: 1,
      }));
      notifyRunFailed({ userId, provider: 'openclaw', sessionId: appSessionId, sessionName, error: message });
    } finally {
      activeRuns.delete(acpSessionId);
      cancelPendingPermissionsForAcpSession(acpSessionId, 'OpenClaw run ended');
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
      cancelPendingPermissionsForAcpSession(acpSessionId, 'aborted');
      await server.client.cancel(acpSessionId);
      return true;
    } catch {
      return false;
    }
  },

  permissions: {
    resolve: resolveOpenclawPermission,
    listPending: listPendingOpenclawPermissions,
  },
};

/** Drops the ACP bridge process and all live session mappings (used by tests). */
export function resetOpenclawRuntimeForTests(): void {
  if (acpServer) {
    acpServer.client.close();
    acpServer = null;
  }
  acpServerPromise = null;
  activeRuns.clear();
  cancelAllPendingPermissions('test reset');
}
