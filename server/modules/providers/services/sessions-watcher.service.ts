import os from 'node:os';
import path from 'node:path';
import { existsSync, promises as fsPromises } from 'node:fs';

import chokidar, { type FSWatcher } from 'chokidar';

import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';
import { getDshSessionsRoot } from '@/modules/providers/list/dsh/dsh-models.provider.js';
import { isDshSessionLogFile } from '@/modules/providers/list/dsh/dsh-sessions.provider.js';
import { getOmpSessionsRoot } from '@/modules/providers/list/omp/omp-models.provider.js';
import { getOpenclawAgentsDir, getOpenclawHomeDir } from '@/modules/providers/list/openclaw/openclaw-models.provider.js';
import { getPiSessionsRoot } from '@/modules/providers/list/pi/pi-models.provider.js';
import { getWorkbuddySessionRoots } from '@/modules/providers/list/workbuddy/workbuddy-storage.provider.js';
import { getZcodeHomeDir } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { broadcastSessionUpsertedBatch } from '@/modules/websocket/index.js';
import type { LLMProvider, SessionUpsertChange } from '@/shared/types.js';

type WatcherEventType = 'add' | 'change';

/**
 * Provider session roots to watch.
 *
 * Resolved lazily (not at module load) so environment overrides like
 * `DSH_SESSIONS_ROOT` are honored whenever the watcher starts.
 */
function getProviderWatchPaths(): Array<{ provider: LLMProvider; rootPath: string }> {
  return [
    {
      provider: 'claude',
      rootPath: path.join(os.homedir(), '.claude', 'projects'),
    },
    {
      provider: 'cursor',
      rootPath: path.join(os.homedir(), '.cursor', 'projects'),
    },
    {
      provider: 'codex',
      rootPath: path.join(os.homedir(), '.codex', 'sessions'),
    },
    {
      provider: 'opencode',
      rootPath: path.join(os.homedir(), '.local', 'share', 'opencode'),
    },
    {
      provider: 'dsh',
      rootPath: getDshSessionsRoot(),
    },
    ...getWorkbuddySessionRoots().map((rootPath) => ({ provider: 'workbuddy' as const, rootPath })),
    {
      provider: 'pi',
      rootPath: getPiSessionsRoot(),
    },
    {
      provider: 'zcode',
      // ZCode keeps every session in one SQLite database; watching its
      // directory catches the checkpoint writes that update db.sqlite.
      rootPath: path.join(getZcodeHomeDir(), 'cli', 'db'),
    },
    {
      provider: 'omp',
      rootPath: getOmpSessionsRoot(),
    },
    {
      provider: 'openclaw',
      // OpenClaw keeps every conversation in a per-agent SQLite store under
      // `agents/<agentId>/agent/`; watching that root catches the checkpoint
      // writes that update `openclaw-agent.sqlite`.
      rootPath: getOpenclawAgentsDir(),
    },
  ];
}

/**
 * True when a provider's engine looks installed on this machine. Guards the
 * watcher's `mkdir` so a missing engine (e.g. no dsh-desktop) does not get a
 * phantom directory tree created under the user's home.
 */
function isProviderEnginePresent(provider: LLMProvider, rootPath: string): boolean {
  if (provider === 'dsh' || provider === 'pi' || provider === 'omp') {
    // Guard the watcher's mkdir: a missing engine (no dsh-desktop, no pi CLI,
    // no omp CLI) must not get a phantom directory tree created under the
    // user's home. All three keep their sessions under their agent directory,
    // so the parent of the sessions root is the engine's own state folder.
    return existsSync(path.dirname(rootPath));
  }
  if (provider === 'zcode') {
    // ZCode's storage root is created by the app; without it there is nothing
    // to watch and the watcher must not create a phantom ~/.zcode tree.
    return existsSync(getZcodeHomeDir());
  }
  if (provider === 'openclaw') {
    // OpenClaw's state root is created by its own install; without it there is
    // nothing to watch and the watcher must not create a phantom ~/.openclaw.
    return existsSync(getOpenclawHomeDir());
  }
  // The remaining providers store transcripts under home-dir config folders
  // owned by the engine; watching an empty-but-created folder is harmless and
  // keeps the watcher ready for a first session.
  return true;
}

/**
 * What the watcher never descends into or reports. These used to be glob
 * strings, which chokidar v4 no longer understands: it takes a path, a RegExp
 * or a function, so the globs matched nothing and every file under every
 * provider root was watched and, with polling, stat()ed every interval (#1156).
 */
const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  // Claude writes a subagent's transcript and large tool outputs here. The
  // synchronizer skips them already (#880); ignoring them here keeps the
  // watcher from walking them at all.
  'subagents',
  'tool-results',
]);
const IGNORED_FILE_NAMES = new Set(['.DS_Store']);
const IGNORED_FILE_SUFFIXES = ['.tmp', '.swp'];

