/**
 * Codex runtime over `codex app-server`
 * =====================================
 *
 * Codex conversations run through the same binary's `app-server` subcommand
 * rather than the SDK's `codex exec` wrapper. The exec JSONL channel reports an
 * assistant message once, complete, on `item.completed`; only app-server emits
 * token-level deltas (`item/agentMessage/delta`, `item/reasoning/summaryTextDelta`),
 * which is what lets Codex stream like every other provider.
 *
 * ## Usage
 *
 * - codexRuntime.run(command, options, writer, context) - Execute a streamed prompt
 * - codexRuntime.abort(sessionId) - Cancel an active session
 */

import {
  appendFilesInputTag,
  buildCodexInputItems,
  normalizeImageDescriptors,
  createCompleteMessage,
  createNormalizedMessage,
} from '@/shared/index.js';
import { resolveCodexConfigOverrides } from '@/shared/codex-config.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import type { AnyRecord, NormalizedMessage, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';
import { createDeltaBatcher, readObjectRecord, readOptionalString } from '@/shared/utils.js';
import {
  CodexAppServerConnection,
  isCodexNotificationForActiveTurn,
  startCodexAppServerConnection,
} from '@/modules/providers/list/codex/codex-app-server.client.js';

type ActiveCodexSession = {
  connection: CodexAppServerConnection;
  status: 'running' | 'aborted' | 'completed';
  startedAt: string;
  /** Provider-native thread id, known once `thread/start` or `thread/resume` answers. */
  threadId: string | null;
  /** Id of the turn this connection is driving, known once `turn/start` answers. */
  turnId: string | null;
  /** Releases the run loop; called by abort and by an unexpected process end. */
  finish: () => void;
};

const activeCodexSessions = new Map<string, ActiveCodexSession>();

// Codex CLI requires non-whitespace stdin even when --image arguments are
// present, so attachment-only turns need a small text instruction.
const CODEX_IMAGE_ONLY_PROMPT = 'Please analyze the attached image(s).';

/**
 * How long `turn/interrupt` may take before the child is killed instead.
 *
 * Abort has to feel immediate: waiting on the same 30s request timeout as every
 * other call is indistinguishable from a hang when a turn is stuck in a tool.
 */
const TURN_INTERRUPT_TIMEOUT_MS = 2_000;

function readUsageNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reads the protocol's `ThreadTokenUsage` into the token-budget status row.
 *
 * The app-server reports flat camelCase counters under `total`; the shape this
 * returns is the one the client has always consumed.
 */
export function extractCodexTokenBudget(threadUsage: AnyRecord | null | undefined) {
  const usage = readObjectRecord(threadUsage);
  if (!usage) {
    return null;
  }
  const total = readObjectRecord(usage.total) ?? usage;

  const inputTokens = readUsageNumber(total.inputTokens);
  const outputTokens = readUsageNumber(total.outputTokens);
  const reasoningTokens = readUsageNumber(total.reasoningOutputTokens);
  const used = readUsageNumber(total.totalTokens) || inputTokens + outputTokens + reasoningTokens;

  return {
    used,
    total: readUsageNumber(usage.modelContextWindow) || 200000,
    inputTokens,
    outputTokens,
    reasoningTokens,
    breakdown: {
      input: inputTokens,
      output: outputTokens,
      reasoning: reasoningTokens,
    },
  };
}

/**
 * Translates `codex app-server` notifications into the event shapes
 * `CodexSessionsProvider.normalizeMessage` already consumes, so the same
 * renderer, store and history readers serve both the exec and the app-server
 * channels (see the "Codex 改用 app-server 协议流式化实施方案" document).
 *
 * The app-server reports item lifecycle in camelCase (`inProgress`,
 * `kind: {type:'add'}`) and reports progress as *deltas* rather than snapshots.
 * Both differences are normalized here, because this is the only layer that can
 * still see them.
 *
 * Stateful: one instance per run. Deltas name only an item id, so a snapshot of
 * each open item and the output assembled from its deltas have to be kept for
 * the row to render as a whole.
 *
 * Consumed by `queryCodex` only.
 */
export type CodexNotificationMapper = {
  /**
   * Maps one notification to zero or more events in the shape
   * `normalizeMessage` expects. Unknown methods and unrenderable items map to an
   * empty list rather than to a passthrough row.
   */
  transformCodexNotification(method: string, params: AnyRecord): AnyRecord[];
  /**
   * Reply text already published through `item/agentMessage/delta`, or
   * `undefined` when that message never streamed. The runtime compares it with
   * the transformed final row to avoid sending the reply twice (§5.5 方案二).
   */
  streamedText(itemId: string): string | undefined;
};

