import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import type { IProviderFork } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { AppError, readObjectRecord } from '@/shared/utils.js';

import {
  encodeSessionSegment,
  isDshSessionLogFile,
  projectKey,
  resolveSessionLogPath,
  sessionLogGeneration,
} from './dsh-session-path.js';

// ---------- DSH session-log fork materialisation ----------
//
// DSH persists a session as `<sessions-root>/--<project-key>--/<session-id>/
// session[.vN].jsonl[.zstd]`: one header line followed by append-only events,
// each carrying a dense `seq`. Its harness can fork a session internally, but
// that fork writes `parentSession` into the child header, and the ACP server
// refuses to resume any session carrying it (`session is not resumable`).
//
// A fork is therefore materialised here: the source events up to a `turn/end`
// are copied into a fresh session directory under a new id, with the
// `parentSession` field deliberately omitted. The DSH read layer validates the
// artifact as a *seed* (`isSeeded: true` plus a trailing
// `session/end-seed { inherited: true }` marker), and the ACP server resumes it
// like any other session. Verified offline against the harness's own
// `restoreReleasedV4Artifact` for every boundary in 24 real logs, and on a real
// `dsh --profile acp` child (`scripts/spikes/dsh-fork-seed-selfcheck.mjs`,
// `scripts/spikes/dsh-acp-resume-probe.mjs`).

const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** The only session format this build knows how to copy (DSH 0.2.0-rc.2). */
const SUPPORTED_FORMAT_VERSION = 4;

/**
 * Delivery acknowledgement written by the `session-log-deepseek` plugin.
 *
 * It names the session it belongs to, so a copied prefix must repoint it at the
 * new id: the marker is exempt from that check only when the header carries
 * `parentSession`, which a resumable seed cannot have. The plugin is off by
 * default, so no real log on a default install contains one — a unit test
 * fabricates it instead.
 */
const DELIVERY_ACCEPTED_TYPE = 'session-log-deepseek/delivery-accepted';

/**
 * Header fields this build accepts, mirroring the v4 writer.
 *
 * A field outside this set means a newer harness generation changed the
 * header; refusing is what turns an upstream format bump into "fork is
 * unavailable" instead of a silently unreadable session.
 */
const HEADER_FIELDS = new Set([
  'type',
  'version',
  'id',
  'createdAt',
  'cwd',
  'isSeeded',
  'delegationDepth',
  'agentPreset',
  'parentSession',
  'origin',
]);

/**
 * Event types the harness accepts (mirrors `KNOWN_SESSION_EVENT_TYPES` in
 * `@deepseek-ai/dsh-session` 0.2.0-rc.2).
 *
 * An event outside this set would be dropped by the harness's restore step, so
 * the copied prefix would no longer be the conversation the user picked. A
 * genuinely external event may still be copied when it is explicitly marked
 * `ignorable: true`, which is how the harness itself keeps such rows readable.
 */
const KNOWN_EVENT_TYPES = new Set([
  'agent-preset/selected',
  'agent/inbox/spliced',
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'assistant/attempt',
  'assistant/message',
  'command/done',
  'command/run',
  'compaction/end',
  'compaction/prune',
  'compaction/start',
  'compaction/summary',
  'deliverables/presented',
  'developer/message',
  'feedback/message-delete',
  'feedback/message-put',
  'feedback/record',
  'goal/change',
  'hook/invoked',
  'hook/result',
  'image/offload',
  'llm/retry',
  'llm/retry-started',
  'model/selection',
  'permission/preset',
  'plan/mode',
  'request/context',
  'request/header',
  'sandbox/mode',
  'schedule/change',
  'session-log-deepseek/delivery-accepted',
  'session/end-seed',
  'session/title',
  'session/title-llm-request',
  'step/end',
  'step/start',
  'subagent/catalog',
  'subagent/descriptor',
  'subagent/model-selection-policy',
  'system/message',
  'team/member',
  'team/message/delivered',
  'team/message/queued',
  'team/task',
  'todo/write',
  'tool-workflow/agent-end',
  'tool-workflow/agent-start',
  'tool-workflow/run-end',
  'tool-workflow/run-start',
  'tool/call',
  'tool/ptc-dispatch',
  'tool/ptc-dispatch-start',
  'tool/result',
  'turn/end',
  'turn/start',
  'user/message',
  'web/deepseek-search-llm-request',
  'workspace/changes',
]);

