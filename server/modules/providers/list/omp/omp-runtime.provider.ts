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
  omitStreamedAssistantBlocks,
} from '@/shared/utils.js';

import { getOmpCommand } from './omp-auth.provider.js';
import { redactOmpDiagnosticText } from './omp-sessions.provider.js';

const activeProcesses = new Map<string, ChildProcess>();
const abortedSessionIds = new Set<string>();
const DEFAULT_OMP_RUN_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * OMP's read-only tool allowlist. Unlike Pi, OMP rejects an unknown tool name
 * in `--tools` with a usage error and a non-zero exit, so these must be names
 * OMP actually ships. It has no `find`/`ls` tool: `glob` is its file finder.
 */
const READ_ONLY_TOOLS = 'read,grep,glob';

function resolveOmpRunTimeoutMs(): number {
  const configured = Number(process.env.OMP_RUN_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_OMP_RUN_TIMEOUT_MS;
}

/**
 * Provider registry runtime adapter driving the OMP CLI in one-shot JSON mode
 * (`omp --mode json -p`). Each `chat.send` spawns one process whose stdout is a
 * newline-delimited JSON event stream ending with `agent_end`.
 *
 * Session identity: a brand-new run's first stdout line is the session header,
 * whose UUID is announced as `session_created`; resuming passes `--session
 * <uuid>` and appends to the same transcript (the CLI re-emits the same header).
 * Abort uses SIGTERM (print mode has no stdin control protocol) with a SIGKILL
 * backstop.
 *
 * Errors: OMP exits 0 even when a turn ends with `stopReason: "error"`, so the
 * terminal failure is derived from the message payload; startup/argument errors
 * exit non-zero with no terminal event. `--auto-approve` is always passed so a
 * headless run never blocks on an approval prompt.
 */
export const ompRuntime: IProviderRuntime = {
  async run(command, options, writer, context): Promise<unknown> {
    const appSessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
    if (!appSessionId) {
      writer.send(createCompleteMessage({ provider: 'omp', sessionId: null, exitCode: 1 }));
      return;
    }

    let resolvedModel: string | undefined;
    let workingDir: string;
    let providerSessionId: string | null;
    try {
      resolvedModel = await context.resolveResumeModel(appSessionId, options.model);
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
        provider: 'omp',
        sessionId: appSessionId,
        content: message,
      }));
      writer.send(createCompleteMessage({ provider: 'omp', sessionId: appSessionId, exitCode: 1 }));
      return;
    }

    return new Promise<void>((resolveRun) => {
      if (activeProcesses.has(appSessionId)) {
        writer.send(createNormalizedMessage({
          kind: 'error',
          provider: 'omp',
          sessionId: appSessionId,
          content: 'This OMP session already has a running task.',
        }));
        writer.send(createCompleteMessage({ provider: 'omp', sessionId: appSessionId, exitCode: 1 }));
        resolveRun();
        return;
      }
      // A stale flag from a superseded run must not mark this run aborted.
      abortedSessionIds.delete(appSessionId);

      const args: string[] = ['--mode', 'json', '-p'];
      if (providerSessionId) {
        args.push('--session', providerSessionId);
      }
      if (resolvedModel) {
        args.push('--model', resolvedModel);
      }
      if (typeof options.effort === 'string' && options.effort !== 'default') {
        args.push('--thinking', options.effort);
      }
      // OMP's only safety lever for headless runs is the built-in tool
      // allowlist: the read-only mode pins it to the read-only tools. Any other
      // mode (default, and the agent runner's bypassPermissions) means OMP runs
      // tools autonomously.
      if (options.permissionMode === 'readonly') {
        args.push('--tools', READ_ONLY_TOOLS);
      }
      // Never block on an approval prompt: headless print mode has no channel
      // to answer one.
      args.push('--auto-approve');

      // All trusted attachments (images and files) ride OMP's native `@file`
      // positional arguments, which OMP reads into context itself.
      for (const descriptor of normalizeAttachmentDescriptors(options.attachments)) {
        const resolvedPath = resolveImageAbsolutePath(workingDir, descriptor.path);
        if (!isAllowedImageSourcePath(resolvedPath, workingDir)) {
          continue;
        }
        args.push(`@${resolvedPath}`);
      }

      if (typeof command === 'string' && command.trim()) {
        args.push('--', command.trim());
      }

      const child = spawn(getOmpCommand(), args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
      activeProcesses.set(appSessionId, child);

      // OMP streams the assistant reply and its reasoning trace as token-level
      // `message_update` deltas. Coalesce them like the other CLI runtimes so a
      // long reasoning pass cannot overrun this run's replay buffer; `send` is
      // the only outbound path from here on.
      //
      // `streamHalted` becomes true once this run must publish nothing further:
      // its terminal `complete` went out through the batcher, or the user
      // aborted it (the abort handler emits that complete directly, bypassing
      // this batcher, so `haltStream` arms the flag). A delta surfacing after
      // that would resurrect the client's already-finalized placeholder row.
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

      // Which channels the current assistant message already streamed, so its
      // terminal `message_end` copy is omitted instead of rendered twice.
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
      let pendingFinish: { exitCode: number; aborted?: boolean; error?: string } | null = null;
      let timedOut = false;
      let terminationRequested = false;
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
        send(createCompleteMessage({
          provider: 'omp',
          sessionId: appSessionId,
          actualSessionId: capturedSessionId ?? undefined,
          exitCode: payload.exitCode,
          aborted: payload.aborted,
        }));
        if (payload.aborted) {
          notifyRunStopped({ userId, provider: 'omp', sessionId: appSessionId, sessionName, stopReason: 'aborted' });
        } else if (payload.exitCode === 0) {
          notifyRunStopped({ userId, provider: 'omp', sessionId: appSessionId, sessionName, stopReason: 'completed' });
        } else {
          notifyRunFailed({
            userId,
            provider: 'omp',
            sessionId: appSessionId,
            sessionName,
            error: payload.error ?? `OMP exited with code ${payload.exitCode}`,
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
          // The process may have exited between a terminal stream event and the signal.
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
          provider: 'omp',
          sessionId: appSessionId,
          content: error,
        }));
        terminateChild();
      };

      // The prompt travels as an argv message, so stdin can close immediately.
      child.stdin.on('error', (error) => {
        if (completeSent) {
          return;
        }
        console.error('[OMP] CLI stdin error', {
          sessionId: appSessionId,
          code: (error as NodeJS.ErrnoException).code,
        });
        if (abortedSessionIds.has(appSessionId)) {
          terminateChild();
          return;
        }
        failAndTerminate('OMP input channel closed unexpectedly.');
      });
      child.stdin.end();

      timeoutId = setTimeout(() => {
        if (completeSent || terminationRequested) {
          return;
        }
        timedOut = true;
        const timeoutMs = resolveOmpRunTimeoutMs();
        const error = `OMP run timed out after ${timeoutMs}ms`;
        console.error('[OMP] CLI run timed out', { sessionId: appSessionId, timeoutMs });
        failAndTerminate(error);
      }, resolveOmpRunTimeoutMs());
      timeoutId.unref();

      const announceSession = () => {
        if (providerSessionId || !capturedSessionId || sessionCreatedSent) {
          return;
        }
        sessionCreatedSent = true;
        send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: capturedSessionId,
          sessionId: appSessionId,
          provider: 'omp',
        }));
      };

      const processLine = (line: string) => {
        if (!line.trim()) {
          return;
        }
        let event: AnyRecord;
        try {
          event = JSON.parse(line) as AnyRecord;
        } catch {
          console.warn('[OMP] Ignoring invalid json-mode line', {
            sessionId: appSessionId,
            lineLength: line.length,
          });
          return;
        }

        // The first line is the session header; OMP writes it before any events
        // (and re-emits it, unchanged, when resuming a session).
        if (event.type === 'session') {
          if (typeof event.id === 'string' && event.id && !capturedSessionId) {
            capturedSessionId = event.id;
          }
          announceSession();
          return;
        }

        // A new message opens a fresh streaming window; clear the channels the
        // previous assistant message recorded so its `message_end` copy is not
        // falsely suppressed (or a fresh one missed).
        if (event.type === 'message_start') {
          streamedText = false;
          streamedThinking = false;
          return;
        }

        // Token-level deltas for the in-flight assistant message. Forwarding
        // each one lets the WebUI render the reasoning trace and the reply as
        // they arrive; tracking the channel marks the block as streamed so the
        // terminal `message_end` does not repeat it.
        if (event.type === 'message_update') {
          for (const normalized of context.normalizeMessage(event, appSessionId)) {
            if (normalized.kind === 'stream_delta') {
              if (normalized.streamChannel === 'thinking') {
                streamedThinking = true;
              } else {
                streamedText = true;
              }
            }
            send(normalized);
          }
          return;
        }

        if (event.type === 'message_end') {
          const message = event.message as AnyRecord | null;
          const role = message?.role;
          // OMP echoes the user prompt back as a message_end; skip it so the
          // frontend does not render a duplicate of the composer message.
          if (role === 'user') {
            return;
          }
          const isErrorTurn = role === 'assistant' && message?.stopReason === 'error';
          if (isErrorTurn) {
            const errorText = typeof message?.errorMessage === 'string' && message.errorMessage.trim()
              ? redactOmpDiagnosticText(message.errorMessage)
              : 'OMP run failed';
            pendingFinish = { exitCode: 1, error: errorText };
          } else if (role === 'assistant') {
            // A later successful assistant turn clears an earlier error
            // (OMP retries some failed turns).
            pendingFinish = { exitCode: 0 };
          }

          // Close the streamed rows before emitting anything else, then send
          // only the blocks that were not streamed (tool calls/results) so the
          // reply and reasoning are not rendered a second time.
          if (role === 'assistant' && (streamedText || streamedThinking)) {
            send(createNormalizedMessage({
              kind: 'stream_end',
              sessionId: appSessionId,
              provider: 'omp',
            }));
            const terminalEvent: AnyRecord = {
              ...event,
              message: {
                ...message,
                content: omitStreamedAssistantBlocks(message?.content, {
                  text: streamedText,
                  thinking: streamedThinking,
                }),
              },
            };
            for (const normalized of context.normalizeMessage(terminalEvent, appSessionId)) {
              send(normalized);
            }
            return;
          }

          for (const normalized of context.normalizeMessage(event, appSessionId)) {
            send(normalized);
          }
          return;
        }

        if (event.type === 'agent_end') {
          // The run has produced its last event; only a terminal error keeps
          // the failure outcome. agent_end must not overwrite it.
          if (!pendingFinish) {
            pendingFinish = { exitCode: 0 };
          }
          return;
        }

        // These events carry no renderable text of their own. `advisor_cost_changed`
        // fires on every run and is ignored explicitly so it neither warns on
        // every turn nor needs a payload contract of its own.
        if (
          event.type === 'advisor_cost_changed'
          || event.type === 'tool_execution_start'
          || event.type === 'tool_execution_update'
          || event.type === 'tool_execution_end'
          || event.type === 'turn_start'
          || event.type === 'turn_end'
          || event.type === 'agent_start'
        ) {
          return;
        }

        console.warn('[OMP] Ignoring unsupported json event', {
          sessionId: appSessionId,
          eventType: typeof event.type === 'string' ? event.type : 'missing',
        });
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        let newlineIndex = stdoutBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          newlineIndex = stdoutBuffer.indexOf('\n');
          processLine(line);
        }
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        if (text) {
          stderrBuffer += text;
          console.error('[OMP] CLI stderr', {
            sessionId: appSessionId,
            message: redactOmpDiagnosticText(text.trim()),
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
        // OMP may emit its final JSON event without a trailing newline, leaving
        // it stranded in the split buffer. Flush it before judging the run.
        if (stdoutBuffer.trim()) {
          const remainingLine = stdoutBuffer.trim();
          stdoutBuffer = '';
          processLine(remainingLine);
        }
        if (!completeSent) {
          if (!wasAborted && code !== 0 && !pendingFinish) {
            // Startup/argument errors produce no terminal event; surface
            // stderr as an error row so the failure is visible in the chat.
            const stderrText = stderrBuffer.trim();
            const errorText = stderrText
              ? redactOmpDiagnosticText(stderrText)
              : `OMP exited with code ${code ?? 'unknown'}`;
            console.error('[OMP] CLI exited before a terminal event', {
              sessionId: appSessionId,
              exitCode: code ?? 'unknown',
            });
            send(createNormalizedMessage({
              kind: 'error',
              provider: 'omp',
              sessionId: appSessionId,
              content: errorText,
            }));
            finish({ exitCode: 1, error: errorText });
          } else {
            finish(wasAborted
              ? { exitCode: 0, aborted: true }
              : timedOut
                ? pendingFinish ?? { exitCode: 1, error: 'OMP run timed out' }
                : pendingFinish ?? { exitCode: code === 0 ? 0 : 1, error: code === 0 ? undefined : `OMP exited with code ${code ?? 'unknown'}` });
          }
        } else {
          resolveRun();
        }
      });
    });
  },

  async abort(sessionId: string): Promise<boolean> {
    const child = activeProcesses.get(sessionId);
    if (!child) {
      return false;
    }
    abortedSessionIds.add(sessionId);
    // The abort handler sends the terminal complete on this run's behalf
    // (bypassing the coalescer), so halt the stream first: a buffered delta
    // must not land after that complete and resurrect the client's row.
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
export function resetOmpRuntimeForTests(): void {
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