/** `codex app-server` spells in-flight item status `inProgress`; the normalizer reads `in_progress`. */
function normalizeCodexItemStatus(status: unknown): unknown {
  return status === 'inProgress' ? 'in_progress' : status;
}

/** A patch kind is `{type: 'add'|'delete'|'update'}` in the protocol but a bare string in the SDK shape. */
function normalizeCodexFileChangeKind(kind: unknown): unknown {
  return readObjectRecord(kind)?.type ?? kind;
}

/** `turn/plan/updated` steps are `{step, status}`; the normalizer's todo items are `{text, completed}`. */
function codexPlanStepsToTodoItems(plan: unknown): Array<{ text: string; completed: boolean }> {
  return (Array.isArray(plan) ? plan : []).map((step) => {
    const record = readObjectRecord(step) ?? {};
    return { text: String(record.step ?? ''), completed: record.status === 'completed' };
  });
}

/**
 * Renders one app-server `ThreadItem` as the event `normalizeMessage` consumes.
 *
 * `commandOutputSoFar` is the output assembled from this item's deltas, used
 * for an in-flight command because the server only sends the full
 * `aggregatedOutput` when the item completes.
 */
function mapCodexThreadItem(item: AnyRecord, commandOutputSoFar: string): AnyRecord[] {
  const itemId = readOptionalString(item.id);
  const itemType = readOptionalString(item.type);
  if (!itemId || !itemType) {
    return [];
  }

  switch (itemType) {
    case 'agentMessage':
      return [{
        type: 'item',
        itemType: 'agent_message',
        itemId,
        message: { role: 'assistant', content: String(item.text ?? '') },
      }];
    case 'reasoning': {
      // The protocol carries both the raw chain of thought (`content`) and the
      // model's summary of it. Only the summary is rendered — see the plan's D5.
      const summary = Array.isArray(item.summary)
        ? item.summary.filter((part: unknown): part is string => typeof part === 'string')
        : [];
      return [{
        type: 'item',
        itemType: 'reasoning',
        itemId,
        message: { role: 'assistant', content: summary.join('\n'), isReasoning: true },
      }];
    }
    case 'commandExecution':
      return [{
        type: 'item',
        itemType: 'command_execution',
        itemId,
        command: item.command,
        output: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : commandOutputSoFar,
        exitCode: item.exitCode,
        status: normalizeCodexItemStatus(item.status),
      }];
    case 'fileChange':
      return [{
        type: 'item',
        itemType: 'file_change',
        itemId,
        changes: (Array.isArray(item.changes) ? item.changes : []).map((change: unknown) => {
          const record = readObjectRecord(change) ?? {};
          return { path: record.path, kind: normalizeCodexFileChangeKind(record.kind), diff: record.diff };
        }),
        status: normalizeCodexItemStatus(item.status),
      }];
    case 'mcpToolCall':
      return [{
        type: 'item',
        itemType: 'mcp_tool_call',
        itemId,
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
        result: item.result,
        error: item.error,
        status: normalizeCodexItemStatus(item.status),
      }];
    case 'webSearch':
      return [{ type: 'item', itemType: 'web_search', itemId, query: item.query }];
    default:
      // Types the app has no renderer for (dynamicToolCall, subAgentActivity,
      // imageGeneration, …) keep the normalizer's generic tool-card fallback.
      // Two exceptions: `plan` is a separate capability (see §5.3.1), and
      // `userMessage` is the turn's own input echoed back — the client already
      // has the message the user typed, so rendering it adds a phantom card.
      if (itemType === 'plan' || itemType === 'userMessage') {
        return [];
      }
      return [{ type: 'item', itemType, itemId, item }];
  }
}

/**
 * Builds a mapper for one run. See `CodexNotificationMapper`.
 */
