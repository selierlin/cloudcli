import {
  expireAuthSession,
  getStoredAuthToken,
  storeAuthToken,
} from '@/shared/authToken';
import { IS_PLATFORM } from '@/shared/utils';
import { readVoiceConfig, voiceConfigHeaders } from '@/shared/voiceConfig';
import type { McpTestConnectionInput, SessionMessagesRequestOptions } from '@/shared/types';

// Headers are a plain record rather than the full `HeadersInit` union so the
// defaults below can be merged with a caller's headers by spreading.
export type ApiRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

// Utility function for authenticated API calls
export const authenticatedFetch = (
  url: string,
  options: ApiRequestOptions = {},
): Promise<Response> => {
  const token = getStoredAuthToken();

  const defaultHeaders: Record<string, string> = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (!IS_PLATFORM && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  }).then((response) => {
    const refreshedToken = response.headers.get('X-Refreshed-Token');
    if (refreshedToken) {
      storeAuthToken(refreshedToken);
    }
    if (response.headers.get('X-Auth-Error')) {
      expireAuthSession();
    }
    return response;
  });
};

// ─── Request helpers ────────────────────────────────────────────────────────
// Every endpoint below goes through these so verb, JSON encoding and query
// serialization stay consistent across the whole frontend.

type QueryValue = string | number | boolean | null | undefined;

// Serializes a query object into `?a=1&b=2` (or an empty string). Empty and
// `false` values are dropped so optional flags can be passed unconditionally.
const query = (params: Record<string, QueryValue>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' || value === false) {
      continue;
    }
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
};

/**
 * Reads a `{ success, error, details }` envelope response, throwing the server's
 * message when the request failed.
 *
 * Endpoints return a bare Response, so call sites unwrap it themselves. Most do
 * so in ways that differ deliberately (bare casts where the caller inspects the
 * payload, abort-aware reads in the git panel); this is the shared form for
 * callers that want a failed request to throw.
 */
export class ApiRequestError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(message: string, options: { code?: string; details?: unknown; status: number }) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = options.code;
    this.details = options.details;
    this.status = options.status;
  }
}

/**
 * Reads a `{ success, error, details }` envelope response, throwing an
 * ApiRequestError carrying the server's machine-readable error code when one
 * is present. Accepts both legacy string envelopes (`error: 'message'`) and
 * the structured AppError envelope (`error: { code, message, details }`).
 */
export async function readApiJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data.success === false) {
    const raw = data.error ?? data.details;
    const payload = raw && typeof raw === 'object' ? raw : {};
    const message = (typeof raw === 'string' ? raw : payload?.message) || data.details || `Request failed (${response.status})`;
    throw new ApiRequestError(message, {
      code: typeof payload?.code === 'string' ? payload.code : undefined,
      details: payload?.details ?? data.details,
      status: response.status,
    });
  }
  return data as T;
}

/**
 * Picks the server's human-readable message out of a failed response body, or
 * null when it carries none. Accepts the legacy string envelope
 * (`error: 'message'`), the structured AppError envelope
 * (`error: { code, message, details }`) and a top-level `message`.
 *
 * The non-throwing counterpart of readApiJson, used by the auth and onboarding
 * screens because they show their own localized message when the server gives
 * none.
 */
export function readApiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const { error, message } = body as { error?: unknown; message?: unknown };
  const candidates = [
    error && typeof error === 'object' ? (error as { message?: unknown }).message : error,
    message,
  ];
  // The body is unchecked JSON: anything but a non-blank string is skipped, as
  // an object rendered as a React child throws and unmounts the screen.
  const readable = candidates.find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '',
  );
  return readable ?? null;
}

const get = (url: string, options: ApiRequestOptions = {}) => authenticatedFetch(url, options);

const withBody =
  (method: string) =>
    (url: string, body?: unknown, options: ApiRequestOptions = {}) =>
      authenticatedFetch(url, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...options,
      });

const post = withBody('POST');
const put = withBody('PUT');
const patch = withBody('PATCH');
const del = withBody('DELETE');

// ─── URL builders ───────────────────────────────────────────────────────────
// Exported for the consumers that cannot go through `authenticatedFetch`:
// `EventSource` and `XMLHttpRequest` need a bare URL.

/**
 * Persisted messages for one session. Omitting `limit` requests the whole
 * transcript; passing one always pairs it with an explicit offset so automatic
 * refreshes can never accidentally become an unbounded transcript request.
 */
