import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { getOmpSessionsRoot } from '@/modules/providers/list/omp/omp-models.provider.js';

/**
 * Transcript-path resolution for OMP sessions, kept separate from both the
 * sessions adapter and the fork provider: each needs to find a transcript on
 * disk, and the fork provider importing the sessions module (which itself
 * imports the fork provider) would close an import cycle.
 */

/** Mirrors OMP's directory encoding: strip leading slash, map `/\:` to `-`, wrap in `--…--`. */
function encodeOmpCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

async function findTranscriptBySuffix(root: string, suffix: string): Promise<string | null> {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findTranscriptBySuffix(path.join(root, entry.name), suffix);
      if (found) {
        return found;
      }
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return path.join(root, entry.name);
    }
  }
  return null;
}

/**
 * Resolves the transcript path for one OMP session (header UUID). OMP names
 * files `<ISO时间戳>_<UUID>.jsonl`, so the encoded-cwd directory is scanned for
 * a matching suffix first; a full recursive search over the sessions root
 * covers cwd-encoding edge characters (spaces, unicode, dashes) and the flat
 * layout `PI_CODING_AGENT_SESSION_DIR` produces.
 *
 * The cwd is also encoded from the realpath on macOS: OMP stores a transcript
 * opened from `/tmp/...` under `--private-tmp-...--`, which only the recursive
 * fallback finds.
 */
export async function resolveOmpTranscriptPath(
  providerSessionId: string,
  projectPath: string | undefined,
  sessionsRoot = getOmpSessionsRoot(),
): Promise<string | null> {
  const suffix = `_${providerSessionId}.jsonl`;
  const encoded = projectPath ? encodeOmpCwd(projectPath) : '';

  const encodedDir = path.join(sessionsRoot, encoded);
  try {
    for (const name of await fsp.readdir(encodedDir)) {
      if (name.endsWith(suffix)) {
        return path.join(encodedDir, name);
      }
    }
  } catch {
    // Encoded directory may not exist yet; fall through to recursive search.
  }

  return findTranscriptBySuffix(sessionsRoot, suffix);
}
