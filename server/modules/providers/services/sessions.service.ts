import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { forkSession as sdkForkSession } from '@anthropic-ai/claude-agent-sdk';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
  SessionOutlineItem,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type CreateAppSessionResult = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
  sessionName: string;
};

/**
 * Minimal shape of the claude-agent-sdk `forkSession` call used for branching,
 * kept loose so tests can inject a fake without importing the SDK namespace.
 */
type ClaudeBranchForkFn = (
  sessionId: string,
  options?: { dir?: string; upToMessageId?: string; title?: string },
) => Promise<{ sessionId: string }>;

type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

type RecentSessionListItem = Pick<
  ArchivedSessionListItem,
  'sessionId' | 'provider' | 'projectId' | 'projectDisplayName' | 'sessionTitle' | 'lastActivity'
>;

type RecentSessionsPage = {
  conversations: RecentSessionListItem[];
  total: number;
  hasMore: boolean;
};

type SessionDetails = {
  /** Canonical app-facing session id (may differ from the looked-up id when a provider-native id was given). */
  sessionId: string;
  provider: LLMProvider;
  summary: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isArchived: boolean;
  project: {
    projectId: string;
    path: string;
    fullPath: string;
    displayName: string;
    isStarred: boolean;
    isArchived: boolean;
  } | null;
};

const MAX_CLOUDCLI_SESSION_NAME_WORDS = 4;

function buildCloudCliSessionName(initialMessage: string): string {
  const words = initialMessage.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, MAX_CLOUDCLI_SESSION_NAME_WORDS).join(' ') || 'Untitled Session';
}

const MAX_OUTLINE_SNIPPET_LENGTH = 80;

/** First non-empty line of a message, trimmed. */
function firstNonEmptyLine(value: string): string {
  return (value.split('\n').find((part) => part.trim().length > 0) ?? '').trim();
}

/**
 * Builds the lightweight outline from normalized history.
 *
 * Keeps `kind === 'text' && role === 'user'` rows only, mirroring what
 * `normalizedToChatMessages` would surface as `type: 'user'` chat messages.
 */
function buildOutlineItems(messages: NormalizedMessage[]): SessionOutlineItem[] {
  const items: SessionOutlineItem[] = [];

  for (const message of messages) {
    if (message.kind !== 'text' || message.role !== 'user') continue;

    const content = typeof message.content === 'string' ? message.content : '';
    const displayText = typeof message.displayText === 'string' ? message.displayText : '';
    const raw = content.trim().length > 0 ? content : displayText;
    const snippet = firstNonEmptyLine(raw).slice(0, MAX_OUTLINE_SNIPPET_LENGTH);

    // Claude wraps background-agent results in a synthetic user-role row; the
    // chat renderer shows it as an assistant notification, so keep it out of
    // the outline for parity.
    if (snippet.startsWith('<task-notification>')) continue;

    items.push({ timestamp: message.timestamp, snippet });
  }

  return items;
}

/**
 * Removes one file if it exists.
 */
