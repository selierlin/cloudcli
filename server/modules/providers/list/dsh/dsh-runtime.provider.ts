import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { AcpClient, AcpRequestError, type AcpPermissionOption, type AcpPermissionRequest, type AcpPermissionResponder, type AcpToolCallUpdate } from '@/modules/providers/shared/acp/acp.client.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  NormalizedMessage,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

import { DSH_ACP_PROFILE, getDshHome, getDshSessionsRoot } from './dsh-models.provider.js';
import { buildDshPromptBlocks, isAcpImageRejection } from './dsh-prompt.js';

// ---------- Process and session lifecycle ----------

type AcpServerState = {
  client: AcpClient;
  /** App session id → ACP session id (kept alive for the connection lifetime). */
  sessionByApp: Map<string, string>;
  /**
   * ACP session ids this child has created or resumed. The server rejects
   * `session/resume` for an id it is already serving, so a mapping restored
   * from the database may be resumed at most once per child. Never evicted:
   * dropping an entry would make the next run resume an id the child still
   * holds, which the server answers with an error.
   */
  liveAcpIds: Set<string>;
  /**
   * In-flight `session/resume` per ACP session id. Two runs can reach the
   * same persisted session before either has recorded it in `liveAcpIds`;
   * sharing one request keeps the second from being rejected as
   * "session is already active".
   */
  resuming: Map<string, Promise<void>>;
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
  permissionMode: 'default' | 'auto';
  toolCalls: Map<string, AcpToolCallUpdate>;
  /**
   * Accumulated chunk text per `kind:messageId`. ACP chunks for one message
   * share its `messageId`; text and reasoning of the same message MUST
   * accumulate under different keys so they never fold into each other.
   * Cleared with the run.
   */
  chunkBuffers: Map<string, string>;
};

type PendingDshPermission = {
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
/**
 * Set when the harness config changed while a turn was running.
 *
 * The child mounts its MCP servers at startup, so the change is only visible
 * after a respawn; dropping it mid-turn would abort the turn. The flag keeps
 * the request instead of losing it, and the next spawn honours it.
 */
let restartDeferred = false;

/**
 * Folds one ACP chunk into its message's accumulated text and returns the
 * snapshot. Chunks of one message share its `messageId`, so the emitted
 * content is the message's full text so far — the stable id lets the client
 * upsert one growing row instead of stacking blocks. Text and reasoning of
 * the same message accumulate under different keys so they never fold into
 * each other.
 */
function accumulateChunk(
  run: ActiveRun,
  kind: 'text' | 'thinking',
  messageId: string | undefined,
  text: string,
): string {
  if (!messageId) {
    return text;
  }
  const key = `${kind}:${messageId}`;
  const accumulated = `${run.chunkBuffers.get(key) ?? ''}${text}`;
  run.chunkBuffers.set(key, accumulated);
  return accumulated;
}
/** CloudCLI request id → an ACP permission request awaiting a user decision. */
const pendingPermissions = new Map<string, PendingDshPermission>();

/** Records tool-call metadata so a later ACP permission request can name the tool and show its input. */
function handleAcpToolCall(sessionId: string, toolCall: AcpToolCallUpdate): void {
  activeRuns.get(sessionId)?.toolCalls.set(toolCall.toolCallId, toolCall);
}

/** Picks the DSH ACP option matching a CloudCLI allow/deny decision. */
function selectPermissionOption(
  options: AcpPermissionOption[],
  allow: boolean,
): AcpPermissionOption | undefined {
  const expectedKind = allow ? 'allow_once' : 'reject_once';
  const expectedOptionId = allow ? 'allow-once' : 'reject-once';
  return options.find((option) => option.kind === expectedKind)
    ?? options.find((option) => option.optionId === expectedOptionId);
}

/** Emits the normalized event that retracts a pending prompt from every attached chat client. */
function sendPermissionRetracted(
  pending: PendingDshPermission,
  kind: 'permission_resolved' | 'permission_cancelled',
  reason?: string,
): void {
  pending.writer.send(createNormalizedMessage({
    kind,
    requestId: pending.requestId,
    reason,
    sessionId: pending.appSessionId,
    provider: 'dsh',
  }));
}

/** Cancels one pending permission and tells the ACP server the request will not be answered. */
function cancelPendingPermission(pending: PendingDshPermission, reason: string): void {
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

/** Routes a DSH ACP permission request into the CloudCLI permission gateway. */
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
  const pending: PendingDshPermission = {
    requestId: randomUUID(),
    appSessionId: run.appSessionId,
    acpSessionId,
    toolName: toolCall?.toolName ?? 'DSH permission',
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
    provider: 'dsh',
  }));
}