type DshSessionLog = { header: AnyRecord; events: AnyRecord[] };

type DshForkSeed = { header: AnyRecord; events: AnyRecord[]; cut: number };

/** Builds the fork-level rejection shared by every unsupported-source case. */
function unsupportedFormat(reason: string): AppError {
  return new AppError(`This DSH session cannot be forked: ${reason}`, {
    code: 'FORK_UNSUPPORTED_FORMAT',
    statusCode: 409,
  });
}

/** Builds the corrupt/unreadable-source rejection. */
function corruptSource(reason: string): AppError {
  return new AppError(`The DSH transcript could not be read: ${reason}`, {
    code: 'FORK_SOURCE_CORRUPT',
    statusCode: 409,
  });
}

/**
 * Decodes one session log, refusing anything the harness would only partly
 * read.
 *
 * `decodeSessionLogBuffer` in the sessions adapter deliberately skips corrupt
 * Zstandard frames and malformed lines so history degrades instead of failing.
 * A fork cannot: copying a prefix that silently lost events would produce a
 * session whose conversation is not the one the user chose.
 */
export function decodeDshSessionLogStrict(buffer: Buffer, logPath: string): DshSessionLog {
  let text = '';
  if (logPath.endsWith('.zstd')) {
    let index = buffer.indexOf(ZSTD_FRAME_MAGIC);
    if (index < 0) {
      throw corruptSource('the file holds no Zstandard frame.');
    }
    if (index > 0) {
      throw corruptSource('unexpected bytes before the first Zstandard frame.');
    }
    while (index !== -1) {
      const next = buffer.indexOf(ZSTD_FRAME_MAGIC, index + ZSTD_FRAME_MAGIC.length);
      const frame = buffer.subarray(index, next === -1 ? buffer.length : next);
      try {
        text += zlib.zstdDecompressSync(frame).toString('utf8');
      } catch {
        throw corruptSource('a Zstandard frame failed to decompress.');
      }
      index = next;
    }
  } else {
    text = buffer.toString('utf8');
  }

  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    throw corruptSource('the file is empty.');
  }

  const header = parseLogLine(lines[0], 0);
  const events = lines.slice(1).map((line, index) => parseLogLine(line, index + 1));
  return { header, events };
}

/** Parses one log line, naming the line in the error so a corrupt log is locatable. */
function parseLogLine(line: string, lineNumber: number): AnyRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw corruptSource(`line ${lineNumber + 1} is not valid JSON.`);
  }
  const record = readObjectRecord(parsed);
  if (!record) {
    throw corruptSource(`line ${lineNumber + 1} is not a JSON object.`);
  }
  return record;
}

/** Rejects a header whose version or field set this build does not understand. */
function assertSupportedHeader(header: AnyRecord): void {
  if (header.version !== SUPPORTED_FORMAT_VERSION) {
    throw unsupportedFormat(`session format version ${String(header.version)} is not supported.`);
  }
  if (typeof header.id !== 'string' || !header.id) {
    throw corruptSource('the header has no session id.');
  }
  for (const field of Object.keys(header)) {
    if (!HEADER_FIELDS.has(field)) {
      throw unsupportedFormat(`the header carries an unknown field "${field}".`);
    }
  }
  if (header.cwd !== undefined && typeof header.cwd !== 'string') {
    throw corruptSource('the header has a malformed cwd.');
  }
  if (header.delegationDepth !== undefined && typeof header.delegationDepth !== 'number') {
    throw unsupportedFormat('the header has a malformed delegation depth.');
  }
}

/** Rejects any event the harness's restore step would not accept. */
function assertKnownEvents(events: AnyRecord[]): void {
  for (const event of events) {
    if (typeof event.type !== 'string') {
      throw corruptSource(`event ${String(event.seq)} has no type.`);
    }
    if (!KNOWN_EVENT_TYPES.has(event.type) && event.ignorable !== true) {
      throw unsupportedFormat(`event type "${event.type}" is not supported.`);
    }
  }
}