async function removeFileIfExists(filePath: string): Promise<boolean> {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Archive rows need a stable project label even when the owning project is not
 * part of the active sidebar payload. This lightweight resolver keeps the
 * archive API self-contained while still matching the project's stored display
 * name when one exists.
 */
function resolveProjectDisplayName(
  projectPath: string | null,
  customProjectName: string | null | undefined,
): string {
  const trimmedCustomName = typeof customProjectName === 'string' ? customProjectName.trim() : '';
  if (trimmedCustomName.length > 0) {
    return trimmedCustomName;
  }

  if (!projectPath) {
    return 'Unknown Project';
  }

  return path.basename(projectPath) || projectPath;
}

/**
 * Application service for provider-backed session message operations.
 *
 * Callers pass a provider id and this service resolves the concrete provider
 * class, keeping normalization/history call sites decoupled from implementation
 * file layout.
 */
export const sessionsService = {
  /**
   * Lists provider ids that can load session history and normalize live messages.
   */
  listProviderIds(): LLMProvider[] {
    return providerRegistry.listProviders().map((provider) => provider.id);
  },

  /**
   * Returns app-facing ids for provider runs that are currently processing.
   *
   * This is intentionally status-only: callers that only need sidebar activity
   * indicators should not attach to chat streams or request replayed messages.
   */
  listRunningSessions(): Array<{
    sessionId: string;
    provider: LLMProvider;
    startedAt: number;
    lastSeq: number;
  }> {
    return chatRunRegistry.listRunningRuns();
  },

  /**
   * Returns the active conversation feed in true global activity order.
   */
  listRecentSessions(limit: number, offset: number): RecentSessionsPage {
    const page = sessionsDb.getRecentSessionsPage(limit, offset);
    const projectCache = new Map<string, ReturnType<typeof projectsDb.getProjectPath>>();
    const conversations = page.sessions.map((session) => {
      const projectPath = session.project_path?.trim() ? session.project_path : null;
      let project = null;

      if (projectPath) {
        if (!projectCache.has(projectPath)) {
          projectCache.set(projectPath, projectsDb.getProjectPath(projectPath));
        }
        project = projectCache.get(projectPath) ?? null;
      }

      return {
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        projectId: project?.project_id ?? null,
        projectDisplayName: resolveProjectDisplayName(projectPath, project?.custom_project_name),
        sessionTitle: session.custom_name?.trim() || session.session_id,
        lastActivity: session.updated_at ?? session.created_at ?? null,
      };
    });

    return {
      conversations,
      total: page.total,
      hasMore: offset + conversations.length < page.total,
    };
  },

  /**
   * Resolves the provider-native session id a runtime needs for resume.
   *
   * Callers hand provider runtimes the stable app session id; the provider
   * CLIs/SDKs only understand their own native id, which lives on the session
   * row. Ids without a row are assumed to be provider-native already (direct
   * API callers that reference sessions the watcher has not indexed yet).
   */
  resolveProviderSessionId(sessionId: string | null | undefined): string | null {
    if (!sessionId) {
      return null;
    }

    const session = sessionsDb.getSessionById(sessionId);
    return session ? session.provider_session_id : sessionId;
  },

  /**
   * Resolves the provider data root that owns a session's on-disk transcript,
   * so runtimes can launch the engine against the same config dir the session
   * was written from. WorkBuddy/CodeBuddy transcripts live under
   * `{configDir}/projects/{encodedCwd}/{id}.jsonl`; this strips those three
   * trailing segments to recover the config dir. Returns null when the session
   * has no indexed transcript (fresh sessions fall back to the engine default).
   */
  resolveProviderConfigDir(sessionId: string | null | undefined): string | null {
    if (!sessionId) {
      return null;
    }

    const session = sessionsDb.getSessionById(sessionId);
    if (!session?.jsonl_path) {
      return null;
    }

    const match = session.jsonl_path.match(/^(.+)[/\\]projects[/\\][^/\\]+[/\\][^/\\]+\.jsonl$/);
    return match ? match[1] : null;
  },

  /**
   * Normalizes one provider-native event into frontend session message events.
   */
  normalizeMessage(
    providerName: string,
    raw: unknown,
    sessionId: string | null,
  ): NormalizedMessage[] {
    return providerRegistry.resolveProvider(providerName).sessions.normalizeMessage(raw, sessionId);
  },

  /**
   * Allocates a stable app-facing session id before any provider run happens.
   *
   * This is the entry point of the session gateway: the frontend calls this
   * (via `POST /api/providers/sessions`) when the user starts a brand-new
   * chat, navigates to the returned id immediately, and the id never changes
   * for the lifetime of the conversation. The provider-native id is mapped to
   * this row later, when the provider runtime announces it mid-run. Its title
   * comes directly from the first visible CloudCLI message and is limited to
   * four whole words before any provider-owned storage exists.
   */
  createAppSession(
    provider: LLMProvider,
    projectPath: string,
    initialMessage: string,
  ): CreateAppSessionResult {
    const normalizedProjectPath = projectPath.trim();
    if (!normalizedProjectPath) {
      throw new AppError('projectPath is required.', {
        code: 'PROJECT_PATH_REQUIRED',
        statusCode: 400,
      });
    }

    const sessionId = randomUUID();
    const sessionName = buildCloudCliSessionName(initialMessage);
    sessionsDb.createAppSession(sessionId, provider, normalizedProjectPath, sessionName);

    return {
      sessionId,
      provider,
      projectPath: normalizedProjectPath,
      sessionName,
    };
  },

  /**
   * Forks a Claude session at the message identified by `messageId`.
   *
   * Uses the Claude Agent SDK's native `forkSession`, which copies the source
   * transcript into a brand-new JSONL, remapping every message UUID and slicing
   * at `upToMessageId` (inclusive). The forked provider session is then
   * registered as a fresh app session: a new app-allocated id, the provider
   * mapping, and — once the transcript path is known — the `jsonl_path` that
   * history fetches depend on. Only Claude supports branching today; other
   * providers reject the call.
   */
  async createClaudeBranch(
    sourceSessionId: string,
    messageId: string,
    deps: { forkSession: ClaudeBranchForkFn } = { forkSession: sdkForkSession },
  ): Promise<{ sessionId: string; providerSessionId: string; sessionName: string }> {
    const source = sessionsDb.getSessionById(sourceSessionId);
    if (!source) {
      throw new AppError(`Session "${sourceSessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }
    if (source.provider !== 'claude') {
      throw new AppError('Branching is only supported for Claude sessions.', {
        code: 'BRANCH_UNSUPPORTED_PROVIDER',
        statusCode: 400,
      });
    }
    if (!source.provider_session_id) {
      throw new AppError('This session ID is not available yet.', {
        code: 'PROVIDER_SESSION_ID_NOT_AVAILABLE',
        statusCode: 409,
      });
    }
    if (!source.project_path) {
      throw new AppError('projectPath is required.', {
        code: 'PROJECT_PATH_REQUIRED',
        statusCode: 400,
      });
    }

    // Frontend message ids are `<native-uuid>_text_<index>` (or `_tr_<toolUseId>`
    // for tool results); the native message UUID is always the leading segment.
    const branchUuid = messageId.trim().split('_')[0];
    if (!branchUuid) {
      throw new AppError('messageId is invalid.', {
        code: 'INVALID_MESSAGE_ID',
        statusCode: 400,
      });
    }

    const sourceName = source.custom_name?.trim() || '';
    const forkedTitle = sourceName ? `${sourceName} (fork)` : undefined;

    const { forkSession } = deps;
    let forkedProviderSessionId: string;
    try {
      const result = await forkSession(source.provider_session_id, {
        dir: source.project_path,
        upToMessageId: branchUuid,
        title: forkedTitle,
      });
      forkedProviderSessionId = result.sessionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(`Failed to fork Claude session: ${message}`, {
        code: 'SESSION_BRANCH_FAILED',
        statusCode: 500,
      });
    }

    const newAppSessionId = randomUUID();
    const sessionName = forkedTitle ?? sourceName;
    sessionsDb.createAppSession(newAppSessionId, 'claude', source.project_path, sessionName);
    sessionsDb.assignProviderSessionId(newAppSessionId, forkedProviderSessionId);

    // Attach the forked transcript path so history fetches resolve immediately.
    // The fork lands in the same project directory as the source transcript, so
    // derive it from the source's jsonl_path first; fall back to scanning.
    let forkedJsonlPath: string | null = null;
    if (source.jsonl_path) {
      const candidate = path.join(path.dirname(source.jsonl_path), `${forkedProviderSessionId}.jsonl`);
      try {
        await fsp.access(candidate);
        forkedJsonlPath = candidate;
      } catch {
        forkedJsonlPath = null;
      }
    }
    if (!forkedJsonlPath) {
      try {
        const synchronizer = providerRegistry.resolveProvider('claude').sessionSynchronizer;
        forkedJsonlPath = (await synchronizer.resolveTranscriptPath?.(
          forkedProviderSessionId,
          source.project_path,
        )) ?? null;
      } catch {
        forkedJsonlPath = null;
      }
    }
    if (forkedJsonlPath) {
      sessionsDb.createSession(
        forkedProviderSessionId,
        'claude',
        source.project_path,
        sessionName,
        undefined,
        undefined,
        forkedJsonlPath,
      );
    }

    return {
      sessionId: newAppSessionId,
      providerSessionId: forkedProviderSessionId,
      sessionName,
    };
  },

  /**
   * Resolves the provider-native id only for an explicit user copy action.
   * Normal session payloads continue to expose only the stable app id.
   */
  getProviderSessionId(sessionId: string): string {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!session.provider_session_id) {
      throw new AppError('This session ID is not available yet.', {
        code: 'PROVIDER_SESSION_ID_NOT_AVAILABLE',
        statusCode: 409,
      });
    }

    return session.provider_session_id;
  },

  /**
   * Fetches persisted history by app session id.
   *
   * Provider and provider-specific lookup hints are resolved from the indexed
   * session metadata in the database. The provider adapter receives the
   * provider-native session id (the one written into transcripts on disk),
   * and every returned message is remapped back to the app session id so
   * provider ids never reach the frontend.
   */
  async fetchHistory(
    sessionId: string,
    options: Pick<FetchHistoryOptions, 'limit' | 'offset'> = {},
  ): Promise<FetchHistoryResult> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    // App-created sessions that never produced a provider transcript yet
    // (e.g. first message still streaming) simply have no history.
    if (!session.provider_session_id) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset: options.offset ?? 0,
        limit: options.limit ?? null,
      };
    }

    const provider = session.provider as LLMProvider;
    const result = await providerRegistry.resolveProvider(provider).sessions.fetchHistory(sessionId, {
      limit: options.limit ?? null,
      offset: options.offset ?? 0,
      projectPath: session.project_path ?? '',
      providerSessionId: session.provider_session_id,
    });

    return {
      ...result,
      messages: result.messages.map((message) => ({
        ...message,
        sessionId,
      })),
    };
  },

  /**
   * Returns a lightweight outline of a session's user turns for the QuickSettings
   * outline panel.
   *
   * Only `{ timestamp, snippet }` pairs are returned instead of the full
   * transcript, so opening the outline panel never pays the cost of downloading
   * and re-normalizing entire conversations. History is still read server-side
   * via `fetchHistory`, but the heavy payload never crosses the wire.
   */
  async fetchOutline(sessionId: string): Promise<SessionOutlineItem[]> {
    const history = await sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 });
    return buildOutlineItems(history.messages);
  },

  /**
   * Resolves one session (by app id, falling back to the provider-native id)
   * to its metadata plus the owning project.
   *
   * This backs deep links like `/session/:sessionId`: the frontend's paginated
   * project payloads only carry each project's first session page, so a
   * session opened directly by URL may not be present client-side at all —
   * this lookup is the authoritative way to learn which project owns it.
   */
  getSessionDetailsById(sessionId: string): SessionDetails {
    const session =
      sessionsDb.getSessionById(sessionId) ?? sessionsDb.getSessionByProviderSessionId(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const projectPath = session.project_path?.trim() ? session.project_path : null;
    const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;

    return {
      sessionId: session.session_id,
      provider: session.provider as LLMProvider,
      summary: session.custom_name?.trim() || '',
      createdAt: session.created_at ?? null,
      updatedAt: session.updated_at ?? null,
      lastActivity: session.updated_at ?? session.created_at ?? null,
      isArchived: Boolean(session.isArchived),
      project: project && projectPath
        ? {
            projectId: project.project_id,
            path: projectPath,
            fullPath: projectPath,
            displayName: resolveProjectDisplayName(projectPath, project.custom_project_name),
            isStarred: Boolean(project.isStarred),
            isArchived: Boolean(project.isArchived),
          }
        : null,
    };
  },

  /**
   * Returns archived sessions with enough project metadata for the sidebar to
   * group, filter, open, and restore them without a per-row follow-up query.
   */
  listArchivedSessions(): ArchivedSessionListItem[] {
    const archivedSessions = sessionsDb.getArchivedSessions();
    const projectCache = new Map<string, ReturnType<typeof projectsDb.getProjectPath>>();

    return archivedSessions.map((session) => {
      const projectPath = session.project_path?.trim() ? session.project_path : null;
      let project = null;

      if (projectPath) {
        if (!projectCache.has(projectPath)) {
          projectCache.set(projectPath, projectsDb.getProjectPath(projectPath));
        }
        project = projectCache.get(projectPath) ?? null;
      }

      return {
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        projectId: project?.project_id ?? null,
        projectPath,
        projectDisplayName: resolveProjectDisplayName(projectPath, project?.custom_project_name),
        sessionTitle: session.custom_name?.trim() || session.session_id,
        createdAt: session.created_at ?? null,
        updatedAt: session.updated_at ?? null,
        lastActivity: session.updated_at ?? session.created_at ?? null,
        isProjectArchived: Boolean(project?.isArchived),
      };
    });
  },

  /**
   * Archives or permanently deletes one persisted session row by id.
   *
   * Soft-delete mirrors the project behavior by toggling `isArchived` so the
   * row disappears from active lists but remains restorable. Force-delete
   * optionally removes the transcript file before deleting the database row.
   */
  async deleteOrArchiveSessionById(
    sessionId: string,
    options: {
      force?: boolean;
      deletedFromDisk?: boolean;
    } = {},
  ): Promise<{ sessionId: string; action: 'archived' | 'deleted'; deletedFromDisk: boolean }> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!options.force) {
      sessionsDb.updateSessionIsArchived(sessionId, true);
      return {
        sessionId,
        action: 'archived',
        deletedFromDisk: false,
      };
    }

    let removedFromDisk = false;
    if (options.deletedFromDisk) {
      let transcriptPath = session.jsonl_path;
      if (!transcriptPath && session.provider_session_id && session.project_path) {
        // Rows that were never indexed carry no jsonl_path; ask the provider's
        // synchronizer to resolve the on-disk transcript so a permanent delete
        // still removes the file instead of letting the next scan resurrect it.
        try {
          const synchronizer = providerRegistry.resolveProvider(session.provider).sessionSynchronizer;
          transcriptPath = (await synchronizer.resolveTranscriptPath?.(
            session.provider_session_id,
            session.project_path,
          )) ?? null;
        } catch {
          // Unknown provider or no path resolver: fall back to removing the row only.
        }
      }
      if (transcriptPath) {
        removedFromDisk = await removeFileIfExists(transcriptPath);
      }
    }

    const deleted = sessionsDb.deleteSessionById(sessionId);
    if (!deleted) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    return {
      sessionId,
      action: 'deleted',
      deletedFromDisk: removedFromDisk,
    };
  },

  /**
   * Restores one archived session back into the active sidebar lists.
   */
  restoreSessionById(sessionId: string): { sessionId: string; isArchived: false } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionIsArchived(sessionId, false);
    return { sessionId, isArchived: false };
  },

  /**
   * Renames one session by id without requiring the caller to pass provider.
   */
  renameSessionById(sessionId: string, summary: string): { sessionId: string; summary: string } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionCustomName(sessionId, summary);
    return { sessionId, summary };
  },
};
