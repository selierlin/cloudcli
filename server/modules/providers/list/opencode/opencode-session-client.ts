import type { ChildProcess } from 'node:child_process';

import spawn from 'cross-spawn';

import { AppError, readObjectRecord, readOptionalString } from '@/shared/utils.js';

/** How long to wait for a throwaway `opencode serve` to print its address. */
const SERVER_READY_TIMEOUT_MS = 20_000;
/** How long the fork request itself may take once the server is up. */
const FORK_REQUEST_TIMEOUT_MS = 15_000;
/** How long a server gets to exit on SIGTERM before it is force-killed. */
const SHUTDOWN_GRACE_MS = 2_000;

type OpenCodeServerHandle = {
  child: ChildProcess;
  baseUrl: string;
};

/**
 * Drives a throwaway `opencode serve` process for the one operation the
 * one-shot `opencode run` CLI cannot express: forking a session at a message.
 *
 * OpenCode exposes no fork subcommand — `run --fork` copies a whole session and
 * then continues it, which would run the model — so a message-level fork is
 * only reachable through the HTTP API. The server binds loopback on an
 * OS-assigned port and is torn down as soon as the fork returns, so there is no
 * daemon to supervise and no fixed port to collide on.
 */
export class OpenCodeSessionClient {
  /**
   * Copies the session into a new one and returns its provider-native id.
   *
   * `messageId` cuts right before that message (OpenCode's cut is exclusive of
   * it); omitting it copies the whole conversation.
   */
  async forkSession(input: { providerSessionId: string; messageId?: string }): Promise<string> {
    const server = await this.startServer();
    try {
      const response = await fetch(
        `${server.baseUrl}/session/${encodeURIComponent(input.providerSessionId)}/fork`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input.messageId ? { messageID: input.messageId } : {}),
          signal: AbortSignal.timeout(FORK_REQUEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        throw new AppError(`OpenCode refused the fork (HTTP ${response.status}).`, {
          code: 'FORK_FAILED',
          statusCode: 502,
        });
      }

      const childId = readOptionalString(readObjectRecord(await response.json())?.id);
      if (!childId) {
        throw new AppError('OpenCode forked the session but returned no session id.', {
          code: 'FORK_FAILED',
          statusCode: 502,
        });
      }
      return childId;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(`OpenCode fork request failed: ${message}`, {
        code: 'FORK_FAILED',
        statusCode: 502,
      });
    } finally {
      await this.stopServer(server);
    }
  }

  private startServer(): Promise<OpenCodeServerHandle> {
    return new Promise<OpenCodeServerHandle>((resolve, reject) => {
      const child = spawn('opencode', ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let settled = false;
      let output = '';
      let timer: NodeJS.Timeout | undefined;

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        child.kill('SIGKILL');
        reject(error);
      };

      const onOutput = (chunk: Buffer): void => {
        output += chunk.toString();
        // `--port 0` lets the OS pick the port, and the server prints the URL
        // it settled on — that line is the only place the port is announced.
        const match = output.match(/listening on (http:\/\/[^\s]+)/);
        if (match && !settled) {
          settled = true;
          if (timer) {
            clearTimeout(timer);
          }
          resolve({ child, baseUrl: match[1].replace(/\/+$/, '') });
        }
      };

      timer = setTimeout(() => {
        fail(new AppError('The OpenCode server did not become ready in time.', {
          code: 'FORK_FAILED',
          statusCode: 502,
        }));
      }, SERVER_READY_TIMEOUT_MS);

      // The address banner arrives on stderr; watching both keeps this from
      // depending on which stream the CLI happens to use.
      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);
      child.on('error', (error) => {
        fail(new AppError(`The OpenCode server could not start: ${error.message}`, {
          code: 'FORK_FAILED',
          statusCode: 502,
        }));
      });
      child.on('exit', (code) => {
        fail(new AppError(`The OpenCode server exited before it was ready (code ${code ?? 'null'}).`, {
          code: 'FORK_FAILED',
          statusCode: 502,
        }));
      });
    });
  }

  private async stopServer(server: OpenCodeServerHandle): Promise<void> {
    const { child } = server;
    child.kill('SIGTERM');
    if (await this.waitForExit(child, SHUTDOWN_GRACE_MS)) {
      return;
    }
    child.kill('SIGKILL');
    await this.waitForExit(child, SHUTDOWN_GRACE_MS);
  }

  private waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
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
}

export const openCodeSessionClient = new OpenCodeSessionClient();
