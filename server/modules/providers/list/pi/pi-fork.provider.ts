import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { AppError, readObjectRecord } from '@/shared/utils.js';
import type { IProviderFork } from '@/shared/interfaces.js';

import { getPiCommand, supportsPiFork } from './pi-auth.provider.js';
import { resolvePiTranscriptPath } from './pi-sessions.provider.js';

type PiForkHeader = {
  sessionId: string;
  cwd: string;
  parentSession: string;
};

/** Materialises a complete Pi conversation as a native child JSONL session. */
export class PiForkProvider implements IProviderFork {
  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: string }> {
    if (input.upToAnchorId) {
      throw new AppError('Pi can currently fork complete sessions only.', {
        code: 'FORK_ANCHOR_NOT_SUPPORTED',
        statusCode: 409,
      });
    }
    if (!await supportsPiFork()) {
      throw new AppError('The installed Pi CLI does not support session forking.', {
        code: 'FORK_NOT_SUPPORTED',
        statusCode: 409,
      });
    }

    const sourcePath = path.resolve(input.jsonlPath);
    const header = await this.spawnFork(sourcePath, input.projectPath);
    if (!await samePath(header.cwd, input.projectPath)) {
      throw new AppError('Pi forked the session into a different project directory.', {
        code: 'FORK_PROJECT_MISMATCH',
        statusCode: 502,
      });
    }
    if (!await samePath(header.parentSession, sourcePath)) {
      throw new AppError('Pi fork did not record the expected source session.', {
        code: 'FORK_SOURCE_MISMATCH',
        statusCode: 502,
      });
    }

    const forkedPath = await resolvePiTranscriptPath(header.sessionId, input.projectPath);
    if (!forkedPath) {
      throw new AppError('Pi reported a fork but wrote no session transcript.', {
        code: 'FORK_FAILED',
        statusCode: 502,
      });
    }
    await this.validateForkTranscript(forkedPath, header);
    return { providerSessionId: header.sessionId, jsonlPath: forkedPath };
  }

  private async spawnFork(sourcePath: string, projectPath: string): Promise<PiForkHeader> {
    return new Promise<PiForkHeader>((resolve, reject) => {
      const child = spawn(getPiCommand(), ['--fork', sourcePath, '--mode', 'json'], {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Pi creates a fork without a prompt only after it observes EOF.
      child.stdin.end();

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new AppError(`Pi fork failed: ${stderr.trim() || `exit ${code}`}`, {
            code: 'FORK_FAILED',
            statusCode: 502,
          }));
          return;
        }
        const header = this.readHeader(stdout, sourcePath);
        if (!header) {
          reject(new AppError('Pi fork did not emit a valid child session header.', {
            code: 'FORK_FAILED',
            statusCode: 502,
          }));
          return;
        }
        resolve(header);
      });
    });
  }

  private readHeader(output: string, sourcePath: string): PiForkHeader | null {
    for (const line of output.split(/\r?\n/)) {
      try {
        const event = readObjectRecord(JSON.parse(line));
        if (event?.type !== 'session') continue;
        const sessionId = typeof event.id === 'string' ? event.id : '';
        const cwd = typeof event.cwd === 'string' ? event.cwd : '';
        const parentSession = typeof event.parentSession === 'string' ? event.parentSession : '';
        if (sessionId && cwd && parentSession && path.resolve(parentSession) === sourcePath) {
          return { sessionId, cwd, parentSession };
        }
      } catch {
        // Only JSON session frames are relevant; Pi may print diagnostics too.
      }
    }
    return null;
  }

  private async validateForkTranscript(filePath: string, expected: PiForkHeader): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const event = readObjectRecord(JSON.parse(line));
        if (event?.type !== 'session') continue;
        const idMatches = event.id === expected.sessionId;
        const cwdMatches = typeof event.cwd === 'string' && await samePath(event.cwd, expected.cwd);
        const parentMatches = typeof event.parentSession === 'string' && await samePath(event.parentSession, expected.parentSession);
        if (idMatches && cwdMatches && parentMatches) return;
      }
    } catch {
      // The common error below deliberately does not leak local transcript contents.
    }
    throw new AppError('Pi fork wrote a transcript with an unexpected session header.', {
      code: 'FORK_FAILED',
      statusCode: 502,
    });
  }
}

/** `/var` may be a symlink to `/private/var` on macOS, including for Pi's cwd. */
async function samePath(left: string, right: string): Promise<boolean> {
  try {
    return await realpath(left) === await realpath(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}