/**
 * Builds chokidar's `ignored` matcher for one watch root.
 *
 * Only the part of the path below `rootPath` is checked, so a home directory
 * that happens to sit under `/build` or `/dist` cannot hide a whole provider.
 *
 * Exported for the providers module's tests, which run it against chokidar on
 * a real directory tree.
 */
export function createWatcherIgnoredMatcher(rootPath: string): (filePath: string) => boolean {
  return (filePath: string) => {
    const relativePath = path.relative(rootPath, filePath);
    // Outside the root is `..` as a whole component, or an absolute result
    // (another drive on Windows). A child called `..archive` is still inside.
    const isOutsideRoot = relativePath === '..'
      || relativePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativePath);
    if (!relativePath || isOutsideRoot) {
      return false;
    }

    const segments = relativePath.split(path.sep);
    const baseName = segments[segments.length - 1];
    if (IGNORED_FILE_NAMES.has(baseName) || IGNORED_FILE_SUFFIXES.some((suffix) => baseName.endsWith(suffix))) {
      return true;
    }

    return segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
  };
}

const PROJECTS_UPDATE_DEBOUNCE_MS = 500;
const PROJECTS_UPDATE_MAX_WAIT_MS = 2_000;

const watchers: FSWatcher[] = [];

type PendingWatcherUpdate = {
  providers: Set<LLMProvider>;
  changeTypes: Set<WatcherEventType>;
  /**
   * Provider-native session ids reported by the synchronizers, each with the
   * change classification to announce it under. They are translated back to
   * app-facing session rows at flush time, because the transcript file names on
   * disk only ever contain provider ids.
   */
  updatedSessionIds: Map<string, SessionUpsertChange>;
};

let pendingWatcherUpdate: PendingWatcherUpdate | null = null;
let pendingWatcherUpdateStartedAt: number | null = null;
let pendingWatcherFlushTimer: ReturnType<typeof setTimeout> | null = null;
let watcherRefreshInFlight = false;
let watcherRescheduleAfterRefresh = false;

/**
 * Filters watcher events to provider-specific session artifact file types.
 */
function isWatcherTargetFile(provider: LLMProvider, filePath: string): boolean {
  if (provider === 'opencode') {
    return path.basename(filePath) === 'opencode.db';
  }

  if (provider === 'dsh') {
    return isDshSessionLogFile(path.basename(filePath));
  }

  if (provider === 'zcode') {
    return path.basename(filePath) === 'db.sqlite';
  }

  if (provider === 'openclaw') {
    return path.basename(filePath) === 'openclaw-agent.sqlite';
  }

  return filePath.endsWith('.jsonl');
}

function clearPendingWatcherFlushTimer(): void {
  if (pendingWatcherFlushTimer) {
    clearTimeout(pendingWatcherFlushTimer);
    pendingWatcherFlushTimer = null;
  }
}

function schedulePendingWatcherFlush(): void {
  if (!pendingWatcherUpdate) {
    return;
  }

  const now = Date.now();
  if (pendingWatcherUpdateStartedAt === null) {
    pendingWatcherUpdateStartedAt = now;
  }

  const elapsed = now - pendingWatcherUpdateStartedAt;
  const remainingMaxWait = Math.max(0, PROJECTS_UPDATE_MAX_WAIT_MS - elapsed);
  const delay = Math.min(PROJECTS_UPDATE_DEBOUNCE_MS, remainingMaxWait);

  clearPendingWatcherFlushTimer();
  pendingWatcherFlushTimer = setTimeout(() => {
    void flushPendingWatcherUpdate();
  }, delay);
}

function queuePendingWatcherUpdate(
  eventType: WatcherEventType,
  provider: LLMProvider,
  updatedSessionId: string | null,
  change: SessionUpsertChange
): void {
  if (!pendingWatcherUpdate) {
    pendingWatcherUpdate = {
      providers: new Set<LLMProvider>(),
      changeTypes: new Set<WatcherEventType>(),
      updatedSessionIds: new Map<string, SessionUpsertChange>(),
    };
  }

  pendingWatcherUpdate.providers.add(provider);
  pendingWatcherUpdate.changeTypes.add(eventType);
  if (updatedSessionId) {
    // Content wins within one debounce window: an add and a touch of the same
    // session must announce the stronger of the two, never the weaker.
    const existing = pendingWatcherUpdate.updatedSessionIds.get(updatedSessionId);
    if (existing !== 'content') {
      pendingWatcherUpdate.updatedSessionIds.set(updatedSessionId, change);
    }
  }

  schedulePendingWatcherFlush();
}