/** Answers a pending DSH permission request from `chat.permission-response`. */
function resolveDshPermission(
  requestId: string,
  decision: { allow: boolean },
): void {
  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    return;
  }
  const option = selectPermissionOption(pending.options, decision.allow);
  if (!option) {
    cancelPendingPermission(pending, 'Unsupported DSH permission option');
    return;
  }

  pendingPermissions.delete(requestId);
  sendPermissionRetracted(pending, 'permission_resolved');
  pending.respond({ outcome: 'selected', optionId: option.optionId });
}

/** Returns pending DSH prompts in the shape `chat.subscribe` sends to the frontend. */
function listPendingDshPermissions(appSessionId: string): unknown[] {
  return [...pendingPermissions.values()]
    .filter((pending) => pending.appSessionId === appSessionId)
    .map((pending) => ({
      requestId: pending.requestId,
      toolName: pending.toolName,
      input: pending.input,
      context: pending.context,
      sessionId: pending.appSessionId,
      provider: 'dsh',
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

/**
 * Creates an ACP session, retrying across the settings-driven adapter
 * registration race: pi-ai registers provider routes from `$DSH_HOME/settings.yaml`
 * a moment after the ACP server starts serving, so a `session/new` sent in that
 * window fails with "no adapter registered" for the selected provider.
 */
async function createAcpSession(client: AcpClient, cwd: string, attempts = 8): Promise<string> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await client.newSession(cwd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('no adapter registered') || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('DSH ACP session creation failed');
}

/** Standard ACP config option that selects the provider/model route. */
const ACP_MODEL_CONFIG_ID = 'model';

/** Reads a DSH model choice value, which the harness encodes as `[provider, model]`. */
function parseAcpModelValue(value: string): { provider: string; model: string } | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
    ) {
      return { provider: parsed[0], model: parsed[1] };
    }
  } catch {
    // Not a tuple: this server does not expose model choices in the shape we map.
  }
  return undefined;
}

/**
 * Translates a CloudCLI picker value into the ACP `model` config option value.
 *
 * CloudCLI stores `<provider>/<model>` for catalogue-backed models and a bare
 * model id for the predefined fallback. DSH advertises each choice as
 * `JSON.stringify([provider, model])`, so the slash form is re-encoded and the
 * bare form is resolved against the session's advertised choices. Returns
 * `undefined` when the requested route is not offered, so the caller can fail
 * loudly instead of silently running the profile's default model.
 */
function resolveAcpModelValue(
  requested: string,
  configOptions: unknown[] | undefined,
): string | undefined {
  const advertised = new Set<string>();
  const valuesByModelId = new Map<string, string[]>();
  for (const option of configOptions ?? []) {
    const record = option as AnyRecord | undefined;
    if (record?.id !== ACP_MODEL_CONFIG_ID || !Array.isArray(record.options)) {
      continue;
    }
    for (const group of record.options) {
      const entries = (group as AnyRecord | undefined)?.options;
      if (!Array.isArray(entries)) {
        continue;
      }
      for (const entry of entries) {
        const value = (entry as AnyRecord | undefined)?.value;
        if (typeof value !== 'string') {
          continue;
        }
        advertised.add(value);
        const parsed = parseAcpModelValue(value);
        if (parsed) {
          valuesByModelId.set(parsed.model, [...(valuesByModelId.get(parsed.model) ?? []), value]);
        }
      }
    }
  }

  const separator = requested.indexOf('/');
  if (separator > 0 && separator < requested.length - 1) {
    const value = JSON.stringify([requested.slice(0, separator), requested.slice(separator + 1)]);
    // Before the catalogue is known, send the encoded route and let DSH validate it.
    return advertised.size === 0 || advertised.has(value) ? value : undefined;
  }

  const matches = valuesByModelId.get(requested) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Applies the CloudCLI-selected model to one ACP session.
 *
 * Retries the same settings-driven adapter-registration race that
 * {@link createAcpSession} handles: pi-ai registers provider routes a moment
 * after the ACP server starts serving, and setting a model through a route
 * that is not registered yet fails.
 */
async function applySessionModel(
  client: AcpClient,
  acpSessionId: string,
  requestedModel: string,
  attempts = 8,
): Promise<void> {
  const value = resolveAcpModelValue(requestedModel, client.getSessionConfigOptions(acpSessionId));
  if (!value) {
    throw new Error(`DSH does not offer a model matching "${requestedModel}".`);
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await client.setConfigOption(acpSessionId, ACP_MODEL_CONFIG_ID, value);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('no adapter registered') || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Turns one failed ACP request into a message the chat can show.
 *
 * DSH answers every failed `session/resume` with the same `Internal error` and
 * puts the real cause in `error.data.details`; the three condition names below
 * are the ones a user can act on. Anything else falls back to the details,
 * which is still more useful than repeating `Internal error`.
 */
function describeAcpFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof AcpRequestError ? error.details : undefined;
  const combined = details ? `${message} ${details}` : message;
  if (/not resumable/i.test(combined)) {
    return 'DSH can no longer resume this session (its transcript is missing or was replaced).';
  }
  if (/already active/i.test(combined)) {
    return 'The DSH session is already active.';
  }
  if (/cwd does not match/i.test(combined)) {
    return 'The DSH session was recorded under a different working directory.';
  }
  return details && details !== message ? `${message} (${details})` : message;
}

/** True when an ACP close failed only because the child was not serving the id. */
function isUnknownAcpSession(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof AcpRequestError ? error.details : undefined;
  return /unknown session|session not found/i.test(`${message} ${details ?? ''}`);
}

/** Lazily spawns the DSH ACP server process and negotiates the protocol. */
async function ensureAcpServer(): Promise<AcpServerState> {
  // A dead server (crashed child / closed client) must never be handed out:
  // drop the cache so the next call spawns a fresh ACP process.
  if (acpServer && acpServer.client.isClosed) {
    acpServer = null;
  }
  // A config write that arrived mid-turn could not restart the child without
  // aborting that turn; this is the first idle moment since, and a fresh spawn
  // is exactly what the write needs. Nothing is running here, so it is safe.
  if (acpServer && restartDeferred && activeRuns.size === 0) {
    acpServer.client.close();
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

  // The ACP server is the installed `dsh` CLI's official automation profile,
  // which mounts the user's own harness home (settings, credentials, skills,
  // global AGENTS.md). Pin DSH_HOME so the child and the session readers in
  // `getDshSessionsRoot()` agree on where sessions are persisted.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  childEnv.DSH_HOME = getDshHome();
  // Proxy variables, when configured, come from the global network setting that
  // the server writes onto process.env — a blank setting means the ACP server
  // goes direct rather than falling back to the macOS system proxy.
  const child = spawn('dsh', ['--profile', DSH_ACP_PROFILE], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv,
  });

  const client = new AcpClient(child, {
    onMessageChunk: (acpSessionId, text, messageId) => {
      const run = activeRuns.get(acpSessionId);
      if (!run) {
        return;
      }
      // The payload must carry `messageId` alongside the accumulated snapshot:
      // `DshSessionsProvider.normalizeMessage` reads it to pin the row's upsert
      // id, and dropping it here made the stable-id path unreachable while the
      // snapshot content replayed under fresh random ids.
      for (const message of run.normalize(
        { type: 'agent_message_chunk', content: accumulateChunk(run, 'text', messageId, text), messageId },
        run.appSessionId,
      )) {
        run.writer.send(message);
      }
    },
    onThoughtChunk: (acpSessionId, text, messageId) => {
      const run = activeRuns.get(acpSessionId);
      if (!run) {
        return;
      }
      for (const message of run.normalize(
        { type: 'agent_thought_chunk', content: accumulateChunk(run, 'thinking', messageId, text), messageId },
        run.appSessionId,
      )) {
        run.writer.send(message);
      }
    },
    onToolCall: handleAcpToolCall,
    onRequestPermission: handleAcpPermissionRequest,
    // The child crashed or was closed: drop the cached server so the next run
    // spawns a fresh process instead of reusing a dead one.
    onClose: () => {
      cancelAllPendingPermissions('DSH ACP server closed');
      if (acpServer?.client === client) {
        acpServer = null;
      }
    },
  }, {
    logPrefix: 'DSH ACP',
    promptTimeoutMs: Number(process.env.DSH_PROMPT_TIMEOUT_MS) || 3_600_000,
  });

  acpServerPromise = (async () => {
    try {
      await client.initialize();
    } catch (error) {
      client.close();
      throw error;
    }
    const state: AcpServerState = {
      client,
      sessionByApp: new Map(),
      liveAcpIds: new Set(),
      resuming: new Map(),
    };
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

    // Resolved before the try so the prompt builder can apply the same working
    // directory as the session.
    const cwd = typeof options.cwd === 'string' && options.cwd
      ? options.cwd
      : typeof options.projectPath === 'string' && options.projectPath
        ? options.projectPath
        : process.cwd();

    // Server startup and session creation live inside the try so a failed
    // spawn or session/new surfaces as a normalized error + complete instead
    // of an unhandled rejection that drops the chat's message stream.
    let server: AcpServerState | null = null;
    let acpSessionId: string | null = null;
    try {
      // Held in a local so the resume callback closes over a non-null state.
      const state = await ensureAcpServer();
      server = state;
      // The database is the source of truth for which provider session this app
      // session continues. Editing a message repoints the row to a derived
      // session id, and editing the first message detaches it, while the
      // in-memory mapping still names the pre-edit session. Trusting the cache
      // would silently keep running the old conversation.
      const persisted = context.resolveProviderSessionId(appSessionId);
      if (persisted) {
        state.sessionByApp.set(appSessionId, persisted);
      } else {
        state.sessionByApp.delete(appSessionId);
      }
      if (persisted) {
        // A child that restarted (crash, or a new CloudCLI process) has no
        // in-memory record of a persisted session, and `prompt` answers
        // "Unknown session" for it. Resume it once per child first.
        if (!state.liveAcpIds.has(persisted)) {
          let attempt = state.resuming.get(persisted);
          if (!attempt) {
            attempt = state.client.resumeSession(persisted, cwd).then(
              () => {
                state.liveAcpIds.add(persisted);
              },
              (error: unknown) => {
                throw new Error(`Could not resume DSH session ${persisted}: ${describeAcpFailure(error)}`);
              },
            ).finally(() => {
              state.resuming.delete(persisted);
            });
            state.resuming.set(persisted, attempt);
          }
          await attempt;
        }
        acpSessionId = persisted;
      } else {
        acpSessionId = await createAcpSession(state.client, cwd);
        state.liveAcpIds.add(acpSessionId);
        state.sessionByApp.set(appSessionId, acpSessionId);
        trimSessionMappings(state.sessionByApp);
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
      // Applied on every turn so switching the model in CloudCLI also affects
      // an existing ACP conversation. Without this the harness keeps running
      // its profile default (`agent-default-model`), whichever model the
      // picker shows.
      const requestedModel = typeof options.model === 'string' ? options.model.trim() : '';
      if (requestedModel) {
        await applySessionModel(server.client, acpSessionId, requestedModel);
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
      permissionMode: options.permissionMode === 'auto' ? 'auto' : 'default',
      toolCalls: new Map(),
      chunkBuffers: new Map(),
    });

    // Captured so the retry closure below sees a stable, narrowed session.
    const client = server.client;
    const sessionId = acpSessionId;

    try {
      // DSH advertises image support once at initialize, from the profile's
      // default model, but enforces it per turn against the model this session
      // was switched to. A text-only model therefore rejects blocks the
      // connection accepted at handshake; resend with path references so the
      // turn still runs and the model can read the file with its tools.
      const ask = async (): Promise<{ stopReason: string }> => {
        const blocks = await buildDshPromptBlocks(command, options.attachments, cwd);
        try {
          return await client.prompt(sessionId, blocks);
        } catch (error) {
          if (!blocks.some((block) => block.type === 'image') || !isAcpImageRejection(error)) {
            throw error;
          }
          console.warn('[DSH] The selected model rejected the image input; retrying with file paths.');
          return await client.prompt(
            sessionId,
            await buildDshPromptBlocks(command, options.attachments, cwd, { inlineImages: false }),
          );
        }
      };
      const { stopReason } = await ask();
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
      cancelPendingPermissionsForAcpSession(acpSessionId, 'DSH run ended');
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
    cancelPendingPermissionsForAcpSession(acpSessionId, 'aborted');
    // The turn settles through its pending `session/prompt` resolving with
    // stopReason "cancelled"; nothing waits here, and only this session ends.
    // A false return means the frame never reached the child (dead connection),
    // which the caller reports as an unsuccessful abort.
    return server.client.cancel(acpSessionId);
  },

  /**
   * Releases one conversation on the ACP side.
   *
   * Needed before deleting a hidden copy or an edited-away transcript: the
   * child keeps the log open, so a deleted session would be written back and
   * re-indexed by the watcher. Unlike `abort`, an id the child is not serving
   * is not an error — the goal (nothing holds it) is already met — and the
   * local tables are cleared either way so the next run starts a fresh session
   * instead of trusting a mapping that no longer exists.
   */
  async disposeSession(sessionId: string): Promise<void> {
    const server = acpServer;
    if (!server) {
      return;
    }
    // Callers may hold either the app id (chat surfaces) or the ACP id (btw's
    // copy bookkeeping); accept both.
    const acpSessionId = server.sessionByApp.get(sessionId) ?? sessionId;
    try {
      await server.client.closeSession(acpSessionId);
    } catch (error) {
      if (!isUnknownAcpSession(error)) {
        throw error;
      }
    } finally {
      server.liveAcpIds.delete(acpSessionId);
      for (const [appSessionId, mapped] of server.sessionByApp) {
        if (mapped === acpSessionId) {
          server.sessionByApp.delete(appSessionId);
        }
      }
    }
  },

  permissions: {
    resolve: resolveDshPermission,
    listPending: listPendingDshPermissions,
  },
};

/**
 * Drops the idle ACP child so the next turn boots a process that reads the
 * current harness config.
 *
 * The harness mounts its MCP servers when the ACP process starts, so a server
 * written mid-life is invisible to every session until the child restarts. Only
 * an idle process is dropped: closing one with an active turn would abort it,
 * so the request is remembered and honoured by the next spawn instead. A fresh
 * child resumes persisted sessions on demand, so dropping it costs no
 * conversation.
 *
 * Used by the DSH MCP provider after a successful write.
 *
 * @returns Whether the config is already in effect for the next turn.
 */
export function restartDshAcpServerIfIdle(): boolean {
  if (acpServerPromise || activeRuns.size > 0) {
    restartDeferred = true;
    return false;
  }

  restartDeferred = false;
  if (acpServer) {
    acpServer.client.close();
    acpServer = null;
  }

  return true;
}

/** Drops the ACP server process and all live session mappings (used by tests). */
export function resetDshRuntimeForTests(): void {
  if (acpServer) {
    acpServer.client.close();
    acpServer = null;
  }
  restartDeferred = false;
  activeRuns.clear();
  cancelAllPendingPermissions('test reset');
}
