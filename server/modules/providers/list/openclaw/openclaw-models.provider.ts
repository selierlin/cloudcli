import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applySharedModelDescriptions, resolveChannelLabel } from '@/shared/model-descriptions.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
  readStringArray,
} from '@/shared/utils.js';

/**
 * Curated OpenClaw fallback catalog.
 *
 * OpenClaw resolves its model layer from `~/.openclaw/openclaw.json`
 * (`models.providers.<id>.models`), so the real catalog is read from that
 * document — see {@link loadOpenclawModels}. This tiny mirror only keeps the
 * picker usable when the document is missing or declares no model, and it
 * matches what a stock OpenClaw install ships.
 */
export const OPENCLAW_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'openclaw/default',
      label: 'OpenClaw default',
      description: 'Placeholder until OpenClaw declares a provider model.',
    },
  ],
  DEFAULT: 'openclaw/default',
};

let homeDirOverride: string | null = null;

/**
 * Points OpenClaw's state root at a caller-supplied directory (tests only).
 * Pass `null` to restore `$OPENCLAW_STATE_DIR` / `~/.openclaw`.
 */
export function setOpenclawHomeDirForTests(dir: string | null): void {
  homeDirOverride = dir;
}

/**
 * OpenClaw's state root that holds `openclaw.json`, the per-agent session
 * databases, skills and credentials.
 *
 * `OPENCLAW_STATE_DIR` overrides it (OpenClaw's own `--profile` isolation
 * writes that variable); otherwise it is `~/.openclaw`. Consumed by the
 * sessions reader, the synchronizer, the MCP adapter and the watcher so every
 * facet resolves the same root.
 */
export function getOpenclawHomeDir(): string {
  const envDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (homeDirOverride) {
    return homeDirOverride;
  }
  return envDir ? envDir : path.join(os.homedir(), '.openclaw');
}

/** Path of OpenClaw's user config document (`<state root>/openclaw.json`). */
export function getOpenclawConfigPath(): string {
  return path.join(getOpenclawHomeDir(), 'openclaw.json');
}

/** Path of the state root's `agents/` directory that holds one folder per agent. */
export function getOpenclawAgentsDir(): string {
  return path.join(getOpenclawHomeDir(), 'agents');
}

/**
 * SQLite session database for one agent
 * (`<state root>/agents/<agentId>/agent/openclaw-agent.sqlite`).
 */
export function getOpenclawAgentDbPath(agentId: string): string {
  return path.join(getOpenclawAgentsDir(), agentId, 'agent', 'openclaw-agent.sqlite');
}

/**
 * Session keys OpenClaw uses are `agent:<agentId>:<key>` (e.g.
 * `agent:main:main`, `agent:main:dingtalk:group:…`). The reader and synchronizer
 * map a stored session key back to the agent whose database holds it.
 */
const OPENCLAW_SESSION_KEY_RE = /^agent:([^:]+):/;

/** Extracts the agent id from an OpenClaw session key, or `null` when unshaped. */
export function getOpenclawAgentIdFromSessionKey(sessionKey: string): string | null {
  const match = OPENCLAW_SESSION_KEY_RE.exec(sessionKey);
  return match ? match[1] : null;
}

/**
 * Reads and parses OpenClaw's user config, or `null` when missing/unreadable.
 */
