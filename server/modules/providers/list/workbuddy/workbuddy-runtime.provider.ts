import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { buildWorkbuddyStreamJsonInput } from '@/shared/image-attachments.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

import { getWorkbuddyCommand } from './workbuddy-auth.provider.js';

/**
 * Maps the app permission mode onto CodeBuddy's `--permission-mode` choices.
 * The engines share the same vocabulary, so modes pass through 1:1.
 */
const PERMISSION_MODE_MAP: Record<string, string | undefined> = {
  default: 'default',
  acceptEdits: 'acceptEdits',
  bypassPermissions: 'bypassPermissions',
  plan: 'plan',
  auto: 'auto',
  dontAsk: 'dontAsk',
};

const activeProcesses = new Map<string, ChildProcess>();
// Sessions whose abort() was requested but whose process has not reaped yet.
// The `close` handler consumes the flag so the terminal event reports the run
// as aborted instead of a failed exit code.
const abortedSessionIds = new Set<string>();

/**
 * Provider registry runtime adapter driving the WorkBuddy CLI in print mode
 * (`codebuddy -p --output-format stream-json`). Each run spawns one process;
 * stdout carries newline-delimited JSON events.
 */
export const workbuddyRuntime: IProviderRuntime = {
  async run(command, options, writer, context): Promise<unknown> {
    const appSessionId = typeof options.sessionId === 'string' ? options.sessionId : '';
    if (!appSessionId) {
      writer.send(createCompleteMessage({ provider: 'workbuddy', sessionId: null, exitCode: 1 }));
      return;
    }
    // Prefer the model recorded on the session row when resuming; fall back to
    // the model selected in the composer for new sessions.
    const resolvedModel = await context.resolveResumeModel(appSessionId, options.model);

    const workingDir = typeof options.cwd === 'string' && options.cwd
      ? options.cwd
      : typeof options.projectPath === 'string' && options.projectPath
        ? options.projectPath
        : process.cwd();

    const providerSessionId = context.resolveProviderSessionId(appSessionId);

    // Attachments travel as a stream-json user message on stdin — the only
    // input path that can carry image/document content blocks to the engine.
    // Without attachments the proven plain-text `-p` prompt is kept unchanged.
    const hasAttachments = Array.isArray(options.attachments) && options.attachments.length > 0;
    const streamInput = hasAttachments
      ? await buildWorkbuddyStreamJsonInput(command, options.attachments, workingDir)
      : null;

    return new Promise<void>((resolveRun) => {
    // A stale flag from a superseded run must not mark this run aborted.
    abortedSessionIds.delete(appSessionId);

    const args: string[] = ['-p'];
    if (streamInput !== null) {
      // Stream-json input carries the prompt and attachments on stdin; there
      // is no positional prompt argument.
      args.push('--output-format', 'stream-json', '--input-format', 'stream-json');
    } else {
      args.push(command, '--output-format', 'stream-json');
    }
    if (providerSessionId) {
      args.push('--resume', providerSessionId);
    }
    const permissionMode = typeof options.permissionMode === 'string'
      ? PERMISSION_MODE_MAP[options.permissionMode]
      : undefined;
    if (permissionMode) {
      args.push('--permission-mode', permissionMode);
    }
    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }

    // The embedded engine defaults its config root to ~/.codebuddy, but the
    // WorkBuddy desktop app runs it against ~/.workbuddy — where the user's
    // skills, plugins, and sessions live. Resumed sessions use the config dir
    // recorded on the session row (so --resume finds the same transcript);
    // brand-new sessions fall back to ~/.workbuddy so the engine reads the
    // same skills/plugins as the desktop app.
    const configDir = context.resolveProviderConfigDir(appSessionId)
      ?? path.join(os.homedir(), '.workbuddy');
    const env: NodeJS.ProcessEnv = { ...process.env };
    env.CODEBUDDY_CONFIG_DIR = configDir;
    env.WORKBUDDY_CONFIG_DIR = configDir;

    const child = spawn(getWorkbuddyCommand(), args, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    // Print mode is non-interactive: write the stream-json user message (when
    // present) then close stdin so the engine does not wait for input before
    // executing the prompt.
    if (streamInput !== null) {
      child.stdin.write(streamInput + '\n');
    }
    child.stdin.end();
    activeProcesses.set(appSessionId, child);

    const sessionName = typeof options.sessionSummary === 'string'
      ? options.sessionSummary
      : undefined;
    const userId = writer.userId ?? null;

    let stdoutBuffer = '';
    let capturedSessionId: string | null = null;
    let sessionCreatedSent = false;
    let completeSent = false;

    const finish = (payload: { exitCode: number; aborted?: boolean; error?: string }) => {
      if (completeSent) {
        return;
      }
      completeSent = true;
      resolveRun();
      writer.send(createCompleteMessage({
        provider: 'workbuddy',
        sessionId: appSessionId,
        actualSessionId: capturedSessionId ?? undefined,
        exitCode: payload.exitCode,
        aborted: payload.aborted,
      }));
      if (payload.aborted) {
        notifyRunStopped({ userId, provider: 'workbuddy', sessionId: appSessionId, sessionName, stopReason: 'aborted' });
      } else if (payload.exitCode === 0) {
        notifyRunStopped({ userId, provider: 'workbuddy', sessionId: appSessionId, sessionName, stopReason: 'completed' });
      } else {
        notifyRunFailed({
          userId,
          provider: 'workbuddy',
          sessionId: appSessionId,
          sessionName,
          error: payload.error ?? `WorkBuddy exited with code ${payload.exitCode}`,
        });
      }
    };

    const announceSession = () => {
      // Resumed sessions already carry a provider id; only brand-new sessions
      // announce their id for persistence.
      if (providerSessionId || !capturedSessionId || sessionCreatedSent) {
        return;
      }
      sessionCreatedSent = true;
      writer.send(createNormalizedMessage({
        kind: 'session_created',
        newSessionId: capturedSessionId,
        sessionId: appSessionId,
        provider: 'workbuddy',
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
        return;
      }

      if (event.type === 'error') {
        // A fatal engine error (e.g. --resume pointing at an unknown session)
        // arrives as a single error event with no assistant/result follow-up.
        // Surface it to the frontend instead of dropping it silently.
        const errorText = typeof event.error === 'string' && event.error.trim()
          ? event.error
          : typeof event.message === 'string' && event.message.trim()
            ? event.message
            : 'WorkBuddy 运行失败';
        writer.send(createNormalizedMessage({
          kind: 'error',
          provider: 'workbuddy',
          sessionId: appSessionId,
          content: errorText,
        }));
        finish({ exitCode: 1, error: errorText });
        return;
      }

      if (event.type === 'system' && event.subtype === 'init') {
        if (typeof event.session_id === 'string' && event.session_id) {
          capturedSessionId = event.session_id;
        }
        return;
      }

      if (event.type === 'assistant' && !sessionCreatedSent && !providerSessionId) {
        // The engine publishes the session id on the first assistant event too.
        if (typeof event.session_id === 'string' && event.session_id && !capturedSessionId) {
          capturedSessionId = event.session_id;
        }
        announceSession();
      }

      if (event.type === 'assistant') {
        for (const message of context.normalizeMessage(event, appSessionId)) {
          writer.send(message);
        }
        return;
      }

      if (event.type === 'result') {
        if (!capturedSessionId && typeof event.session_id === 'string' && event.session_id) {
          capturedSessionId = event.session_id;
        }
        announceSession();
        if (event.subtype === 'success' && !event.is_error) {
          finish({ exitCode: 0 });
        } else {
          const message = typeof event.result === 'string'
            ? event.result
            : event.error && typeof event.error === 'string'
              ? event.error
              : 'WorkBuddy task failed';
          finish({ exitCode: 1, error: message });
        }
      }
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
      const text = chunk.toString().trim();
      if (text) {
        console.error(`[WorkBuddy] ${text}`);
      }
    });
    child.on('error', (error) => {
      finish({ exitCode: 1, error: error.message });
    });
    child.on('close', (code) => {
      activeProcesses.delete(appSessionId);
      const wasAborted = abortedSessionIds.delete(appSessionId);
      // The engine may emit its final JSON event (usually `result`) without a
      // trailing newline, leaving it stranded in the split buffer. Flush it
      // before judging the run, so the terminal event and session id are not
      // lost and a clean completion is not misread as a failure.
      if (stdoutBuffer.trim()) {
        const remainingLine = stdoutBuffer.trim();
        stdoutBuffer = '';
        processLine(remainingLine);
      }
      if (!completeSent) {
        finish(wasAborted
          ? { exitCode: 0, aborted: true }
          : { exitCode: code === 0 ? 0 : 1, error: code === 0 ? undefined : `WorkBuddy exited with code ${code ?? 'unknown'}` });
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
export function resetWorkbuddyRuntimeForTests(): void {
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
