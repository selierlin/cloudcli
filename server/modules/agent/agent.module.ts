import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';

import { Octokit } from '@octokit/rest';
import spawn from 'cross-spawn';

import {
  apiKeysDb,
  authEventsDb,
  githubTokensDb,
  projectsDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import { providerModelsService, sessionsService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';
import { IS_PLATFORM } from '@/shared/utils.js';

import { createAgentRouter } from './agent.routes.js';

type AgentExternalDependencies = Pick<
  Parameters<typeof createAgentRouter>[0],
  'queryClaude' | 'queryCursor' | 'queryCodex' | 'queryOpenCode' | 'queryDsh' | 'queryWorkbuddy' | 'queryPi' | 'queryZcode' | 'queryOmp' | 'queryOpenclaw'
>;

/**
 * Assembles the production Agent router while accepting provider runners from
 * the centralized provider runtime service.
 */
export function createAgentModule(externalDependencies: AgentExternalDependencies) {
  // Rejected agent handshakes are audited like login failures. Platform mode does
  // no key check (agent.routes.ts short-circuits before validation), so the sink
  // is a no-op there — mirroring how Auth injects its audit dependency.
  const audit = IS_PLATFORM
    ? { record: () => {} }
    : { record: (event: Parameters<typeof authEventsDb.record>[0]) => authEventsDb.record(event) };

  return createAgentRouter({
    fileSystem: fs,
    crypto,
    homeDirectory: os.homedir,
    spawnProcess: spawn,
    platformMode: IS_PLATFORM,
    users: {
      getFirstUser: () => userDb.getFirstUser(),
    },
    apiKeys: {
      validateApiKey: (apiKey) => apiKeysDb.validateApiKey(apiKey),
    },
    githubTokens: {
      getActiveGithubToken: (userId) => githubTokensDb.getActiveGithubToken(userId),
    },
    projects: {
      createProjectPath: (projectPath, customName) =>
        projectsDb.createProjectPath(projectPath, customName),
    },
    models: providerModelsService,
    sessions: {
      getSessionById: (sessionId) => sessionsDb.getSessionById(sessionId),
      getSessionByProviderSessionId: (providerSessionId) => sessionsDb.getSessionByProviderSessionId(providerSessionId),
      createAppSession: (provider, projectPath, initialMessage) =>
        sessionsService.createAppSession(provider as LLMProvider, projectPath, initialMessage),
    },
    runs: chatRunRegistry,
    GithubClient: Octokit,
    audit,
    ...externalDependencies,
  });
}
