import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getConnection } from '@/modules/database/index.js';
import { getGlobalImageAssetsDir, normalizeAttachmentDescriptors } from '@/shared/image-attachments.js';
import { decodeSessionLogBuffer } from '@/shared/session-log.js';
import {
  isUploadStoredFileName,
  removeStoredAsset,
} from '@/modules/assets/services/image-assets.service.js';

/**
 * Reclaims uploaded chat assets nobody will ever send.
 *
 * Assets are uploaded as soon as the user picks or pastes a file, before they
 * press send, because uploading on send made the composer look frozen. That
 * early upload creates files for pictures the user then removes, for composer
 * drafts abandoned in another session, and for messages queued and later
 * discarded.
 *
 * Two signals keep a file alive: it is referenced by a stored draft/queued
 * message, or it is referenced by an indexed provider transcript. Anything
 * else is a candidate once it is old enough that no composer could still be
 * holding it in memory — a file still sitting in an unsent composer is
 * protected by `ASSET_GRACE_MS` alone, not by anything that outlives a reload.
 *
 * Consumers: the Assets route (`POST /collect`) and `server/index.ts` (startup
 * pass plus a periodic sweep).
 */

/** Freshly uploaded assets survive at least this long, whatever else says. */
const ASSET_GRACE_MS = 24 * 60 * 60 * 1_000;

/** How often a long-running server looks for abandoned assets. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1_000;

/** Folder name every uploaded chat asset lives in (`~/.cloudcli/assets`). */
const ASSETS_FOLDER_NAME = 'assets';

/** Filename segment before the original name, minted by the upload route. */
const STORED_NAME_PATTERN = /^(\d{10,16})-\d+-(.*)$/;

let sweepTimer: NodeJS.Timeout | null = null;

type AssetReference = {
  fileName: string;
  /** Absolute path the descriptor pointed at, used to anchor or remove the file. */
  path: string;
};

/** Returns true when `fileName` is a direct child name minted by the upload route. */
function isStoredAssetFileName(fileName: string): boolean {
  return isUploadStoredFileName(fileName);
}

/** Reads the timestamp segment out of a stored name, or null when unknown. */
function readStoredNameTimestamp(fileName: string): number | null {
  const match = STORED_NAME_PATTERN.exec(fileName);
  if (!match) {
    return null;
  }
  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

/**
 * Normalizes one stored descriptor into the asset it anchors.
 *
 * Only direct children of the global assets folder count: descriptors may also
 * point at project files, which are not this service's to reclaim.
 */
function readAssetReference(descriptor: unknown): AssetReference | null {
  const [normalized] = normalizeAttachmentDescriptors([descriptor]);
  if (!normalized) {
    return null;
  }
  const assetsRoot = path.resolve(getGlobalImageAssetsDir());
  const resolved = path.resolve(assetsRoot, normalized.path);
  const relative = path.relative(assetsRoot, resolved);
  if (
    !relative
    || relative.startsWith('..')
    || path.isAbsolute(relative)
    || relative.includes(path.sep)
    || !isStoredAssetFileName(relative)
  ) {
    return null;
  }
  return { fileName: relative, path: resolved };
}

/** Every asset filename currently referenced by a stored draft or queued message. */
function collectDraftReferences(): Set<string> {
  const referenced = new Set<string>();
  const rows = getConnection()
    .prepare('SELECT queued_message FROM session_drafts WHERE queued_message IS NOT NULL')
    .all() as Array<{ queued_message: string }>;

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.queued_message);
    } catch {
      continue;
    }
    const attachments = (parsed as { attachments?: unknown } | null)?.attachments;
    for (const descriptor of Array.isArray(attachments) ? attachments : []) {
      const reference = readAssetReference(descriptor);
      if (reference) {
        referenced.add(reference.fileName);
      }
    }
  }
  return referenced;
}