async function flushPendingWatcherUpdate(): Promise<void> {
  clearPendingWatcherFlushTimer();

  if (!pendingWatcherUpdate) {
    return;
  }

  if (watcherRefreshInFlight) {
    watcherRescheduleAfterRefresh = true;
    return;
  }

  const queuedUpdate = pendingWatcherUpdate;
  pendingWatcherUpdate = null;
  pendingWatcherUpdateStartedAt = null;
  watcherRefreshInFlight = true;

  try {
    // Per-session deltas instead of full project snapshots: an upsert of one
    // session can never clobber unrelated client state, so the frontend needs
    // no "suppress updates while a run is active" protection logic.
    await broadcastSessionUpsertedBatch(
      [...queuedUpdate.updatedSessionIds].map(([sessionId, change]) => ({ sessionId, change })),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Session watcher refresh failed while broadcasting session_upserted', { error: message });
  } finally {
    watcherRefreshInFlight = false;

    if (pendingWatcherUpdate || watcherRescheduleAfterRefresh) {
      watcherRescheduleAfterRefresh = false;
      schedulePendingWatcherFlush();
    }
  }
}

/**
 * Classifies one watcher event for the `session_upserted` broker.
 *
 * An `add` is always new content. A `change` defers to the synchronizer's
 * content-level signal: a false answer means the bytes moved without the
 * conversation advancing (a `touch`), so the client must not flag it unread.
 * A null answer means the provider cannot tell, and the previous behaviour —
 * announce content — is kept so a possible new message is never swallowed.
 *
 * @internal Exported for the watcher tests.
 */
export function classifyWatcherChange(
  eventType: WatcherEventType,
  contentChanged: boolean | null
): SessionUpsertChange {
  if (eventType === 'add') {
    return 'content';
  }
  return contentChanged === false ? 'metadata' : 'content';
}

/**
 * Handles file watcher updates and triggers provider file-level synchronization.
 */
async function onUpdate(
  eventType: WatcherEventType,
  filePath: string,
  provider: LLMProvider
): Promise<void> {
  if (!isWatcherTargetFile(provider, filePath)) {
    return;
  }

  try {
    const result = await sessionSynchronizerService.synchronizeProviderFile(provider, filePath);
    if (!result.indexed) {
      return;
    }

    console.log(`Session synchronization triggered by ${eventType} event for provider "${provider}"`, {
      filePath,
      sessionId: result.sessionId,
    });

    // An `add` is always new content. For a `change`, trust the synchronizer's
    // content-level signal to tell a real append from a bare touch; when the
    // provider cannot tell (null) keep the previous behaviour — announce
    // content — rather than risk swallowing a possible new-message notice.
    const change = classifyWatcherChange(eventType, result.contentChanged);

    queuePendingWatcherUpdate(eventType, provider, result.sessionId, change);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Session watcher sync failed for provider "${provider}"`, {
      eventType,
      filePath,
      error: message,
    });
  }
}

/**
 * Starts provider filesystem watchers and performs initial DB synchronization.
 */
export async function initializeSessionsWatcher(): Promise<void> {
  console.log('Setting up session watchers');

  const initialSync = await sessionSynchronizerService.synchronizeSessions();
  console.log('Initial session synchronization complete', {
    processedByProvider: initialSync.processedByProvider,
    prunedOrphans: initialSync.prunedOrphans,
    failures: initialSync.failures,
  });

  for (const { provider, rootPath } of getProviderWatchPaths()) {
    if (!isProviderEnginePresent(provider, rootPath)) {
      console.log(`Skipping session watcher for provider "${provider}": engine not present`);
      continue;
    }
    try {
      await fsPromises.mkdir(rootPath, { recursive: true });

      const watcher = chokidar.watch(rootPath, {
        ignored: createWatcherIgnoredMatcher(rootPath),
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        depth: 6,
        // Polling reaches filesystems that native events cannot: WSL's /mnt/c,
        // network shares, some container mounts. Where native events do work,
        // chokidar's own CHOKIDAR_USEPOLLING=false overrides this and a finished
        // turn reaches the sidebar at once instead of up to 6 s later.
        usePolling: true,
        interval: 6_000,
        binaryInterval: 6_000,
      });

      watcher
        .on('add', (filePath: string) => {
          void onUpdate('add', filePath, provider);
        })
        .on('change', (filePath: string) => {
          void onUpdate('change', filePath, provider);
        })
        .on('error', (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Session watcher error for provider "${provider}"`, { error: message });
        });

      watchers.push(watcher);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to initialize session watcher for provider "${provider}"`, {
        rootPath,
        error: message,
      });
    }
  }
}

/**
 * Stops all active provider session watchers.
 */
export async function closeSessionsWatcher(): Promise<void> {
  clearPendingWatcherFlushTimer();

  await Promise.all(
    watchers.map(async (watcher) => {
      try {
        await watcher.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Failed to close session watcher', { error: message });
      }
    })
  );
  watchers.length = 0;
  pendingWatcherUpdate = null;
  pendingWatcherUpdateStartedAt = null;
  watcherRefreshInFlight = false;
  watcherRescheduleAfterRefresh = false;
}