/**
 * Asserts `events[i].seq === i`, after which an anchor id addresses the event
 * array directly and a copied prefix keeps every reference inside itself.
 */
function assertDenseSeqs(events: AnyRecord[]): void {
  for (const [index, event] of events.entries()) {
    if (event.seq !== index) {
      throw corruptSource(`event sequence is not dense at line ${index + 1} (seq ${String(event.seq)}).`);
    }
  }
}

/**
 * Resolves which `turn/end` seq a fork keeps through.
 *
 * Anchors are always `turn/end` seqs (the sessions adapter only stamps those),
 * so a prefix never carries an unanswered prompt into the child. A fork of the
 * whole session is allowed only when the log ends on a closed turn: silently
 * stopping one turn earlier would drop content the user asked to copy.
 */
export function resolveDshForkBoundary(events: AnyRecord[], upToAnchorId?: string): number {
  if (upToAnchorId === undefined) {
    const last = events[events.length - 1];
    if (last?.type !== 'turn/end') {
      throw new AppError('This DSH session is still running; fork it after the current turn ends.', {
        code: 'FORK_SOURCE_NOT_READY',
        statusCode: 409,
      });
    }
    return last.seq as number;
  }

  if (!/^\d+$/.test(upToAnchorId)) {
    throw new AppError('That message cannot be forked from.', {
      code: 'FORK_ANCHOR_INVALID',
      statusCode: 409,
    });
  }
  const boundary = Number.parseInt(upToAnchorId, 10);
  if (!Number.isSafeInteger(boundary) || events[boundary]?.type !== 'turn/end') {
    throw new AppError('That message cannot be forked from.', {
      code: 'FORK_ANCHOR_INVALID',
      statusCode: 409,
    });
  }
  return boundary;
}

/**
 * Builds the child log: a fresh header, the source events through `boundary`,
 * and the trailing `end-seed` marker that tells the harness where the inherited
 * prefix ends.
 *
 * `parentSession` is never written — the ACP server refuses to resume a
 * session that carries one. Lineage is CloudCLI's concern and lives in the
 * `forked_from_session_id` column.
 */
export function buildDshForkSeed(input: {
  header: AnyRecord;
  events: AnyRecord[];
  boundary: number;
  newId: string;
}): DshForkSeed {
  const { header: source, events, boundary, newId } = input;
  const header: AnyRecord = {
    version: SUPPORTED_FORMAT_VERSION,
    id: newId,
    createdAt: Date.now(),
    isSeeded: true,
    delegationDepth: source.delegationDepth ?? 0,
  };
  if (typeof source.cwd === 'string') {
    header.cwd = source.cwd;
  }
  if (typeof source.agentPreset === 'string') {
    header.agentPreset = source.agentPreset;
  }

  const prefix = events.slice(0, boundary + 1).map((event) => {
    const copy = structuredClone(event);
    if (copy.type === DELIVERY_ACCEPTED_TYPE) {
      const data = readObjectRecord(copy.data);
      if (!data || typeof data.sessionId !== 'string') {
        throw unsupportedFormat('a delivery marker has an unknown shape.');
      }
      // `seq` and `throughSeq` keep their values: the marker still points at an
      // event inside the copied prefix, and its own seq stays dense.
      copy.data = { ...data, sessionId: newId };
    }
    return copy;
  });

  const cut = boundary + 1;
  prefix.push({
    type: 'session/end-seed',
    seq: cut,
    time: typeof events[boundary]?.time === 'number' ? events[boundary].time : Date.now(),
    data: { inherited: true },
  });

  return { header, events: prefix, cut };
}

/**
 * Encodes a seed the way the harness reads it.
 *
 * The header MUST be its own Zstandard frame: the reader decompresses frame 0
 * and requires the plaintext to be exactly one header line, so putting the
 * events in the same frame fails with `first frame is not exactly one header
 * line`. Events may share one frame after it.
 */