export function createCodexNotificationMapper(): CodexNotificationMapper {
  // Snapshot of each item seen through `item/started`, so an update that names
  // only an item id can still be rendered as a complete row.
  const openItems = new Map<string, AnyRecord>();
  // Command output assembled from `item/commandExecution/outputDelta`.
  const commandOutput = new Map<string, string>();
  // Reply text already published for an item, per §5.5 方案二.
  const streamed = new Map<string, string>();
  // Last summary block index seen per reasoning item, so a new block starts a
  // new paragraph rather than running into the previous one.
  const reasoningBlockIndex = new Map<string, number>();

  const resetTurn = () => {
    openItems.clear();
    commandOutput.clear();
    reasoningBlockIndex.clear();
    streamed.clear();
  };

  return {
    streamedText(itemId) {
      return streamed.get(itemId);
    },

    transformCodexNotification(method, params) {
      switch (method) {
        case 'item/started': {
          const item = readObjectRecord(params.item);
          const itemId = readOptionalString(item?.id);
          if (!item || !itemId) {
            return [];
          }
          openItems.set(itemId, item);
          // Only the two types that report progress over their own channel get a
          // row now; every other item carries no content yet, so it is rendered
          // once, on completion.
          if (item.type === 'commandExecution') {
            commandOutput.set(itemId, '');
            return mapCodexThreadItem(item, '');
          }
          if (item.type === 'mcpToolCall') {
            return mapCodexThreadItem(item, '');
          }
          return [];
        }

        case 'item/completed': {
          const item = readObjectRecord(params.item);
          const itemId = readOptionalString(item?.id);
          if (!item || !itemId) {
            return [];
          }
          const rows = mapCodexThreadItem(item, commandOutput.get(itemId) ?? '');
          openItems.delete(itemId);
          commandOutput.delete(itemId);
          reasoningBlockIndex.delete(itemId);
          // An agent message ends a reply segment, so prose streamed after the
          // next tool call renders as a fresh block. One `stream_end` per
          // message, not per turn: `delta → tool → delta` must come out as two
          // segments. `streamed` is kept for the runtime's final-frame decision.
          if (item.type === 'agentMessage') {
            rows.push({ type: 'stream_end' });
          }
          return rows;
        }

        case 'item/agentMessage/delta': {
          const itemId = readOptionalString(params.itemId);
          const delta = typeof params.delta === 'string' ? params.delta : '';
          if (!itemId || !delta) {
            return [];
          }
          streamed.set(itemId, (streamed.get(itemId) ?? '') + delta);
          return [{ type: 'stream_delta', streamChannel: 'text', content: delta, sourceItemId: itemId }];
        }

    case 'item/reasoning/summaryTextDelta': {
      const itemId = readOptionalString(params.itemId);
      const delta = typeof params.delta === 'string' ? params.delta : '';
      if (!itemId || !delta) {
        return [];
      }
      const blockIndex = typeof params.summaryIndex === 'number' ? params.summaryIndex : 0;
      const previousIndex = reasoningBlockIndex.get(itemId);
      reasoningBlockIndex.set(itemId, blockIndex);
      // The completed row joins the summary blocks with newlines, so a block
      // change has to show up in the streamed text too.
      const separator = previousIndex !== undefined && previousIndex !== blockIndex ? '\n' : '';
      const piece = separator + delta;
      // Recorded like the agent-message deltas: the completed reasoning row
      // carries the same summary text, and sending both would render the
      // thinking trace twice.
      streamed.set(itemId, (streamed.get(itemId) ?? '') + piece);
      return [{ type: 'stream_delta', streamChannel: 'thinking', content: piece, sourceItemId: itemId }];
    }

        // Raw chain-of-thought deltas are dropped: the summary channel is what
        // the completed reasoning row renders (plan §5.3.1 / D5).
        case 'item/reasoning/textDelta':
          return [];

        case 'item/commandExecution/outputDelta': {
          const itemId = readOptionalString(params.itemId);
          const open = itemId ? openItems.get(itemId) : undefined;
          const delta = typeof params.delta === 'string' ? params.delta : '';
          if (!itemId || !open || !delta) {
            return [];
          }
          const accumulated = (commandOutput.get(itemId) ?? '') + delta;
          commandOutput.set(itemId, accumulated);
          return mapCodexThreadItem({ ...open, status: 'inProgress' }, accumulated);
        }

        case 'item/mcpToolCall/progress': {
          const itemId = readOptionalString(params.itemId);
          const open = itemId ? openItems.get(itemId) : undefined;
          if (!itemId || !open) {
            return [];
          }
          const message = readOptionalString(params.message);
          return mapCodexThreadItem({
            ...open,
            status: 'inProgress',
            // The progress line is all the server sends mid-call; carry it in the
            // result slot the tool card already renders.
            result: message ? { content: [{ type: 'text', text: message }] } : open.result,
          }, '');
        }

        case 'turn/plan/updated': {
          const turnId = readOptionalString(params.turnId) ?? '';
          return [{
            type: 'item',
            itemType: 'todo_list',
            // One row per turn, so each plan update replaces the previous one.
            itemId: `plan_${turnId}`,
            items: codexPlanStepsToTodoItems(params.plan),
            eventType: 'turn.plan.updated',
          }];
        }

        case 'thread/tokenUsage/updated':
          // Forwarded as-is; the runtime keeps the last one and reports it once,
          // when the turn ends (plan R6).
          return [{ type: 'token_usage', usage: params.tokenUsage }];

        case 'error': {
          const error = readObjectRecord(params.error);
          // `willRetry: true` means the server is retrying and the turn is still
          // live, so rendering it would show a terminal error over a run that
          // continues — and would swallow the deltas that follow.
          if (params.willRetry === true) {
            return [];
          }
          return [{
            type: 'item',
            itemType: 'error',
            itemId: `error_${readOptionalString(params.turnId) ?? ''}`,
            message: {
              role: 'error',
              content: readOptionalString(error?.message) ?? 'Codex reported an error',
            },
          }];
        }

        case 'turn/started':
          return [{ type: 'turn_started' }];

        case 'thread/started': {
          const thread = readObjectRecord(params.thread);
          return [{ type: 'thread_started', threadId: readOptionalString(thread?.id) }];
        }

        case 'turn/completed': {
          const turn = readObjectRecord(params.turn);
          const status = readOptionalString(turn?.status);
          resetTurn();
          if (status === 'failed') {
            return [{ type: 'turn_failed', error: turn?.error }];
          }
          if (status === 'completed') {
            return [{ type: 'turn_complete' }];
          }
          // `interrupted` ends the turn without a terminal event: the abort path
          // owns that (plan §5.7), and `inProgress` is not a completion.
          return [];
        }

        default:
          return [];
      }
    },
  };
}