export const sessionMessagesUrl = (
  sessionId: string,
  {
    limit = null,
    offset = 0,
    pageMode = 'rows',
    byteBudget,
    cursor,
    seek,
  }: SessionMessagesRequestOptions = {},
): string => {
  const base = `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages`;
  if (pageMode === 'turns') {
    return `${base}${query({
      pageMode,
      byteBudget,
      cursor,
      seekTimestamp: seek?.timestamp,
      seekSnippet: seek?.snippet,
      seekAnchorId: seek?.transcriptAnchorId,
    })}`;
  }
  return limit === null || limit === undefined
    ? base
    : `${base}${query({ limit, offset: offset ?? 0 })}`;
};

const fileContentPath = (projectId: string, filePath: string) =>
  `/api/file-tree/projects/${projectId}/files/content${query({ path: filePath })}`;

const pluginAssetPath = (pluginName: string, assetFile: string) =>
  `/api/plugins/${encodeURIComponent(pluginName)}/assets/${encodeURIComponent(assetFile)}`;

// ─── API endpoints ──────────────────────────────────────────────────────────
// Every `/api/...` path the frontend talks to is declared here; components
// import a named method instead of assembling URLs of their own.

export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (username: string, password: string) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username: string, password: string) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    refresh: () => post('/api/auth/refresh'),
    user: () => get('/api/auth/user'),
    // Deliberately bypasses authenticatedFetch: its first line reads the stored
    // token through getStoredAuthToken(), which fires the session-expired side
    // effect when the token has already lapsed — that would pop a bogus
    // "session expired" banner for a user who just chose to log out. Reading
    // localStorage directly and skipping response-side handling avoids both.
    logout: () => {
      const token = localStorage.getItem('auth-token');
      return fetch('/api/auth/logout', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    },
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  // After the projectName → projectId migration the path/query identifier is
  // the DB-assigned `projectId`; parameter names reflect that for clarity.
  // `skipSynchronization` avoids the backend's on-disk session rescan. Pure DB
  // mutations (pin/star) do not create transcripts, so their follow-up refresh
  // can skip it; refreshes that may reveal new transcripts must not.
  projects: ({ skipSynchronization = false }: { skipSynchronization?: boolean } = {}) =>
    get(`/api/projects${query({ skipSynchronization })}`),
  archivedProjects: () => get('/api/projects/archived'),
  projectSessions: (
    projectId: string,
    { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
    options: ApiRequestOptions = {},
  ) =>
    get(
      `/api/projects/${encodeURIComponent(projectId)}/sessions${query({ limit, offset })}`,
      options,
    ),
  projectTaskmaster: (projectId: string) =>
    get(`/api/projects/${encodeURIComponent(projectId)}/taskmaster`),
  renameProject: (projectId: string, displayName: string) =>
    put(`/api/projects/${projectId}/rename`, { displayName }),
  restoreProject: (projectId: string) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/restore`),
  // `hardDelete` => server `?force=true` (remove DB row + Claude *.jsonl + sessions rows for path).
  deleteProject: (projectId: string, hardDelete = false) =>
    del(`/api/projects/${projectId}${query({ force: hardDelete })}`),
  createProject: (projectData: unknown) => post('/api/projects/create-project', projectData),
  migrateLegacyProjectStars: (projectIds: string[]) =>
    post('/api/projects/migrate-legacy-stars', { projectIds }),
  toggleProjectStar: (projectId: string) =>
    post(`/api/projects/${encodeURIComponent(projectId)}/toggle-star`),
  // A clone is two requests: the details (GitHub token included) go in this
  // POST body, and the returned `cloneId` is all the progress stream's URL
  // carries — URLs land in access logs, proxy logs and browser history.
  startProjectClone: (cloneRequest: {
    path: string;
    githubUrl: string;
    githubTokenId: number | null;
    newGithubToken: string | null;
  }) => post('/api/projects/clone', cloneRequest),
  // EventSource cannot send an Authorization header, so the token rides along as
  // a query parameter on the streaming endpoints below.
  cloneProjectProgressUrl: ({ cloneId }: { cloneId: string }) =>
    `/api/projects/clone-progress${query({ cloneId, token: getStoredAuthToken() })}`,
  searchConversationsUrl: (searchQuery: string, limit = 50) =>
    `/api/providers/search/sessions${query({
      q: searchQuery,
      limit,
      token: getStoredAuthToken(),
    })}`,

  // Session endpoints. Provider/project metadata are resolved by the backend
  // from the session id.
  // Session deletion mirrors project deletion:
  // - default: archive only (`isArchived = 1`)
  // - hardDelete: remove the row and, by default, its persisted transcript file
  deleteSession: (sessionId: string, hardDelete = false) =>
    del(`/api/providers/sessions/${sessionId}${query({ force: hardDelete })}`),
  getArchivedSessions: () => get('/api/providers/sessions/archived'),
  // Resolves one session (by app id or provider-native id) to its metadata and
  // owning project — used when a /session/<id> URL isn't in loaded payloads.
  sessionDetails: (sessionId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}`),
  runningSessions: () => get('/api/providers/sessions/running'),
  recentConversations: ({ limit = 40, offset = 0 }: { limit?: number; offset?: number } = {}) =>
    get(`/api/providers/sessions/recent${query({ limit, offset })}`),
  providerSessionId: (sessionId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/provider-id`),
  restoreSession: (sessionId: string) => post(`/api/providers/sessions/${sessionId}/restore`),
  // Creates an independent session holding this one's conversation up to
  // `upToAnchorId` (all of it when omitted). The source is left untouched.
  forkSession: (sessionId: string, body: { upToAnchorId?: string; title?: string } = {}) =>
    post(`/api/providers/sessions/${encodeURIComponent(sessionId)}/fork`, body),
  renameSession: (sessionId: string, summary: string) =>
    put(`/api/providers/sessions/${sessionId}`, { summary }),
  // Pins or unpins a session so it sorts ahead of unpinned ones in the sidebar.
  setSessionPinned: (sessionId: string, isPinned: boolean) =>
    put(`/api/providers/sessions/${encodeURIComponent(sessionId)}/pinned`, { isPinned }),
  // Files a session under another (or clears the link with null) so the
  // sidebar can nest it. Server-enforced: same project, one level deep.
  setSessionParent: (sessionId: string, parentSessionId: string | null) =>
    put(`/api/providers/sessions/${encodeURIComponent(sessionId)}/parent`, { parentSessionId }),
  // Permanently removes a whole batch of archived sessions at once.
  permanentlyDeleteArchivedSessions: (sessionIds: string[]) =>
    del('/api/providers/sessions/archived', { sessionIds }),
  // What one agent of a workflow run did, read from its transcript on demand
  // when its row in the workflow card is opened.
  workflowAgentActivity: (sessionId: string, runId: string, agentId: string) =>
    get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}`),

  // Scheduled messages: send a message to a session at a future time.
  scheduledMessages: {
    list: (sessionId?: string) =>
      get(`/api/scheduled-messages${sessionId ? query({ sessionId }) : ''}`),
    create: (body: { sessionId: string; content: string; scheduledFor: string; options?: unknown }) =>
      post('/api/scheduled-messages', body),
    cancel: (id: string) => del(`/api/scheduled-messages/${encodeURIComponent(id)}`),
  },

  // Workspace file tree
  readFile: (projectId: string, filePath: string) =>
    get(`/api/file-tree/projects/${projectId}/file${query({ filePath })}`),
  // Raw bytes for a workspace file. The endpoint requires the auth header, so
  // media call sites fetch a blob through here instead of using a bare `src`.
  readFileBlob: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
    get(fileContentPath(projectId, filePath), options),
  saveFile: (projectId: string, filePath: string, content: string) =>
    put(`/api/file-tree/projects/${projectId}/file`, { filePath, content }),
  getFiles: (projectId: string, options: ApiRequestOptions = {}) =>
    get(`/api/file-tree/projects/${projectId}/files${query({ respectGitignore: true })}`, options),

  // File operations
  createFile: (
    projectId: string,
    { path, type, name }: { path: string; type: string; name: string },
  ) => post(`/api/file-tree/projects/${projectId}/files/create`, { path, type, name }),

  renameFile: (projectId: string, { oldPath, newName }: { oldPath: string; newName: string }) =>
    put(`/api/file-tree/projects/${projectId}/files/rename`, { oldPath, newName }),

  deleteFile: (projectId: string, { path, type }: { path: string; type: string }) =>
    del(`/api/file-tree/projects/${projectId}/files`, { path, type }),

  // Uploads with a progress bar go through XMLHttpRequest, which needs the URL.
  uploadFilesUrl: (projectId: string) =>
    `/api/file-tree/projects/${encodeURIComponent(projectId)}/files/upload`,

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath: string | null = null) =>
    get(`/api/file-tree/browse-filesystem${query({ path: dirPath })}`),

  createFolder: (folderPath: string) => post('/api/file-tree/create-folder', { path: folderPath }),

  // Git endpoints. The `project` param carries the DB projectId post-migration.
  git: {
    status: (projectId: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/status${query({ project: projectId })}`, options),
    diff: (projectId: string, filePath: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/diff${query({ project: projectId, file: filePath })}`, options),
    commitDiff: (projectId: string, commit: string) =>
      get(`/api/git/commit-diff${query({ project: projectId, commit })}`),
    fileWithDiff: (projectId: string, filePath: string) =>
      get(`/api/git/file-with-diff${query({ project: projectId, file: filePath })}`),
    branches: (projectId: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/branches${query({ project: projectId })}`, options),
    branchDiff: (projectId: string, base: string, options: ApiRequestOptions = {}) =>
      get(`/api/git/branch-diff${query({ project: projectId, base })}`, options),
    // `oldPath` is the pre-rename path of a renamed file so the server can diff the rename itself.
    branchDiffFile: (
      projectId: string,
      base: string,
      filePath: string,
      oldPath?: string,
      options: ApiRequestOptions = {},
    ) => get(`/api/git/branch-diff/file${query({ project: projectId, base, file: filePath, oldPath })}`, options),
    remoteStatus: (projectId: string) =>
      get(`/api/git/remote-status${query({ project: projectId })}`),
    commits: (
      projectId: string,
      { limit }: { limit?: number } = {},
      options: ApiRequestOptions = {},
    ) => get(`/api/git/commits${query({ project: projectId, limit })}`, options),
    checkout: (projectId: string, branch: string) =>
      post('/api/git/checkout', { project: projectId, branch }),
    createBranch: (projectId: string, branch: string) =>
      post('/api/git/create-branch', { project: projectId, branch }),
    deleteBranch: (projectId: string, branch: string, force = false) =>
      post('/api/git/delete-branch', { project: projectId, branch, force }),
    fetch: (projectId: string) => post('/api/git/fetch', { project: projectId }),
    pull: (projectId: string) => post('/api/git/pull', { project: projectId }),
    push: (projectId: string) => post('/api/git/push', { project: projectId }),
    publish: (projectId: string, branch: string) =>
      post('/api/git/publish', { project: projectId, branch }),
    discard: (projectId: string, file: string) =>
      post('/api/git/discard', { project: projectId, file }),
    deleteUntracked: (projectId: string, file: string) =>
      post('/api/git/delete-untracked', { project: projectId, file }),
    stage: (projectId: string, files: string[]) =>
      post('/api/git/stage', { project: projectId, files }),
    unstage: (projectId: string, files: string[]) =>
      post('/api/git/unstage', { project: projectId, files }),
    commit: (projectId: string, message: string, files: string[]) =>
      post('/api/git/commit', { project: projectId, message, files }),
    initialCommit: (projectId: string) => post('/api/git/initial-commit', { project: projectId }),
    init: (projectId: string) => post('/api/git/init', { project: projectId }),
    revertLocalCommit: (projectId: string) =>
      post('/api/git/revert-local-commit', { project: projectId }),
    generateCommitMessage: (projectId: string, files: string[], provider: string) =>
      post('/api/git/generate-commit-message', { project: projectId, files, provider }),
  },

  worktrees: {
    list: (projectId: string) => get(`/api/worktrees${query({ project: projectId })}`),
    create: (
      projectId: string,
      { branch, baseBranch }: { branch: string; baseBranch: string | null },
    ) => post('/api/worktrees/create', { project: projectId, branch, baseBranch }),
    open: (projectId: string, worktreePath: string) =>
      post('/api/worktrees/open', { project: projectId, worktreePath }),
    merge: (
      projectId: string,
      worktreePath: string,
      options: { squash?: boolean; message?: string; removeAfterMerge?: boolean },
    ) => post('/api/worktrees/merge', { project: projectId, worktreePath, ...options }),
    remove: (
      projectId: string,
      worktreePath: string,
      options: { force?: boolean; deleteBranch?: boolean },
    ) => post('/api/worktrees/remove', { project: projectId, worktreePath, ...options }),
  },

  // Provider (coding agent) endpoints — models, capabilities, sessions, MCP, skills.
  providers: {
    capabilities: () => get('/api/providers/capabilities'),
    available: () => get('/api/providers/available'),
    authStatus: (provider: string) =>
      get(`/api/providers/${encodeURIComponent(provider)}/auth/status`),
    quota: (provider: string) =>
      get(`/api/providers/${encodeURIComponent(provider)}/quota`),
    claudeSettingsPermissions: () => get('/api/providers/claude/settings-permissions'),

    models: (provider: string) => get(`/api/providers/${provider}/models`),
    createModel: (provider: string, input: unknown) =>
      post(`/api/providers/${provider}/models`, input),
    updateModel: (provider: string, recordId: string | number, input: unknown) =>
      patch(`/api/providers/${provider}/models/${recordId}`, input),
    deleteModel: (provider: string, recordId: string | number) =>
      del(`/api/providers/${provider}/models/${recordId}`),

    createSession: (payload: {
      provider: string;
      projectPath: string;
      initialMessage?: unknown;
    }) => post('/api/providers/sessions', payload),
    sessionMessages: (
      sessionId: string,
      pagination: SessionMessagesRequestOptions = {},
      options: ApiRequestOptions = {},
    ) => get(sessionMessagesUrl(sessionId, pagination), options),
    sessionOutline: (sessionId: string) =>
      get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/outline`),
    sessionTokenUsage: (sessionId: string) =>
      get(`/api/providers/sessions/${encodeURIComponent(sessionId)}/token-usage`),
    sessionActiveModel: (provider: string, sessionId: string) =>
      get(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-model`),
    setSessionActiveModel: (provider: string, sessionId: string, model: string) =>
      post(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-model`, {
        model,
      }),
    setSessionActiveEffort: (provider: string, sessionId: string, effort: string) =>
      post(`/api/providers/${provider}/sessions/${encodeURIComponent(sessionId)}/active-effort`, {
        effort,
      }),

    mcpServers: (
      provider: string,
      { scope, workspacePath }: { scope: string; workspacePath?: string },
    ) => get(`/api/providers/${provider}/mcp/servers${query({ scope, workspacePath })}`),
    saveMcpServer: (provider: string, payload: unknown) =>
      post(`/api/providers/${provider}/mcp/servers`, payload),
    deleteMcpServer: (
      provider: string,
      serverName: string,
      { scope, workspacePath }: { scope: string; workspacePath?: string },
    ) =>
      del(
        `/api/providers/${provider}/mcp/servers/${encodeURIComponent(serverName)}${query({ scope, workspacePath })}`,
      ),
    saveGlobalMcpServer: (payload: unknown) => post('/api/providers/mcp/servers/global', payload),
    // Probes an http/sse endpoint with a JSON-RPC handshake before saving.
    testMcpServer: (payload: McpTestConnectionInput) =>
      post('/api/providers/mcp/test', payload),

    // App-side MCP catalog (user-scope SSOT) that the MCP matrix reads and edits.
    mcpCatalog: () => get('/api/providers/mcp/catalog'),
    // Creates the entry when the payload carries no `id`, updates it otherwise.
    mcpCatalogUpsert: (payload: unknown) => post('/api/providers/mcp/catalog', payload),
    mcpCatalogToggle: (entryId: string, payload: { provider: string; enabled: boolean }) =>
      post(`/api/providers/mcp/catalog/${encodeURIComponent(entryId)}/toggle`, payload),
    mcpCatalogDelete: (entryId: string) =>
      del(`/api/providers/mcp/catalog/${encodeURIComponent(entryId)}`),
    // Escape hatch: re-applies every entry from its switches when a projection
    // failed and no cell-level retry is left to press.
    mcpCatalogResync: () => post('/api/providers/mcp/catalog/resync', {}),

    skills: (provider: string, { workspacePath }: { workspacePath?: string } = {}) =>
      get(`/api/providers/${encodeURIComponent(provider)}/skills${query({ workspacePath })}`),
    saveSkills: (provider: string, payload: unknown) =>
      post(`/api/providers/${provider}/skills`, payload),

    // Provider-level custom settings source (claude --settings equivalent).
    settingsSource: (provider: string) =>
      get(`/api/providers/${encodeURIComponent(provider)}/settings-source`),
    updateSettingsSource: (
      provider: string,
      input: { directory?: string; activeFile?: string },
    ) => put(`/api/providers/${encodeURIComponent(provider)}/settings-source`, input),
  },

  // Global network proxy shared by CloudCLI and every agent CLI it spawns.
  network: {
    proxy: () => get('/api/network/proxy'),
    updateProxy: (input: { proxyUrl: string }) => put('/api/network/proxy', input),
  },

  // Slash commands
  commands: {
    // `projectPath` stays optional: a workspace without a resolved path omits
    // the field entirely, which is what the server expects.
    list: (projectPath: string | undefined) => post('/api/commands/list', { projectPath }),
    execute: (payload: unknown) => post('/api/commands/execute', payload),
  },

  // Chat attachments, stored globally under ~/.cloudcli/assets
  assets: {
    uploadFiles: (formData: FormData) =>
      authenticatedFetch('/api/assets/files', {
        method: 'POST',
        headers: {}, // Let browser set Content-Type for FormData
        body: formData,
      }),
    file: (storedName: string) => get(`/api/assets/files/${encodeURIComponent(storedName)}`),
    image: (filename: string, options: ApiRequestOptions = {}) =>
      get(`/api/assets/images/${encodeURIComponent(filename)}`, options),
  },

  // User themes, stored globally under ~/.cloudcli/themes and served read-only.
  themes: {
    list: () => get('/api/themes'),
    // `version` is the file's mtime. The route sends `Cache-Control: no-store`
    // and the server resolves the path per request, so this is not what makes a
    // refresh see an edited file — it keeps a proxy or an intermediate cache
    // from serving one over it, and it names the exact revision in a request log.
    file: (fileName: string, version: number) =>
      get(`/api/themes/${encodeURIComponent(fileName)}${query({ v: version })}`),
  },

  // TaskMaster endpoints — all addressed by DB projectId post-migration.
  taskmaster: {
    // Update a task
    updateTask: (projectId: string, taskId: string | number, updates: unknown) =>
      put(`/api/taskmaster/update-task/${projectId}/${taskId}`, updates),

    tasks: (projectId: string) => get(`/api/taskmaster/tasks/${encodeURIComponent(projectId)}`),
    mcpStatus: () => get('/api/taskmaster/mcp-status'),
    installationStatus: () => get('/api/taskmaster/installation-status'),

    prdFiles: (projectId: string) => get(`/api/taskmaster/prd/${encodeURIComponent(projectId)}`),
    prdFile: (projectId: string, fileName: string) =>
      get(`/api/taskmaster/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}`),
    savePrd: (projectId: string, { fileName, content }: { fileName: string; content: string }) =>
      post(`/api/taskmaster/prd/${encodeURIComponent(projectId)}`, { fileName, content }),
  },

  // User endpoints
  user: {
    gitConfig: () => get('/api/user/git-config'),
    updateGitConfig: (gitName: string, gitEmail: string) =>
      post('/api/user/git-config', { gitName, gitEmail }),
    onboardingStatus: () => get('/api/user/onboarding-status'),
    completeOnboarding: () => post('/api/user/complete-onboarding'),

    // Preferences and chat drafts live server-side so they follow the user
    // from one device to another. `savePreferences` is a merge-patch: only the
    // keys it is given are written.
    preferences: () => get('/api/user/preferences'),
    savePreferences: (updates: Record<string, unknown>) =>
      patch('/api/user/preferences', updates),
    drafts: () => get('/api/user/drafts'),
    saveDraft: (scope: string, draft: { text: string; queuedMessage?: unknown }) =>
      put('/api/user/drafts', { scope, ...draft }),
    deleteDraft: (scope: string) => del('/api/user/drafts', { scope }),
    // Read watermarks: one row per (user, session), so they survive a reload
    // and follow the user to another device. `lastSeenAt` is a content
    // timestamp the client read from the server, never the local clock.
    readState: () => get('/api/user/read-state'),
    saveReadState: (sessionId: string, lastSeenAt: string) =>
      put('/api/user/read-state', { sessionId, lastSeenAt }),
    deleteReadState: (sessionId: string) => del('/api/user/read-state', { sessionId }),
  },

  // Server-side settings: API keys, stored credentials, notifications, web push
  settings: {
    apiKeys: () => get('/api/settings/api-keys'),
    createApiKey: (keyName: string) => post('/api/settings/api-keys', { keyName }),
    deleteApiKey: (keyId: string) => del(`/api/settings/api-keys/${keyId}`),
    toggleApiKey: (keyId: string, isActive: boolean) =>
      patch(`/api/settings/api-keys/${keyId}/toggle`, { isActive }),

    credentials: (type: string) => get(`/api/settings/credentials${query({ type })}`),
    createCredential: (payload: {
      credentialName: string;
      credentialType: string;
      credentialValue: string;
      description?: string;
    }) => post('/api/settings/credentials', payload),
    deleteCredential: (credentialId: string) => del(`/api/settings/credentials/${credentialId}`),
    toggleCredential: (credentialId: string, isActive: boolean) =>
      patch(`/api/settings/credentials/${credentialId}/toggle`, { isActive }),

    notificationPreferences: () => get('/api/settings/notification-preferences'),
    saveNotificationPreferences: (preferences: unknown) =>
      put('/api/settings/notification-preferences', preferences),

    push: {
      vapidPublicKey: () => get('/api/settings/push/vapid-public-key'),
      subscribe: (subscription: { endpoint?: string; keys?: unknown }) =>
        post('/api/settings/push/subscribe', subscription),
      unsubscribe: (endpoint: string) => post('/api/settings/push/unsubscribe', { endpoint }),
    },

    // Login audit trail (login/logout/register events).
    authEvents: (params: {
      limit?: number;
      offset?: number;
      eventType?: string;
      username?: string;
      ip?: string;
    }) => get(`/api/settings/auth-events${query(params)}`),
  },

  plugins: {
    list: () => get('/api/plugins'),
    install: (url: string) => post('/api/plugins/install', { url }),
    uninstall: (name: string) => del(`/api/plugins/${encodeURIComponent(name)}`),
    update: (name: string) => post(`/api/plugins/${encodeURIComponent(name)}/update`),
    toggle: (name: string, enabled: boolean) =>
      put(`/api/plugins/${encodeURIComponent(name)}/enable`, { enabled }),
    // Plugin bundles/icons are fetched with auth headers and handed to the
    // browser as blobs, so a bare asset URL is never requested unauthenticated.
    asset: (pluginName: string, assetFile: string) => get(pluginAssetPath(pluginName, assetFile)),
    // Exposed so the icon cache can key on the resolved asset path.
    assetUrl: pluginAssetPath,
    rpc: (pluginName: string, method: string, path: string, body?: unknown) =>
      authenticatedFetch(
        `/api/plugins/${encodeURIComponent(pluginName)}/rpc/${String(path).replace(/^\//, '')}`,
        {
          method: method || 'GET',
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
      ),
  },

  browserUse: {
    status: () => get('/api/browser-use/status'),
    settings: () => get('/api/browser-use/settings'),
    saveSettings: (settings: unknown) => put('/api/browser-use/settings', settings),
    sessions: () => get('/api/browser-use/sessions'),
    stopSession: (sessionId: string) => post(`/api/browser-use/sessions/${sessionId}/stop`),
    deleteSession: (sessionId: string) => del(`/api/browser-use/sessions/${sessionId}`),
    installRuntime: () => post('/api/browser-use/runtime/install'),
  },

  voice: {
    health: () => get('/api/voice/health'),
    transcribe: (formData: FormData, headers: Record<string, string> = {}) =>
      authenticatedFetch('/api/voice/transcribe', {
        method: 'POST',
        headers,
        body: formData,
      }),
    tts: (text: string, options: ApiRequestOptions = {}) => post('/api/voice/tts', { text }, options),
  },

  system: {
    update: () => post('/api/system/update'),
  },
};

