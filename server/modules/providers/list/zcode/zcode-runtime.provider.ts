import { spawn, type ChildProcess } from 'node:child_process';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import {
  isAllowedImageSourcePath,
  normalizeAttachmentDescriptors,
  resolveImageAbsolutePath,
} from '@/shared/image-attachments.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { AnyRecord, NormalizedMessage } from '@/shared/types.js';
import {
  createCompleteMessage,
  createDeltaBatcher,
  createNormalizedMessage,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

import { resolveZcodeCommand } from './zcode-auth.provider.js';
import { resolveZcodeModelEnv } from './zcode-models.provider.js';
import { findZcodeSessionForRun } from './zcode-sessions.provider.js';

/**
 * Maps CloudCLI permission modes onto ZCode's `--mode` values.
 *
 * Verified against 0.16.5. `edit` auto-approves file edits and non-destructive
 * commands while denying side-effecting writes and high-risk commands; `build`
 * denies both; `plan` only plans; `yolo` auto-approves everything.
 */
const PERMISSION_MODE_MAP: Record<string, string> = {
  default: 'build',
  acceptEdits: 'edit',
  bypassPermissions: 'yolo',
  plan: 'plan',
};

/**
 * Tools whose denial is inherent to headless operation rather than a blocked
 * task. `ExitPlanMode` (and similar interactive tools) require a UI client, so
 * headless always denies them even on a successful plan-mode run; counting them
 * would raise a false alarm on every plan turn.
 */
const ZCODE_INTERACTION_TOOLS = new Set(['ExitPlanMode']);

/** Stable marker attached to the terminal `complete` when the breaker trips. */
const ZCODE_PERMISSION_CIRCUIT_OPEN = 'ZCODE_PERMISSION_CIRCUIT_OPEN';

const DEFAULT_ZCODE_RUN_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_ZCODE_MAX_DENIALS = 3;

/**
 * Prompt length ceiling, well under the macOS limits (~256KB per argument,
 * ~1MB total ARG_MAX) so several `--attach` paths still fit. `--prompt` has no
 * stdin channel in 0.16.5, so an over-long prompt must fail loudly.
 */
const ZCODE_MAX_PROMPT_BYTES = 128 * 1024;

const activeProcesses = new Map<string, ChildProcess>();
// Sessions whose abort() was requested but whose process has not reaped yet.
// The `close` handler consumes the flag so the terminal event reports the run
// as aborted instead of a failed exit code.
const abortedSessionIds = new Set<string>();

function resolveZcodeRunTimeoutMs(): number {
  const configured = Number(process.env.ZCODE_RUN_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_ZCODE_RUN_TIMEOUT_MS;
}

function resolveZcodeMaxDenials(): number {
  const configured = Number(process.env.ZCODE_MAX_DENIALS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_ZCODE_MAX_DENIALS;
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*Bearer\s+)[^\s,;}]+/gi, '$1[REDACTED]')
    .replace(
      /((?:authorization|cookie|x-api-key|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|password)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      '$1[REDACTED]',
    )
    .slice(0, 2000);
}

/** Reads the provider-native session id from an event's envelope or payload. */
function readEventSessionId(event: AnyRecord): string | null {
  const envelope = readOptionalString(event.sessionId);
  if (envelope?.startsWith('sess_')) {
    return envelope;
  }
  const payloadSessionId = readOptionalString(readObjectRecord(event.payload)?.sessionId);
  return payloadSessionId?.startsWith('sess_') ? payloadSessionId : null;
}

/**
 * True when an event names the model the CLI actually loaded.
 *
 * Used to confirm the per-run model override took effect.
 */
function reportsLoadedModel(event: AnyRecord): boolean {
  const payload = readObjectRecord(event.payload);
  if (!payload) {
    return false;
  }
  if (readOptionalString(payload.model)) {
    return true;
  }
  const model = readObjectRecord(payload.model);
  return Boolean(readOptionalString(model?.providerId) && readOptionalString(model?.modelId));
}

function denialGuidance(toolName: string): string {
  return [
    `ZCode cannot prompt for approval in headless mode, so ${toolName} was denied and this task may not complete.`,
    'For file-editing work, switch to acceptEdits (edit) mode.',
    'Only choose bypassPermissions (yolo) — which auto-approves every tool, including arbitrary command execution — if you trust this task.',
  ].join(' ');
}

/**
 * Provider registry runtime adapter driving the ZCode CLI in one-shot prompt
 * mode (`zcode --prompt <text> --output-format stream-json`).
 *
 * Each run spawns one process whose stdout is a newline-delimited JSON event
 * stream. Session identity is scanned from the event envelope (present from the
 * first event), with a concurrency-safe sqlite read-back as a fallback. Abort
 * uses SIGTERM (there is no stdin control protocol) with a SIGKILL backstop.
 *
 * Because headless ZCode has no approval channel, a non-`yolo` run can be
 * denied tool access; the runtime counts denials (excluding interactive tools),
 * surfaces one guidance message, and trips a circuit breaker
 * (`ZCODE_PERMISSION_CIRCUIT_OPEN`) after {@link resolveZcodeMaxDenials} so a
 * retry loop fails fast instead of running until the timeout.
 */
export const zcodeRuntime: IProviderRuntime = {
  async run(command, options, writer, context): Promise<unknown> {
    const appSessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
    if (!appSessionId) {
      writer.send(createCompleteMessage({ provider: 'zcode', sessionId: null, exitCode: 1 }));
      return;
    }

    let workingDir: string;
    let providerSessionId: string | null;
    try {
      workingDir = typeof options.cwd === 'string' && options.cwd
        ? options.cwd
        : typeof options.projectPath === 'string' && options.projectPath
          ? options.projectPath
          : process.cwd();
      providerSessionId = context.resolveProviderSessionId(appSessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writer.send(createNormalizedMessage({
        kind: 'error',
        provider: 'zcode',
        sessionId: appSessionId,
        content: message,
      }));
      writer.send(createCompleteMessage({ provider: 'zcode', sessionId: appSessionId, exitCode: 1 }));
      return;
    }

    const prompt = typeof command === 'string' ? command : '';
    if (Buffer.byteLength(prompt, 'utf8') > ZCODE_MAX_PROMPT_BYTES) {
      const message = `ZCode prompt is too long (limit ${ZCODE_MAX_PROMPT_BYTES} bytes); attach files instead.`;
      writer.send(createNormalizedMessage({
        kind: 'error',
        provider: 'zcode',
        sessionId: appSessionId,
        content: message,
      }));
      writer.send(createCompleteMessage({ provider: 'zcode', sessionId: appSessionId, exitCode: 1 }));
      return;
    }

    const resolution = resolveZcodeCommand();
    if (!resolution.command) {
      const message = 'ZCode CLI not found (set ZCODE_COMMAND or install ZCode).';
      writer.send(createNormalizedMessage({
        kind: 'error',
        provider: 'zcode',
        sessionId: appSessionId,
        content: message,
      }));
      writer.send(createCompleteMessage({ provider: 'zcode', sessionId: appSessionId, exitCode: 1 }));
      return;
    }

    const mode = PERMISSION_MODE_MAP[typeof options.permissionMode === 'string' ? options.permissionMode : '']
      ?? PERMISSION_MODE_MAP.acceptEdits;
    const args: string[] = [
      ...resolution.baseArgs,
      '--prompt',
      prompt,
      '--output-format',
      'stream-json',
      '--no-color',
      '--cwd',
      workingDir,
      '--mode',
      mode,
    ];
    if (providerSessionId) {
      args.push('--resume', providerSessionId);
    }
    // Attachments (images and ordinary files) all ride `--attach`; the path
    // checks mirror the Codex/Pi runtimes so a session cannot read outside its
    // working directory.
    for (const descriptor of normalizeAttachmentDescriptors(options.attachments)) {
      const resolvedPath = resolveImageAbsolutePath(workingDir, descriptor.path);
      if (!isAllowedImageSourcePath(resolvedPath, workingDir)) {
        continue;
      }
      args.push('--attach', resolvedPath);
    }

    // Headless ZCode has no model flag, so a chosen model is applied through
    // the per-process `ZCODE_MODEL`/`ZCODE_BASE_URL`/`ZCODE_API_KEY` channel.
    // Nothing in the user's config is read for the model or written back.
    const requestedModel = readOptionalString(options.model);
    let modelEnv: Record<string, string> | null = null;
    if (requestedModel) {
      try {
        modelEnv = resolveZcodeModelEnv(requestedModel);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writer.send(createNormalizedMessage({
          kind: 'error',
          provider: 'zcode',
          sessionId: appSessionId,
          content: message,
        }));
        writer.send(createCompleteMessage({ provider: 'zcode', sessionId: appSessionId, exitCode: 1 }));
        return;
      }
    }

    return new Promise<void>((resolveRun) => {
      if (activeProcesses.has(appSessionId)) {
        writer.send(createNormalizedMessage({
          kind: 'error',
          provider: 'zcode',
          sessionId: appSessionId,
          content: 'This ZCode session already has a running task.',
        }));
        writer.send(createCompleteMessage({ provider: 'zcode', sessionId: appSessionId, exitCode: 1 }));
        resolveRun();
        return;
      }
      // A stale flag from a superseded run must not mark this run aborted.
      abortedSessionIds.delete(appSessionId);

      const spawnStart = new Date();
      const child = spawn(resolution.command as string, args, {
        cwd: workingDir,
        // `--prompt` never reads stdin; leaving it open can only make the CLI
        // wait for input it will not consume.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: modelEnv ? { ...process.env, ...modelEnv } : { ...process.env },
      });
      activeProcesses.set(appSessionId, child);

      // Deltas arrive one token at a time (hundreds per reasoning pass), so
      // they are coalesced like the other CLI runtimes. `streamHalted` becomes
      // true once this run must publish nothing further, so a late delta cannot
      // resurrect a row the client already finalized.
      let streamHalted = false;
      const deltaBatcher = createDeltaBatcher((message) => {
        if (message.kind === 'complete') {
          streamHalted = true;
        }
        if (message.kind === 'stream_delta' && streamHalted) {
          return;
        }
        writer.send(message);
      });
      const send = (message: NormalizedMessage) => deltaBatcher.send(message);

      // Tool-call closure is idempotent: `permission.resolved` and
      // `tool.updated/batch` both close a denied call, and `tool.updated/result`
      // may be followed by a success batch. The first closure wins.
      const closedToolCallIds = new Set<string>();
      let streamedText = false;
      let streamedThinking = false;

      type HaltableChild = ChildProcess & { haltStream?: () => void };
      (child as HaltableChild).haltStream = () => {
        streamHalted = true;
        deltaBatcher.dispose();
      };

      const sessionName = typeof options.sessionSummary === 'string'
        ? options.sessionSummary
        : undefined;
      const userId = writer.userId ?? null;

      let stdoutBuffer = '';
      let stderrBuffer = '';
      let capturedSessionId: string | null = null;
      let sessionCreatedSent = false;
      let completeSent = false;
      let modelMismatchLogged = false;
      let pendingFinish: { exitCode: number; aborted?: boolean; error?: string } | null = null;
      let timedOut = false;
      let terminationRequested = false;
      let terminalErrorCode: string | null = null;
      let deniedCount = 0;
      let guidanceSent = false;
      let timeoutId: NodeJS.Timeout | undefined;
      let forceKillTimer: NodeJS.Timeout | undefined;

      const finish = (payload: { exitCode: number; aborted?: boolean; error?: string }) => {
        if (completeSent) {
          return;
        }
        completeSent = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        resolveRun();
        const complete = createCompleteMessage({
          provider: 'zcode',
          sessionId: appSessionId,
          actualSessionId: capturedSessionId ?? undefined,
          exitCode: payload.exitCode,
          aborted: payload.aborted,
        });
        send(terminalErrorCode ? { ...complete, errorCode: terminalErrorCode } : complete);
        if (payload.aborted) {
          notifyRunStopped({ userId, provider: 'zcode', sessionId: appSessionId, sessionName, stopReason: 'aborted' });
        } else if (payload.exitCode === 0) {
          notifyRunStopped({ userId, provider: 'zcode', sessionId: appSessionId, sessionName, stopReason: 'completed' });
        } else {
          notifyRunFailed({
            userId,
            provider: 'zcode',
            sessionId: appSessionId,
            sessionName,
            error: payload.error ?? `ZCode exited with code ${payload.exitCode}`,
          });
        }
      };

      const terminateChild = () => {
        if (terminationRequested) {
          return;
        }
        terminationRequested = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // The process may have exited between a terminal event and the signal.
        }
        forceKillTimer = setTimeout(() => {
          if (!completeSent) {
            try {
              child.kill('SIGKILL');
            } catch {
              // Already gone.
            }
          }
        }, 3000);
        forceKillTimer.unref();
      };

      const failAndTerminate = (error: string) => {
        if (completeSent || terminationRequested) {
          return;
        }
        pendingFinish = { exitCode: 1, error };
        send(createNormalizedMessage({
          kind: 'error',
          provider: 'zcode',
          sessionId: appSessionId,
          content: error,
        }));
        terminateChild();
      };

      const announceSession = () => {
        if (providerSessionId || !capturedSessionId || sessionCreatedSent) {
          return;
        }
        sessionCreatedSent = true;
        send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: capturedSessionId,
          sessionId: appSessionId,
          provider: 'zcode',
        }));
      };

      /** Resolves the provider session id from sqlite when events never carried one. */
      const resolveSessionIdFallback = () => {
        if (capturedSessionId || providerSessionId) {
          return;
        }
        const found = findZcodeSessionForRun(workingDir, spawnStart);
        if (found) {
          capturedSessionId = found;
          announceSession();
        }
      };

      /** Maps one raw event and forwards the messages, deduping tool closures. */
      const emitNormalized = (event: AnyRecord) => {
        for (const message of context.normalizeMessage(event, appSessionId)) {
          if (message.kind === 'stream_delta') {
            if (message.streamChannel === 'thinking') {
              streamedThinking = true;
            } else {
              streamedText = true;
            }
            send(message);
            continue;
          }

          if (message.kind === 'tool_result' && message.toolId) {
            if (closedToolCallIds.has(message.toolId)) {
              continue;
            }
            closedToolCallIds.add(message.toolId);
          }

          send(message);
        }
      };

      const processLine = (line: string) => {
        if (!line.trim()) {
          return;
        }
        // Once a fatal outcome is recorded (circuit breaker, timeout, a fatal
        // error event), later buffered events must not overwrite it — notably
        // the success `turn.completed`/`result` that may already be in flight.
        if (pendingFinish?.exitCode === 1) {
          return;
        }
        let event: AnyRecord;
        try {
          event = JSON.parse(line) as AnyRecord;
        } catch {
          console.warn('[ZCode] Ignoring invalid stream-json line', {
            sessionId: appSessionId,
            lineLength: line.length,
          });
          return;
        }

        if (!readObjectRecord(event)) {
          return;
        }

        const eventSessionId = readEventSessionId(event);
        if (eventSessionId && !capturedSessionId) {
          capturedSessionId = eventSessionId;
          announceSession();
        }

        // A run whose requested model did not take effect would silently answer
        // on the config's default, so surface the mismatch in the logs.
        if (modelEnv && !modelMismatchLogged && reportsLoadedModel(event)) {
          modelMismatchLogged = true;
          const reported = readOptionalString(readObjectRecord(event.payload)?.model);
          if (reported && reported !== requestedModel) {
            console.warn('[ZCode] CLI reported a different model than requested', {
              sessionId: appSessionId,
              requested: requestedModel,
              reported,
            });
          }
        }

        const type = readOptionalString(event.type);

        // Fatal engine errors (e.g. `--resume` at an unknown session) surface
        // on stderr with no stdout, but a defensive `error` event is handled
        // here too.
        if (type === 'error') {
          const text = readOptionalString(event.error)
            ?? readOptionalString(event.message)
            ?? 'ZCode run failed';
          failAndTerminate(redactDiagnosticText(text));
          return;
        }

        // Count denials from non-interactive tools and trip the breaker. The
        // resolved event is also what closes the denied tool card.
        if (type === 'permission.resolved') {
          const payload = readObjectRecord(event.payload) ?? {};
          const toolName = readOptionalString(payload.toolName) ?? '';
          if (readOptionalString(payload.decision) === 'deny' && !ZCODE_INTERACTION_TOOLS.has(toolName)) {
            deniedCount += 1;
            if (!guidanceSent) {
              guidanceSent = true;
              send(createNormalizedMessage({
                kind: 'error',
                provider: 'zcode',
                sessionId: appSessionId,
                content: denialGuidance(toolName || 'a tool'),
              }));
            }
            if (deniedCount >= resolveZcodeMaxDenials()) {
              terminalErrorCode = ZCODE_PERMISSION_CIRCUIT_OPEN;
              resolveSessionIdFallback();
              failAndTerminate(
                `ZCode stopped after ${deniedCount} denied tool calls (${ZCODE_PERMISSION_CIRCUIT_OPEN}).`,
              );
              return;
            }
          }
        }

        if (type === 'turn.completed') {
          const payload = readObjectRecord(event.payload) ?? {};
          const response = readOptionalString(payload.response);
          // When nothing streamed (e.g. the turn ended on a tool call), the
          // authoritative reply only exists on the terminal event.
          if (response && !streamedText && !streamedThinking) {
            streamedText = true;
            send(createNormalizedMessage({
              kind: 'text',
              role: 'assistant',
              provider: 'zcode',
              sessionId: appSessionId,
              content: response,
            }));
          }
          const resultType = readOptionalString(payload.resultType);
          pendingFinish = resultType && resultType !== 'success'
            ? { exitCode: 1, error: redactDiagnosticText(response || 'ZCode turn failed') }
            : { exitCode: 0 };
          emitNormalized(event);
          return;
        }

        // The terminal `result` is a top-level event (no `payload`): it carries
        // the response, usage and projected context window.
        if (type === 'result') {
          if (timedOut) {
            return;
          }
          resolveSessionIdFallback();
          if (!pendingFinish) {
            pendingFinish = { exitCode: 0 };
          }
          return;
        }

        emitNormalized(event);
      };

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        let newlineIndex = stdoutBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          newlineIndex = stdoutBuffer.indexOf('\n');
          processLine(line);
        }
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString().trim();
        if (text) {
          stderrBuffer = `${stderrBuffer}${text}\n`.slice(-2000);
          console.error('[ZCode] CLI stderr', {
            sessionId: appSessionId,
            message: redactDiagnosticText(text),
          });
        }
      });
      child.on('error', (error) => {
        if (activeProcesses.get(appSessionId) === child) {
          activeProcesses.delete(appSessionId);
        }
        finish({ exitCode: 1, error: error.message });
      });
      child.on('close', (code) => {
        if (activeProcesses.get(appSessionId) === child) {
          activeProcesses.delete(appSessionId);
        }
        const wasAborted = abortedSessionIds.delete(appSessionId);
        // The terminal `result` may arrive without a trailing newline, leaving
        // it stranded in the split buffer; flush it so the session id is not
        // lost and a clean completion is not misread as a failure.
        if (stdoutBuffer.trim()) {
          const remainingLine = stdoutBuffer.trim();
          stdoutBuffer = '';
          processLine(remainingLine);
        }
        if (!completeSent) {
          if (wasAborted) {
            finish({ exitCode: 0, aborted: true });
            return;
          }
          if (timedOut) {
            finish(pendingFinish ?? { exitCode: 1, error: 'ZCode run timed out' });
            return;
          }
          if (pendingFinish) {
            finish(pendingFinish);
            return;
          }
          if (code !== 0) {
            const detail = stderrBuffer.trim() ? `: ${redactDiagnosticText(stderrBuffer.trim())}` : '';
            const error = `ZCode exited with code ${code ?? 'unknown'}${detail}`;
            // A failed `--resume` (unknown session) or a bad flag writes only to
            // stderr and exits non-zero with no stream events, so the message
            // must be surfaced here or the failure is invisible.
            send(createNormalizedMessage({
              kind: 'error',
              provider: 'zcode',
              sessionId: appSessionId,
              content: error,
            }));
            finish({ exitCode: 1, error });
            return;
          }
          finish({ exitCode: 0 });
        } else {
          resolveRun();
        }
      });

      timeoutId = setTimeout(() => {
        if (completeSent || terminationRequested) {
          return;
        }
        timedOut = true;
        const timeoutMs = resolveZcodeRunTimeoutMs();
        console.error('[ZCode] CLI run timed out', { sessionId: appSessionId, timeoutMs });
        failAndTerminate(`ZCode run timed out after ${timeoutMs}ms`);
      }, resolveZcodeRunTimeoutMs());
      timeoutId.unref();
    });
  },

  async abort(sessionId: string): Promise<boolean> {
    const child = activeProcesses.get(sessionId);
    if (!child) {
      return false;
    }
    abortedSessionIds.add(sessionId);
    // The abort handler sends the terminal complete on this run's behalf
    // (bypassing the coalescer), so halt the stream first.
    (child as ChildProcess & { haltStream?: () => void }).haltStream?.();
    try {
      child.kill('SIGTERM');
    } catch {
      abortedSessionIds.delete(sessionId);
      return false;
    }
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }, 3000).unref();
    return true;
  },
};

/** Drops process tracking (used by tests). */
export function resetZcodeRuntimeForTests(): void {
  for (const child of activeProcesses.values()) {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
  activeProcesses.clear();
  abortedSessionIds.clear();
}