/**
 * Map permission mode to the sandbox/approval pair `thread/start` accepts.
 * @param {string} permissionMode - 'default', 'acceptEdits', or 'bypassPermissions'
 * @returns {object} - { sandboxMode, approvalPolicy }
 */
function mapPermissionModeToCodexOptions(permissionMode: string): {
  sandboxMode: 'workspace-write' | 'danger-full-access';
  approvalPolicy: 'never' | 'on-request';
} {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        // Current Codex CLI versions reject the retired `untrusted` policy.
        // Keep sandboxing enabled; exec cannot grant interactive approval requests.
        approvalPolicy: 'on-request'
      };
  }
}

/**
 * Reads `<key>.id` out of a response body, where the body is one of the
 * protocol's envelopes (`{ thread: {...} }`, `{ turn: {...} }`).
 */
function readNestedId(value: unknown, key: string): string | null {
  return readOptionalString(readObjectRecord(readObjectRecord(value)?.[key])?.id) ?? null;
}

/**
 * Converts the shared Codex input list into the protocol's `UserInput` shape.
 *
 * Two differences matter: the protocol spells the image variant `localImage`
 * (the SDK spells it `local_image`), and a text item carries a required
 * `text_elements` array. Converted here rather than in `buildCodexInputItems` so
 * the shared helper keeps serving the shape its own callers expect.
 */
function toAppServerInput(prompt: string, images: unknown, cwd: string): AnyRecord[] {
  return buildCodexInputItems(prompt, images, cwd).map((item) => (
    item.type === 'text'
      ? { type: 'text', text: item.text, text_elements: [] }
      : { type: 'localImage', path: item.path }
  ));
}

/**
 * Whether a completed item's row is a copy of prose that already streamed.
 *
 * The protocol publishes an assistant message and a reasoning trace twice: once
 * as deltas and once, whole, when the item completes. Only one of them may
 * become a row, or the reply renders twice. The comparison is verbatim because
 * the live path applies no transform to either side — it is the same text.
 */
function isAlreadyStreamedFinalRow(event: AnyRecord, mapper: CodexNotificationMapper): boolean {
  if (event.type !== 'item') {
    return false;
  }
  const itemType = readOptionalString(event.itemType);
  if (itemType !== 'agent_message' && itemType !== 'reasoning') {
    return false;
  }
  const itemId = readOptionalString(event.itemId);
  if (!itemId) {
    return false;
  }
  const streamed = mapper.streamedText(itemId);
  if (streamed === undefined) {
    return false;
  }
  const message = readObjectRecord(event.message);
  const content = typeof message?.content === 'string' ? message.content : '';
  return streamed === content;
}

