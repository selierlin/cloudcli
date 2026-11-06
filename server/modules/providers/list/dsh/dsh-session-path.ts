import { readdirSync } from 'node:fs';
import path from 'node:path';

import { getDshSessionsRoot } from './dsh-models.provider.js';

// ---------- DSH session-log path layout ----------
//
// The harness persists one session as `<sessions-root>/<project-key>/
// <session-id>/session[.vN].jsonl[.zstd]`. Both directory names are one-way
// encodings, so every reader and writer has to agree on the exact rules.
//
// This module holds only those rules: the sessions adapter, the indexer and the
// fork writer all import them here so neither of them has to depend on another
// adapter for a path.
//
// A root uses a single physical encoding for every generation: `zstd` (the
// default) stores concatenated Zstandard frames as `.jsonl.zstd`, while `none`
// stores plaintext lines as `.jsonl`. Version 0 keeps the original
// suffix-only `session.jsonl.zstd`; every later generation inserts a lowercase
// `.vN` component (`session.v1.jsonl.zstd`, `session.v3.jsonl.zstd`, …).
// Discovery therefore matches the pattern instead of one hardcoded name, or
// every session migrated to a newer generation would silently read as empty.

const SESSION_LOG_PATTERN = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/;

/** True when a file name is any DSH session-log format generation. Used by the indexer and watcher. */
export function isDshSessionLogFile(fileName: string): boolean {
  return SESSION_LOG_PATTERN.test(fileName);
}

/** Format generation encoded in a session-log file name (0 when the `.vN` part is absent). */
export function sessionLogGeneration(fileName: string): number {
  const generation = SESSION_LOG_PATTERN.exec(fileName)?.[1];
  return generation ? Number.parseInt(generation, 10) : 0;
}

/**
 * Picks the log to read inside one session directory: the highest format
 * generation present. A session migrated to a newer generation keeps the same
 * directory, so a leftover older log must not shadow the current one.
 *
 * Used by the sessions adapter, the indexer and the fork writer.
 */
export function findDshSessionLogPath(sessionDir: string): string | null {
  let names: string[];
  try {
    names = readdirSync(sessionDir).filter(isDshSessionLogFile);
  } catch {
    // Missing or unreadable directory: no session log to read.
    return null;
  }
  if (names.length === 0) {
    return null;
  }
  names.sort((a, b) => sessionLogGeneration(b) - sessionLogGeneration(a));
  return path.join(sessionDir, names[0]);
}

/** Escapes one raw session id into a single safe path segment (`~XXXX` for unsafe code units). */
export function encodeSessionSegment(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch;
    } else {
      out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  return out;
}

/**
 * Builds the readable project directory key for a session cwd: separators
 * become `-`, unsafe code units use `~XXXX`, and the result is wrapped in
 * `--…--` (mirrors `projectKey` in the DSH JSONL persistence package).
 */
export function projectKey(cwd: string): string {
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) {
        readable += '-';
      }
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
      separatorRun = false;
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root';
  return `--${slug.slice(0, 251)}--`;
}

/**
 * Resolves the session-log path for one ACP session id under a project cwd.
 *
 * Exported for the fork and edit paths: the session row's
 * `provider_session_id` is the authoritative link to the current log, while
 * `jsonl_path` can be empty or stale, so both must locate their source the
 * same way history reads do.
 */
export function resolveSessionLogPath(acpSessionId: string, cwd: string): string | null {
  return findDshSessionLogPath(path.join(
    getDshSessionsRoot(),
    projectKey(cwd),
    encodeSessionSegment(acpSessionId),
  ));
}