export function encodeDshForkSeed(seed: DshForkSeed, compression: 'zstd' | 'none'): Buffer {
  const headerLine = `${JSON.stringify({ type: 'session', ...seed.header })}\n`;
  const body = `${seed.events.map((event) => JSON.stringify(event)).join('\n')}\n`;
  if (compression === 'none') {
    return Buffer.from(headerLine + body, 'utf8');
  }
  return Buffer.concat([
    zlib.zstdCompressSync(Buffer.from(headerLine, 'utf8')),
    zlib.zstdCompressSync(Buffer.from(body, 'utf8')),
  ]);
}

/** Asserts the first Zstandard frame holds the header line and nothing else. */
function assertHeaderFrameIsAlone(buffer: Buffer): void {
  const secondFrame = buffer.indexOf(ZSTD_FRAME_MAGIC, ZSTD_FRAME_MAGIC.length);
  const firstFrame = buffer.subarray(0, secondFrame === -1 ? buffer.length : secondFrame);
  let text: string;
  try {
    text = zlib.zstdDecompressSync(firstFrame).toString('utf8');
  } catch {
    throw new AppError('The forked DSH session could not be verified.', {
      code: 'FORK_FAILED',
      statusCode: 502,
    });
  }
  const lines = text.split('\n');
  if (lines.length !== 2 || lines[1] !== '') {
    throw new AppError('The forked DSH session could not be verified.', {
      code: 'FORK_FAILED',
      statusCode: 502,
    });
  }
}

/**
 * Re-reads a written artifact and asserts the properties a resumable seed needs
 * before the caller inserts a database row for it.
 *
 * The caller is about to tell the user a session exists; discovering a broken
 * artifact on the next run would show an empty conversation instead.
 */
function assertForkArtifact(
  buffer: Buffer,
  logPath: string,
  expected: { newId: string; cut: number },
): void {
  const fail = (reason: string): never => {
    throw new AppError(`The forked DSH session could not be verified: ${reason}`, {
      code: 'FORK_FAILED',
      statusCode: 502,
    });
  };

  if (logPath.endsWith('.zstd')) {
    assertHeaderFrameIsAlone(buffer);
  }
  const log = decodeDshSessionLogStrict(buffer, logPath);
  assertSupportedHeader(log.header);
  if (log.header.id !== expected.newId) {
    fail('the header id does not match the new session.');
  }
  if (log.header.isSeeded !== true) {
    fail('the header is not marked as a seed.');
  }
  if (log.header.parentSession !== undefined || log.header.origin !== undefined) {
    fail('the header carries fields that make it unresumable.');
  }
  if (log.events.length !== expected.cut + 1) {
    fail('the copied prefix has the wrong length.');
  }
  assertDenseSeqs(log.events);
  const marker = log.events[log.events.length - 1];
  if (marker?.type !== 'session/end-seed' || readObjectRecord(marker.data)?.inherited !== true) {
    fail('the inherited-prefix marker is missing.');
  }
}

/**
 * Branches a DSH conversation into an independent session that the ACP server
 * can resume.
 *
 * Used by `sessions.service.ts` for the chat's "fork from here" action and by
 * `btw.service.ts` for side questions; both reach it through
 * `IProviderFork`. The source log is never modified.
 */