export function readOpenclawConfig(): AnyRecord | null {
  try {
    return readObjectRecord(JSON.parse(fs.readFileSync(getOpenclawConfigPath(), 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Lists the agents that own a session database on this machine.
 *
 * Each `agents/<id>/` folder is one isolated agent with its own workspace,
 * auth and transcript store; only folders that actually contain
 * `agent/openclaw-agent.sqlite` are returned, so the leftover channel-only
 * folders (e.g. `default`, `__default__`) are skipped. Consumed by the
 * synchronizer and the watcher.
 */
export function getOpenclawAgentIds(): string[] {
  const agentsDir = getOpenclawAgentsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((agentId) => fs.existsSync(getOpenclawAgentDbPath(agentId)));
}

/**
 * Default agent workspace (`agents.defaults.workspace`), used as the fallback
 * project path for a session whose transcript header carries no usable `cwd`.
 */
export function getOpenclawWorkspaceDir(config: AnyRecord | null = readOpenclawConfig()): string | null {
  const agents = readObjectRecord(config?.agents);
  const defaults = readObjectRecord(agents?.defaults);
  return readOptionalString(defaults?.workspace) ?? null;
}

/**
 * The agent a fresh session key should name (`agents.entries`), so the runtime
 * can shape new keys as `agent:<id>:<key>`. Prefers an entry literally named
 * `main` (OpenClaw's stock default), otherwise the first declared entry.
 * Returns `null` when the config declares no agent.
 */
export function getOpenclawDefaultAgentId(config: AnyRecord | null = readOpenclawConfig()): string | null {
  const entries = readObjectRecord(readObjectRecord(config?.agents)?.entries);
  if (!entries) {
    return null;
  }
  const ids = Object.keys(entries);
  if (ids.length === 0) {
    return null;
  }
  return ids.includes('main') ? 'main' : ids[0]!;
}

/** The `models.providers` map of the config, or `{}` when absent. */
function readConfiguredProviders(config: AnyRecord): Record<string, unknown> {
  return readObjectRecord(readObjectRecord(config.models)?.providers) ?? {};
}

/** The configured default model (`agents.defaults.model.primary`), or null. */
function readDefaultModel(config: AnyRecord): string | null {
  const agents = readObjectRecord(config?.agents);
  const defaults = readObjectRecord(agents?.defaults);
  const model = readObjectRecord(defaults?.model);
  return readOptionalString(model?.primary) ?? null;
}

/**
 * Builds the model catalog from OpenClaw's configured providers.
 *
 * Every model declared under `models.providers.<id>.models` is offered, valued
 * `<providerId>/<modelId>` and grouped by channel so providers that share a
 * model id stay distinguishable. `DEFAULT` is `agents.defaults.model.primary`
 * (the model a bare `openclaw agent` run selects), falling back to the first
 * declared model. Returns `null` when the document yields no model so the caller
 * falls back to {@link OPENCLAW_PREDEFINED_MODELS}.
 */
export function loadOpenclawModels(): ProviderModelsDefinition | null {
  const config = readOpenclawConfig();
  if (!config) {
    return null;
  }

  const options: ProviderModelOption[] = [];
  const seen = new Set<string>();
  for (const [providerId, rawProvider] of Object.entries(readConfiguredProviders(config))) {
    const models = readObjectRecord(rawProvider)?.models;
    if (!Array.isArray(models)) {
      continue;
    }
    for (const rawModel of models) {
      const modelId = readOptionalString(readObjectRecord(rawModel)?.id);
      if (!modelId) {
        continue;
      }
      const value = `${providerId}/${modelId}`;
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      const label = readOptionalString(readObjectRecord(rawModel)?.name) ?? modelId;
      options.push({ value, label, group: resolveChannelLabel(providerId) });
    }
  }

  if (options.length === 0) {
    return null;
  }

  const configuredDefault = readDefaultModel(config);
  const defaultValue = configuredDefault && seen.has(configuredDefault)
    ? configuredDefault
    : options[0]!.value;
  return { OPTIONS: options, DEFAULT: defaultValue };
}

/**
 * Provider registry model adapter for OpenClaw's config-driven catalog.
 *
 * Consumed by `providerModelsService` (`GET /api/providers/openclaw/models` and
 * the composer's model picker).
 */
export class OpenclawProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const catalog = loadOpenclawModels() ?? OPENCLAW_PREDEFINED_MODELS;
    return { ...catalog, OPTIONS: applySharedModelDescriptions(catalog.OPTIONS) };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    // The model layer is config-driven and global (not per-session) until the
    // app records a selection on the session row, so the configured default is
    // the active model for every session the app has not seen a choice for.
    const config = readOpenclawConfig();
    const defaultModel = config ? readDefaultModel(config) : null;
    if (defaultModel) {
      return { model: defaultModel };
    }
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