/** Every asset filename mentioned by an indexed provider transcript. */
async function collectTranscriptReferences(): Promise<Set<string>> {
  const referenced = new Set<string>();
  const rows = getConnection()
    .prepare(
      `SELECT jsonl_path
       FROM sessions
       WHERE jsonl_path IS NOT NULL AND jsonl_path <> ''`,
    )
    .all() as Array<{ jsonl_path: string }>;

  // Matches "<assets>/<name>" wherever a transcript quotes a stored path,
  // accepting an escaped or plain separator so one pattern covers both JSON
  // serializations and a Windows path.
  const assetPathPattern = new RegExp(`${escapeRegExp(ASSETS_FOLDER_NAME)}[\\/\\\\]+[^"\\s]+`, 'g');

  for (const row of rows) {
    let text: string;
    try {
      // Read bytes, not a UTF-8 string: a DSH transcript is a `.jsonl.zstd`
      // frame stream, and decoding it as text makes every reference unmatchable
      // — the collector would then delete images a live session still shows.
      text = decodeSessionLogBuffer(await fs.readFile(row.jsonl_path), row.jsonl_path);
    } catch {
      // A transcript deleted underneath the index cannot reference anything.
      continue;
    }
    for (const match of text.matchAll(assetPathPattern)) {
      const fileName = path.posix.basename(match[0]);
      if (isStoredAssetFileName(fileName)) {
        referenced.add(fileName);
      }
    }
  }
  return referenced;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Files older than the grace period whose mtime is still older than the grace period. */
async function listCollectableAssets(cutoff: number): Promise<string[]> {
  const assetsRoot = getGlobalImageAssetsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(assetsRoot);
  } catch {
    return [];
  }

  const collectable: string[] = [];
  for (const fileName of entries) {
    if (!isStoredAssetFileName(fileName)) {
      continue;
    }
    const storedAt = readStoredNameTimestamp(fileName);
    if (storedAt !== null && storedAt > cutoff) {
      continue;
    }
    try {
      const stat = await fs.stat(path.join(assetsRoot, fileName));
      if (stat.isFile() && stat.mtimeMs <= cutoff) {
        collectable.push(fileName);
      }
    } catch {
      // Removed between readdir and stat; nothing to collect.
    }
  }
  return collectable;
}

/**
 * One collection pass. Returns how many assets were removed.
 *
 * Exported so a test can drive a pass without waiting on the timer.
 */
export async function collectAbandonedAssets(
  now: Date = new Date(),
  graceMs: number = ASSET_GRACE_MS,
): Promise<number> {
  const cutoff = now.getTime() - graceMs;
  const candidates = await listCollectableAssets(cutoff);
  if (candidates.length === 0) {
    return 0;
  }

  const referenced = collectDraftReferences();
  for (const fileName of await collectTranscriptReferences()) {
    referenced.add(fileName);
  }

  let removed = 0;
  for (const fileName of candidates) {
    if (referenced.has(fileName)) {
      continue;
    }
    if (await removeStoredAsset(fileName)) {
      removed += 1;
    }
  }
  return removed;
}

/**
 * Collects leftovers once, then keeps sweeping in the background.
 *
 * Never throws: a broken transcript must not stop the server from starting, and
 * the next sweep retries it.
 */
export async function initializeAssetCleanup(): Promise<void> {
  try {
    const removed = await collectAbandonedAssets();
    if (removed > 0) {
      console.log(`[assets] Reclaimed ${removed} abandoned upload(s)`);
    }
  } catch (error) {
    console.error('[assets] Startup asset cleanup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (sweepTimer) {
    return;
  }
  sweepTimer = setInterval(() => {
    void collectAbandonedAssets().catch((error) => {
      console.error('[assets] Periodic asset cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, SWEEP_INTERVAL_MS);
  // A cleanup timer must never be the reason the process stays alive.
  sweepTimer.unref();
}

/** Stops the periodic sweep. Consumers: the server's shutdown path. */
export function closeAssetCleanup(): void {
  if (!sweepTimer) {
    return;
  }
  clearInterval(sweepTimer);
  sweepTimer = null;
}