export class DshForkProvider implements IProviderFork {
  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string | null;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: string }> {
    // `title` is deliberately unused: the sidebar name lives in this app's
    // session row, and DSH derives a title from the first user message.
    const sourcePath = resolveDshForkSourcePath(input);
    const log = await this.readSourceLog(sourcePath);

    assertSupportedHeader(log.header);
    assertDenseSeqs(log.events);
    assertKnownEvents(log.events);

    const sourceDirectory = path.dirname(path.dirname(sourcePath));
    if (typeof log.header.cwd === 'string' && path.basename(sourceDirectory) !== projectKey(log.header.cwd)) {
      // The stored identity ties the directory to the header cwd; a mismatch
      // means the path was rewritten, and a copy placed by that rule would be
      // rejected by the reader.
      throw unsupportedFormat('the transcript directory does not match its recorded working directory.');
    }
    const fileName = path.basename(sourcePath);
    const generation = sessionLogGeneration(fileName);
    if (!isDshSessionLogFile(fileName) || generation !== log.header.version) {
      throw unsupportedFormat('the file name and header disagree on the session format.');
    }
    const compression = fileName.endsWith('.zstd') ? 'zstd' : 'none';

    const boundary = resolveDshForkBoundary(log.events, input.upToAnchorId);
    const newId = randomUUID();
    const seed = buildDshForkSeed({
      header: log.header,
      events: log.events,
      boundary,
      newId,
    });
    const payload = encodeDshForkSeed(seed, compression);

    // Written beside the source so the new session lands under the same
    // project key and encoding. Re-deriving either would be a second source of
    // truth for the only thing that decides where the harness looks.
    const targetDirectory = path.join(sourceDirectory, encodeSessionSegment(newId));
    const targetPath = path.join(targetDirectory, fileName);
    await this.writeAtomically({
      payload,
      sourceDirectory,
      targetDirectory,
      targetPath,
      expectation: { newId, cut: seed.cut },
    });

    return { providerSessionId: newId, jsonlPath: targetPath };
  }

  private async readSourceLog(sourcePath: string): Promise<DshSessionLog> {
    let buffer: Buffer;
    try {
      buffer = await fsp.readFile(sourcePath);
    } catch {
      throw new AppError('The DSH transcript for this session could not be read.', {
        code: 'FORK_SOURCE_UNREADABLE',
        statusCode: 409,
      });
    }
    return decodeDshSessionLogStrict(buffer, sourcePath);
  }

  /**
   * Writes into a `.tmp-` directory and renames it into place, so the file
   * watcher never observes a half-written log. A rename inside one filesystem
   * is atomic; `.tmp-` names do not match the session-directory pattern, so a
   * crashed write cannot be indexed.
   */
  private async writeAtomically(input: {
    payload: Buffer;
    sourceDirectory: string;
    targetDirectory: string;
    targetPath: string;
    expectation: { newId: string; cut: number };
  }): Promise<void> {
    const { payload, sourceDirectory, targetDirectory, targetPath, expectation } = input;
    const temporaryDirectory = path.join(sourceDirectory, `.tmp-${randomUUID()}`);
    const temporaryPath = path.join(temporaryDirectory, path.basename(targetPath));
    let published = false;
    try {
      await fsp.mkdir(temporaryDirectory, { recursive: true });
      const handle = await fsp.open(temporaryPath, 'w');
      try {
        await handle.writeFile(payload);
        await handle.sync();
      } finally {
        await handle.close();
      }
      assertForkArtifact(await fsp.readFile(temporaryPath), temporaryPath, expectation);
      await fsp.rename(temporaryDirectory, targetDirectory);
      published = true;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `The DSH session could not be forked: ${error instanceof Error ? error.message : String(error)}`,
        { code: 'FORK_FAILED', statusCode: 502 },
      );
    } finally {
      if (!published) {
        // A failed fork leaves no directory a watcher could index.
        await fsp.rm(targetDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Resolves the log to copy for one session row.
 *
 * `provider_session_id` is authoritative: it is the id history reads resolve,
 * and after an edit it names the new log while `jsonl_path` can still describe
 * the superseded one. The recorded path is therefore only a consistency check —
 * except when the id-derived path is absent, where the row's own path is still
 * a precise statement rather than a guess. The project's "newest log" is never
 * consulted: in a multi-session project it would copy the wrong conversation.
 */
function resolveDshForkSourcePath(input: {
  providerSessionId: string;
  jsonlPath: string | null;
  projectPath: string;
}): string {
  const derived = resolveSessionLogPath(input.providerSessionId, input.projectPath);
  if (derived) {
    if (input.jsonlPath) {
      const recorded = path.resolve(input.jsonlPath);
      if (path.dirname(recorded) !== path.dirname(path.resolve(derived))) {
        throw new AppError('The DSH transcript recorded for this session is not the one it points to.', {
          code: 'FORK_SOURCE_NOT_READY',
          statusCode: 409,
        });
      }
    }
    return derived;
  }
  if (input.jsonlPath) {
    return input.jsonlPath;
  }
  throw new AppError('This DSH session has no transcript to fork yet.', {
    code: 'FORK_SOURCE_NOT_READY',
    statusCode: 409,
  });
}