// ---------------------------

//----------------- VOICE TRANSCRIPTION AND SPEECH ------------

// MiMo (Xiaomi) serves speech through the OpenAI *chat* surface
// (`POST {baseUrl}/chat/completions`) instead of the OpenAI *audio* endpoints this
// module otherwise targets, so a MiMo base URL needs a different request and
// response shape on both paths. MiMo also accepts only wav/mp3 audio while
// browsers record webm/opus (Chrome) or mp4/aac (iOS), so recordings must be
// transcoded to wav before transcription.
const MIMO_VOICE_HOST = 'xiaomimimo.com';
const MIMO_STT_MODEL = 'mimo-v2.5-asr';
const MIMO_TTS_MODEL = 'mimo-v2.5-tts';
const MIMO_TTS_VOICE = 'mimo_default';
// The MiMo output formats an <audio> element can play back directly.
const MIMO_TTS_FORMATS = new Set(['wav', 'mp3']);

/**
 * True when the configured voice endpoint is Xiaomi MiMo, whose audio API is
 * chat-shaped rather than OpenAI-audio-shaped. Private to the voice helpers below.
 */
function isMimoVoiceBackend(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === MIMO_VOICE_HOST || host.endsWith(`.${MIMO_VOICE_HOST}`);
  } catch {
    return false;
  }
}