/**
 * Execute a Codex query with streaming over `codex app-server`.
 *
 * One process per run: the turn is driven as JSON-RPC and every notification it
 * publishes is compiled by `createCodexNotificationMapper` into the same
 * normalized vocabulary the renderer already consumes.
 *
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
async function queryCodex(
  command: string,
  options: AnyRecord = {},
  ws: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
) {
  const {
    sessionId,
    sessionSummary,
    cwd,
    projectPath,
    model,
    effort,
    images,
    files,
    permissionMode = 'default'
  } = options;

  // Callers pass the stable app session id; Codex resumes threads with the
  // provider-native id recorded on the session row.
  const providerSessionId = context.resolveProviderSessionId(sessionId);

  // Provider-level custom config file (the Codex counterpart of
  // `claude --settings`), read once per run. Guarded so unit tests can pass a
  // context without it. The app-server takes it as the thread's `config`
  // overrides, the counterpart of the SDK's `--config` passthrough.
  const profilePath = (typeof context.resolveSettingsFile === 'function')
    ? context.resolveSettingsFile(sessionId)
    : null;
  const configOverrides = profilePath ? await resolveCodexConfigOverrides(profilePath) : null;

  const resolvedModel = await context.resolveResumeModel(sessionId, model);

  const workingDirectory = cwd || projectPath || process.cwd();
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);
  const catalog = await context.getProviderModels();
  const selectedModel = catalog.OPTIONS.find((option) => option.value === resolvedModel) || null;
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  const resolvedEffort = typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;

  const mapper = createCodexNotificationMapper();

  let connection: CodexAppServerConnection | null = null;
  // Provider-native thread id: starts as the resume id, or comes back with the
  // `thread/start` response for a brand-new session.
  let threadId: string | null = providerSessionId;
  let turnId: string | null = null;
  let sessionCreatedSent = false;
  // Message of the error that failed the turn, reported once the run settles.
  let terminalMessage: string | null = null;
  const failureText = () => terminalMessage ?? 'Codex turn failed';
  // Codex reports API failures as notifications, and then the child may also die
  // with a raw stderr wrapper. Showing both means the rendered error is followed
  // by unrelated CLI log lines, so the wrapper is dropped once the stream
  // already reported the failure.
  let errorSurfaced = false;
  // `thread/tokenUsage/updated` fires several times a turn; only the last value
  // is reported, once, when the turn ends.
  let latestTokenUsage: AnyRecord | null = null;
  // The turn reached a terminal status (as opposed to the child dying).
  let turnEnded = false;
  let turnFailed = false;
  // Set when the child dies before the turn ends.
  let exitReason: string | null = null;
  let completeSent = false;

  // Deltas arrive one token at a time — hundreds per reasoning pass — so they
  // are coalesced like the other CLI runtimes. `streamHalted` becomes true once
  // this run must publish nothing further, so a late delta cannot resurrect a
  // row the client already finalized.
  let streamHalted = false;
  const deltaBatcher = createDeltaBatcher((message) => {
    if (message.kind === 'complete') {
      streamHalted = true;
    }
    if (message.kind === 'stream_delta' && streamHalted) {
      return;
    }
    sendMessage(ws, message);
  });
  const send = (message: NormalizedMessage) => deltaBatcher.send(message);

  // Released by the turn's terminal notification, by abort, or by the child
  // dying — whichever comes first.
  let releaseRun: () => void = () => {};
  const runSettled = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });

  // Session-map key: the app session id when the caller supplied one, else the
  // provider-native thread id once known (legacy/direct API callers).
  const sessionKey = () => sessionId || threadId || null;
  const currentSession = () => {
    const key = sessionKey();
    return key ? activeCodexSessions.get(key) : undefined;
  };

  /**
   * Publishes the terminal `complete` exactly once. Aborted runs publish none:
   * the abort handler emits that one on their behalf.
   */
  const publishComplete = (exitCode: number): void => {
    if (completeSent) {
      return;
    }
    completeSent = true;
    const outcomeSessionId = threadId || sessionId || null;
    send(createCompleteMessage({
      provider: 'codex',
      sessionId: outcomeSessionId,
      actualSessionId: outcomeSessionId,
      exitCode,
    }));
  };

  const handleNotification = (method: string, rawParams: unknown): void => {
    const params = readObjectRecord(rawParams) ?? {};
    // One connection drives one thread and one turn, but the protocol can still
    // deliver frames that are not that turn's: `thread/started` on the
    // new-session path, and past turns if a resume ever leaked its history.
    if (!isCodexNotificationForActiveTurn(params, { threadId: threadId ?? undefined, turnId: turnId ?? undefined })) {
      return;
    }

    for (const event of mapper.transformCodexNotification(method, params)) {
      // Terminal bookkeeping is the runtime's to do; the mapped turn events are
      // not rows, and normalizing them here would emit a second `complete`.
      if (event.type === 'turn_complete') {
        turnEnded = true;
        releaseRun();
        continue;
      }
      if (event.type === 'turn_failed') {
        turnEnded = true;
        turnFailed = true;
        terminalMessage = readOptionalString(readObjectRecord(event.error)?.message) ?? 'Codex turn failed';
        releaseRun();
        continue;
      }
      if (event.type === 'token_usage') {
        // Held until the turn ends rather than emitted per update.
        latestTokenUsage = readObjectRecord(event.usage) ?? latestTokenUsage;
        continue;
      }
      // An assistant message or reasoning trace that already streamed its whole
      // content is closed by `stream_end` alone.
      if (isAlreadyStreamedFinalRow(event, mapper)) {
        continue;
      }
      for (const message of context.normalizeMessage(event, threadId || sessionId || null)) {
        if (message.kind === 'error') {
          errorSurfaced = true;
        }
        send(message);
      }
    }
  };

  try {
    connection = await startCodexAppServerConnection();

    const threadParams: AnyRecord = {
      cwd: workingDirectory,
      approvalPolicy,
      sandbox: sandboxMode,
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(configOverrides ? { config: configOverrides } : {}),
    };

    if (providerSessionId) {
      // `excludeTurns`: a resume response otherwise carries the thread's whole
      // history back, which would be re-rendered as if it had just happened.
      // Only the notification channel feeds the client; the response body is
      // read for the id and nothing else.
      const resumed = await connection.request('thread/resume', {
        threadId: providerSessionId,
        excludeTurns: true,
        ...threadParams,
      });
      threadId = readNestedId(resumed, 'thread') ?? providerSessionId;
    } else {
      const started = await connection.request('thread/start', threadParams);
      threadId = readNestedId(started, 'thread');
    }

    if (threadId && typeof ws.setSessionId === 'function') {
      ws.setSessionId(threadId);
    }

    const key = sessionKey();
    if (key) {
      activeCodexSessions.set(key, {
        connection,
        status: 'running',
        startedAt: new Date().toISOString(),
        threadId,
        turnId: null,
        finish: () => releaseRun(),
      });
    }

    if (!providerSessionId && threadId && !sessionCreatedSent) {
      sessionCreatedSent = true;
      send(createNormalizedMessage({ kind: 'session_created', newSessionId: threadId, sessionId: threadId, provider: 'codex' }));
    }

    // No reverse-request handler is registered: the connection refuses one
    // explicitly (`-32601`). Nothing here implements approval or attestation,
    // and leaving a request unanswered would hang the turn rather than degrade.
    connection.onNotification(handleNotification);
    connection.onExit((reason) => {
      exitReason = reason;
      releaseRun();
    });

    // Turns with image attachments send structured input items so Codex reads
    // the images from their local asset paths.
    const promptWithFiles = appendFilesInputTag(command, files);
    const normalizedImages = normalizeImageDescriptors(images);
    const promptWithImageFallback = !promptWithFiles.trim() && normalizedImages.length > 0
      ? CODEX_IMAGE_ONLY_PROMPT
      : promptWithFiles;
    const input = toAppServerInput(promptWithImageFallback, normalizedImages, workingDirectory);

    const startedTurn = await connection.request('turn/start', {
      threadId,
      input,
      ...(resolvedEffort ? { effort: resolvedEffort } : {}),
    });
    turnId = readNestedId(startedTurn, 'turn');
    const registered = currentSession();
    if (registered) {
      registered.turnId = turnId;
    }

    await runSettled;

    const aborted = currentSession()?.status === 'aborted';
    if (!aborted) {
      const outcomeSessionId = threadId || sessionId || null;
      const userId = ws?.userId || null;

      if (turnFailed) {
        if (!errorSurfaced) {
          send(createNormalizedMessage({
            kind: 'error',
            content: failureText(),
            sessionId: outcomeSessionId,
            provider: 'codex'
          }));
          errorSurfaced = true;
        }
        publishComplete(1);
        notifyRunFailed({
          userId,
          provider: 'codex',
          sessionId: outcomeSessionId,
          sessionName: sessionSummary,
          error: new Error(failureText())
        });
      } else if (!turnEnded) {
        // The child died before the turn reached a terminal status: an
        // interrupted turn, reported like any other failure.
        if (!errorSurfaced) {
          send(createNormalizedMessage({
            kind: 'error',
            content: exitReason || 'Codex app-server exited before the turn finished.',
            sessionId: outcomeSessionId,
            provider: 'codex'
          }));
          errorSurfaced = true;
        }
        publishComplete(1);
        notifyRunFailed({
          userId,
          provider: 'codex',
          sessionId: outcomeSessionId,
          sessionName: sessionSummary,
          error: new Error(exitReason || 'Codex app-server exited before the turn finished.')
        });
      } else {
        // Report the turn's usage once, now that it has ended.
        const tokenBudget = extractCodexTokenBudget(latestTokenUsage);
        if (tokenBudget) {
          send(createNormalizedMessage({
            kind: 'status',
            text: 'token_budget',
            tokenBudget,
            sessionId: outcomeSessionId,
            provider: 'codex'
          }));
        }
        publishComplete(0);
        notifyRunStopped({
          userId,
          provider: 'codex',
          sessionId: outcomeSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed'
        });
      }
    }

  } catch (error) {
    const session = currentSession();
    const runError = error instanceof Error ? error : new Error(String(error));
    const wasAborted =
      session?.status === 'aborted' ||
      runError.name === 'AbortError' ||
      runError.message.toLowerCase().includes('aborted');

    if (!wasAborted) {
      console.error('[Codex] Error:', error);

      if (!errorSurfaced) {
        // Check if Codex CLI is available for a clearer error message
        const installed = await context.isProviderInstalled();
        const errorContent = !installed
          ? 'Codex CLI is not configured. Please set up authentication first.'
          : runError.message;

        send(createNormalizedMessage({ kind: 'error', content: errorContent, sessionId: threadId || sessionId || null, provider: 'codex' }));
        errorSurfaced = true;
      }
      publishComplete(1);
      if (!terminalMessage) {
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: threadId || sessionId || null,
          sessionName: sessionSummary,
          error
        });
      }
    }

  } finally {
    deltaBatcher.dispose();
    if (connection) {
      await connection.stop();
    }
    // Update session status
    const session = currentSession();
    if (session) {
      session.status = session.status === 'aborted' ? 'aborted' : 'completed';
    }
  }
}

