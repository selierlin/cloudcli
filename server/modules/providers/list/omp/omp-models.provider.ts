import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

import { getOmpCommand } from './omp-auth.provider.js';

/**
 * Last-resort OMP catalog. The authoritative catalog is the user's own
 * configuration, which `omp models --json` renders; this tiny mirror keeps the
 * picker non-empty when that command cannot run at all (a CLI too old for
 * `models --json`, for example).
 */
export const OMP_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'deepseek/deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      description: 'Fast and affordable DeepSeek coding model.',
    },
    {
      value: 'deepseek/deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
      description: 'Frontier DeepSeek model for complex coding and research.',
    },
  ],
  DEFAULT: 'deepseek/deepseek-v4-pro',
};

/**
 * Agent state directory OMP reads and writes (`~/.omp/agent` by default).
 *
 * `OMP_PROFILE` outranks `PI_CODING_AGENT_DIR`: a named profile relocates the
 * whole agent directory under `~/.omp/profiles/<name>/agent`, so it has to be
 * resolved before the generic override.
 */
export const getOmpAgentDir = (): string => {
  const profile = process.env.OMP_PROFILE?.trim();
  if (profile) {
    return path.join(os.homedir(), '.omp', 'profiles', profile, 'agent');
  }

  return process.env.PI_CODING_AGENT_DIR?.trim()
    || path.join(os.homedir(), '.omp', 'agent');
};

/**
 * Root where OMP persists sessions (`<agentDir>/sessions` by default), matching
 * what the CLI itself writes so the synchronizer, history, and watcher read the
 * same files.
 *
 * `PI_CODING_AGENT_SESSION_DIR` is OMP's own session-dir override. When it is
 * set OMP writes transcripts *flat* into that directory instead of nesting them
 * under a `--<encoded-cwd>--` folder, which the readers below already tolerate.
 * OMP keeps no session directory in its config document, so there is no
 * `config.yml` source to consult. `--session-dir` is a per-run CLI flag that
 * this process never passes and cannot observe, so it is left out.
 */
export const getOmpSessionsRoot = (): string => {
  const override = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (override) {
    return override;
  }

  return path.join(getOmpAgentDir(), 'sessions');
};

/** Reasoning levels OMP reports per reasoning-capable model. */
type OmpThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type OmpModelEntry = {
  provider?: unknown;
  id?: unknown;
  selector?: unknown;
  name?: unknown;
  reasoning?: unknown;
  thinking?: unknown;
};

const MODEL_CATALOG_TTL_MS = 60_000;
const MODEL_CATALOG_TIMEOUT_MS = 10_000;

let catalogCache: { entries: OmpModelEntry[]; readAt: number } | null = null;

/** Drops the cached catalog (used by tests to force a re-read). */
export function resetOmpModelsForTests(): void {
  catalogCache = null;
}

/**
 * Reads OMP's model catalog by running `omp models --json`.
 *
 * The catalog is assembled by the CLI from the user's providers rather than
 * kept in a document this process could parse, so it can only be read through
 * the CLI. The result is cached because the command costs roughly half a second
 * while the model routes are polled on every picker render.
 */
export async function loadOmpModels(): Promise<OmpModelEntry[] | null> {
  if (catalogCache && Date.now() - catalogCache.readAt < MODEL_CATALOG_TTL_MS) {
    return catalogCache.entries;
  }

  const entries = await new Promise<OmpModelEntry[] | null>((resolve) => {
    execFile(
      getOmpCommand(),
      ['models', '--json'],
      { timeout: MODEL_CATALOG_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error && !stdout) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as { models?: unknown };
          resolve(Array.isArray(parsed.models) ? (parsed.models as OmpModelEntry[]) : null);
        } catch {
          resolve(null);
        }
      },
    );
  });

  if (!entries || entries.length === 0) {
    return null;
  }

  catalogCache = { entries, readAt: Date.now() };
  return entries;
}

/** Maps the CLI's per-model `thinking` levels onto the shared effort picker. */
const buildEffort = (thinking: unknown): ProviderModelOption['effort'] | undefined => {
  if (!Array.isArray(thinking) || thinking.length === 0) {
    return undefined;
  }
  const values = thinking
    .filter((level): level is OmpThinkingLevel => (
      level === 'minimal'
      || level === 'low'
      || level === 'medium'
      || level === 'high'
      || level === 'xhigh'
      || level === 'max'
    ))
    .map((level) => ({ value: level }));
  return values.length > 0 ? { values } : undefined;
};

/**
 * Converts the CLI catalog into the picker definition. `selector` is the
 * `<provider>/<model>` value the runtime passes to `--model`, and `provider`
 * groups same-named models across channels.
 */
function toOmpModelsDefinition(entries: OmpModelEntry[]): ProviderModelsDefinition | null {
  const options: ProviderModelOption[] = [];
  for (const entry of entries) {
    const value = typeof entry.selector === 'string' ? entry.selector.trim() : '';
    if (!value) {
      continue;
    }
    const provider = typeof entry.provider === 'string' ? entry.provider.trim() : '';
    const name = typeof entry.name === 'string' && entry.name.trim()
      ? entry.name.trim()
      : value;
    const effort = entry.reasoning === true ? buildEffort(entry.thinking) : undefined;
    options.push({
      value,
      label: name,
      ...(provider ? { group: provider } : {}),
      ...(effort ? { effort } : {}),
    });
  }

  if (options.length === 0) {
    return null;
  }

  return { OPTIONS: options, DEFAULT: options[0].value };
}

/** Provider registry model adapter for OMP models from the CLI catalog. */
export class OmpProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const entries = await loadOmpModels();
    const catalog = (entries ? toOmpModelsDefinition(entries) : null) ?? OMP_PREDEFINED_MODELS;

    // `OMP_MODEL` overrides the picker default, keeping the env escape hatch
    // aligned with what the CLI runs when no model is selected in the app.
    const configuredModel = process.env.OMP_MODEL?.trim();
    if (!configuredModel) {
      return catalog;
    }

    const separatorIndex = configuredModel.indexOf('/');
    const configuredChannel = separatorIndex > 0 ? configuredModel.slice(0, separatorIndex) : '';
    return {
      OPTIONS: catalog.OPTIONS.some((option) => option.value === configuredModel)
        ? catalog.OPTIONS
        : [
            {
              value: configuredModel,
              label: configuredModel,
              ...(configuredChannel ? { group: configuredChannel } : {}),
            },
            ...catalog.OPTIONS,
          ],
      DEFAULT: configuredModel,
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