/** Encodes PCM channels as 16-bit little-endian WAV bytes. Private to {@link toWavBytes}. */
function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const frameCount = channels[0]?.length ?? 0;
  const channelCount = channels.length || 1;
  const blockAlign = channelCount * 2;
  const dataSize = frameCount * blockAlign;
  const view = new DataView(new ArrayBuffer(44 + dataSize));

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // linear PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Uint8Array(view.buffer);
}

/**
 * Decodes a browser recording (webm/opus, mp4/aac, ogg) into WAV bytes, because
 * MiMo's transcription endpoint rejects those containers. Private to
 * {@link transcribeVoice}, which invokes it only on the MiMo path.
 */
async function toWavBytes(recording: Blob): Promise<Uint8Array> {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      channels.push(decoded.getChannelData(channel));
    }
    return encodeWav(channels, decoded.sampleRate);
  } finally {
    void context.close();
  }
}

/** Base64-encodes bytes without assuming a browser Buffer polyfill. */
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Decodes the base64 audio MiMo returns in its chat response into raw bytes. */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Reshapes MiMo's chat transcription response into the `{ text }` JSON body the
 * dictation caller reads. Private to {@link transcribeVoice}.
 */
async function readMimoTranscript(upstream: Response): Promise<Response> {
  const raw = await upstream.text();
  if (!upstream.ok) {
    return new Response(raw, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let text = '';
  try {
    const content = JSON.parse(raw)?.choices?.[0]?.message?.content;
    if (typeof content === 'string') text = content;
  } catch {
    /* Non-JSON body: return an empty transcript and let the caller report it. */
  }
  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Unwraps the base64 audio in MiMo's chat response into an audio Response the
 * player reads as a blob. Private to {@link synthesizeVoice}.
 */
async function readMimoSpeech(upstream: Response, format: string): Promise<Response> {
  const raw = await upstream.text();
  if (!upstream.ok) {
    return new Response(raw, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let encoded = '';
  try {
    const data = JSON.parse(raw)?.choices?.[0]?.message?.audio?.data;
    if (typeof data === 'string') encoded = data;
  } catch {
    /* handled by the empty-audio branch below */
  }
  if (!encoded) {
    return new Response(JSON.stringify({ error: 'Voice backend returned no audio.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(base64ToArrayBuffer(encoded), {
    status: 200,
    headers: { 'Content-Type': format === 'wav' ? 'audio/wav' : 'audio/mpeg' },
  });
}

/**
 * Builds a URL against the user's own voice endpoint. Private to the voice
 * helpers below, which bypass the CloudCLI proxy when a base URL is configured.
 */
function voiceDirectUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * Serializes the active voice configuration so callers can detect a settings change and
 * drop cached synthesized audio.
 */
export function voiceConfigSignature(): string {
  return JSON.stringify(readVoiceConfig());
}

/**
 * Transcribes recorded audio, posting directly to the user's configured endpoint when one
 * is set and otherwise going through the CloudCLI voice proxy. A MiMo endpoint is
 * addressed through its chat API with the recording converted to wav.
 */
export async function transcribeVoice(blob: Blob, filename: string): Promise<Response> {
  const config = readVoiceConfig();
  const baseUrl = config.baseUrl.trim();

  if (baseUrl && isMimoVoiceBackend(baseUrl)) {
    const audio = bytesToBase64(await toWavBytes(blob));
    return readMimoTranscript(
      await fetch(voiceDirectUrl(baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.sttModel || MIMO_STT_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${audio}` } },
              ],
            },
          ],
          asr_options: { language: 'auto' },
        }),
      }),
    );
  }

  const body = new FormData();
  if (baseUrl) {
    body.append('file', blob, filename);
    body.append('model', config.sttModel || 'whisper-1');
    return fetch(voiceDirectUrl(baseUrl, '/audio/transcriptions'), {
      method: 'POST',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      body,
    });
  }

  body.append('audio', blob, filename);
  return api.voice.transcribe(body, voiceConfigHeaders());
}

/**
 * Synthesizes speech for the given text, using the user's configured endpoint when one is
 * set and otherwise the CloudCLI voice proxy. A MiMo endpoint is addressed through its
 * chat API and its base64 audio response is unwrapped into an audio stream.
 */
export async function synthesizeVoice(text: string, signal: AbortSignal): Promise<Response> {
  const config = readVoiceConfig();
  const baseUrl = config.baseUrl.trim();

  if (baseUrl && isMimoVoiceBackend(baseUrl)) {
    const requested = config.ttsFormat.trim().toLowerCase();
    const format = MIMO_TTS_FORMATS.has(requested) ? requested : 'mp3';
    return readMimoSpeech(
      await fetch(voiceDirectUrl(baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.ttsModel || MIMO_TTS_MODEL,
          messages: [{ role: 'assistant', content: text }],
          audio: { format, voice: config.ttsVoice || MIMO_TTS_VOICE },
        }),
        signal,
      }),
      format,
    );
  }

  if (baseUrl) {
    return fetch(voiceDirectUrl(baseUrl, '/audio/speech'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.ttsModel || 'tts-1',
        voice: config.ttsVoice || 'alloy',
        input: text,
        ...(config.ttsFormat.trim() ? { response_format: config.ttsFormat.trim() } : {}),
      }),
      signal,
    });
  }

  return api.voice.tts(text, { headers: voiceConfigHeaders(), signal });
}