/**
 * Abort an active Codex session.
 *
 * `turn/interrupt` is given a short timeout instead of the shared 30s one: a
 * turn stuck in a tool call will not answer, and abort must not look like a
 * hang while it waits. The child is stopped either way, which is what actually
 * ends the run.
 *
 * @param {string} sessionId - Session ID to abort
 * @returns {Promise<boolean>} - Whether abort was successful
 */
async function abortCodexSession(sessionId: string): Promise<boolean> {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    if (session.threadId && session.turnId) {
      await session.connection
        .request('turn/interrupt', { threadId: session.threadId, turnId: session.turnId }, TURN_INTERRUPT_TIMEOUT_MS)
        .catch(() => undefined);
    }
  } catch (error) {
    console.warn(`[Codex] Failed to interrupt session ${sessionId}:`, error);
  }

  try {
    await session.connection.stop();
  } catch (error) {
    console.warn(`[Codex] Failed to stop session ${sessionId}:`, error);
  }
  // The child is gone, so the run loop's terminal notification will never
  // arrive; release it and let the abort handler own the terminal `complete`.
  session.finish();

  return true;
}

/** Used by the providers module's CodexProvider to run and abort app-server turns. */
export const codexRuntime = {
  run: queryCodex,
  abort: abortCodexSession,
};

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws: ProviderRuntimeWriter, data: unknown) {
  try {
    if (ws.isWebSocketWriter) {
      // The gateway writer handles stringification
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
const completedSessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Runtime cleanup should not keep focused tests or one-off scripts alive after
// their provider work has completed.
completedSessionCleanupTimer.unref?.();
