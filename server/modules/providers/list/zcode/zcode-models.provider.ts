import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  applySharedModelDescriptions,
  resolveChannelLabel,
} from '@/shared/model-descriptions.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  AppError,
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
  readStringArray,
} from '@/shared/utils.js';

/**
 * Curated ZCode fallback catalog.
 *
 * The authoritative catalog lives in the user's
 * `~/.zcode/v2/provider_config.json` (personal providers) — see
 * {@link loadZcodeModels} — and this tiny mirror keeps the picker usable when
 * that document is missing or unreadable. ZCode's own first-run defaults point
 * at Z.AI, so the fallback matches that rather than inventing a model the CLI
 * would reject.
 */
export const ZCODE_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'zai/glm-5.1',
      label: 'GLM-5.1',
      description: 'Z.AI Coding Plan default model.',
      group: 'zai',
    },
  ],
  DEFAULT: 'zai/glm-5.1',
};

/** Expands a leading `~` and resolves a config-provided path against `baseDir`. */
const resolveUserPath = (value: string, baseDir: string): string => {
  const trimmed = value.trim();
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);
};

let homeDirOverride: string | null = null;

/**
 * Points ZCode's storage root at a caller-supplied directory (tests only).
 * Pass `null` to restore `~/.zcode`.
 */
export function setZcodeHomeDirForTests(dir: string | null): void {
  homeDirOverride = dir;
}

/**
 * ZCode's storage root, which holds the CLI config, session database, and
 * skills.
 *
 * Always `~/.zcode`. `ZCODE_STORAGE_DIR` deliberately does NOT relocate this:
 * verified against ZCode 0.16.5, a headless run with `ZCODE_STORAGE_DIR` (and
 * even `ZCODE_ENV=beta`) still read `~/.zcode/cli/config.json` and wrote
 * `~/.zcode/cli/db/db.sqlite` — the override only moves auxiliary state such as
 * the plugin cache. Honoring it here would make CloudCLI read a different
 * config/database than the CLI actually uses.
 */
export function getZcodeHomeDir(): string {
  return homeDirOverride ?? path.join(os.homedir(), '.zcode');
}

/**
 * Path of the CLI's *legacy* user config (`<storage root>/cli/config.json`).
 *
 * Since ZCode 0.16.9 the CLI no longer reads this file for providers or models
 * — the model layer moved to the personal provider document plus the app's
 * bundled catalog. It is still honored for MCP servers and permissions and is
 * still where {@link ZcodeProviderAuth} checks for an api-key provider, so it
 * remains the source for those consumers.
 */
export function getZcodeConfigPath(): string {
  return path.join(getZcodeHomeDir(), 'cli', 'config.json');
}

/** Reads and parses the legacy CLI user config, or `null` when missing/unreadable/not an object. */
export function readZcodeConfig(): AnyRecord | null {
  try {
    return readObjectRecord(JSON.parse(fs.readFileSync(getZcodeConfigPath(), 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Path of the personal provider document (`<storage root>/v2/provider_config.json`).
 *
 * ZCode 0.16.9 resolves providers, models, and the default selection from this
 * file (`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` overrides its location). This is
 * the document {@link loadZcodeModels} mirrors.
 */
function getZcodeProviderConfigPath(): string {
  return path.join(getZcodeHomeDir(), 'v2', 'provider_config.json');
}

/**
 * Reads and parses the personal provider document, or `null` when
 * missing/unreadable/not an object.
 *
 * The document is `{ schemaVersion, config: { providerOrder, providerConfigRules,
 * … } }`; callers that only need the model layer should use
 * {@link readZcodeProviderConfig}, and only the run-config copy needs the whole
 * document so it can be written back verbatim.
 */
function readZcodeProviderDocument(): AnyRecord | null {
  try {
    return readObjectRecord(JSON.parse(fs.readFileSync(getZcodeProviderConfigPath(), 'utf8')));
  } catch {
    return null;
  }
}

/** The `config` object inside the personal provider document, or `null`. */
function readZcodeProviderConfig(): AnyRecord | null {
  return readObjectRecord(readZcodeProviderDocument()?.config);
}

/** Path of the desktop app's encrypted credential store (`<storage root>/v2/credentials.json`). */
function getZcodeCredentialsPath(): string {
  return path.join(getZcodeHomeDir(), 'v2', 'credentials.json');
}

/**
 * Resolves the ZCode session SQLite database.
 *
 * `storage.sessionDbPath` wins when configured (the CLI's own override),
 * otherwise the default `<storage root>/cli/db/db.sqlite` applies. `~` and
 * relative values are expanded the same way the CLI resolves them.
 */
export function getZcodeDatabasePath(config: AnyRecord | null = readZcodeConfig()): string {
  const storage = readObjectRecord(config?.storage);
  const configured = readOptionalString(storage?.sessionDbPath);
  if (configured) {
    return resolveUserPath(configured, getZcodeHomeDir());
  }
  return path.join(getZcodeHomeDir(), 'cli', 'db', 'db.sqlite');
}

//----------------- OFFICIAL ACCOUNT PROVIDER ------------

/** Provider id CloudCLI reuses when it re-exposes the official account quota. */
const ZCODE_OFFICIAL_PROVIDER_ID = 'bigmodel';

/** Anthropic-messages endpoint the coding-plan key is valid against. */
const ZCODE_OFFICIAL_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';

/** GLM models the coding plan exposes; verified runnable against the endpoint. */
const ZCODE_OFFICIAL_MODEL_IDS = ['GLM-5.3', 'GLM-5.3-Flash'];

/** One api-key provider a headless run can select from: its id and declared model ids. */
type ZcodeProviderEntry = {
  providerId: string;
  modelIds: string[];
};

/** A synthesized provider rule plus the catalog data the picker and runs need. */
type ZcodeOfficialProvider = ZcodeProviderEntry & {
  rule: AnyRecord;
};

/**
 * Derives the at-rest key ZCode uses for `~/.zcode/v2/credentials.json`.
 *
 * ZCode encrypts each credential value as `enc:v1:<iv>.<tag>.<ciphertext>`
 * (AES-256-GCM, base64url) under `sha256(ZCODE_CREDENTIAL_SECRET)`, falling
 * back to a fixed string built from the platform, home directory, and user name
 * when that variable is unset. The fallback is reproducible by any process that
 * can read the file, so this is obfuscation rather than protection; it is
 * reproduced here solely to surface the account's coding-plan key as an
 * ordinary provider. Verified against ZCode 0.16.9.
 */
function resolveZcodeCredentialSecret(): string {
  const override = process.env.ZCODE_CREDENTIAL_SECRET?.trim();
  if (override) {
    return override;
  }
  return ['zcode-credential-fallback', process.platform, os.homedir(), os.userInfo().username].join(':');
}

/** Decrypts one `enc:v1:` credential value, or returns `null` when it cannot be read. */
function decryptZcodeCredential(value: string, key: Buffer): string | null {
  if (!value.startsWith('enc:v1:')) {
    return null;
  }
  const parts = value.slice('enc:v1:'.length).split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [iv, tag, ciphertext] = parts as [string, string, string];
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Reads the account's coding-plan API key from the desktop app's credential store.
 *
 * The app writes one `...:api-key` entry per account provider. The coding-plan
 * key is the entry whose name mentions both `bigmodel` and `coding-plan`
 * (verified shape: `account-provider:coding-plan:account:bigmodel-…:api-key`);
 * requiring both keeps a same-vendor proxy or enterprise entry from being
 * picked up. Returns `null` when the file is missing, unreadable, encrypted
 * under a key we cannot reproduce, or holds no such entry, so callers omit the
 * official provider rather than showing a model that cannot run.
 */
function readZcodeCodingPlanApiKey(): string | null {
  let credentials: AnyRecord | null;
  try {
    credentials = readObjectRecord(JSON.parse(fs.readFileSync(getZcodeCredentialsPath(), 'utf8')));
  } catch {
    return null;
  }
  if (!credentials) {
    return null;
  }

  const key = crypto.createHash('sha256').update(resolveZcodeCredentialSecret()).digest();
  for (const [name, rawValue] of Object.entries(credentials)) {
    if (!name.endsWith(':api-key') || !name.includes('bigmodel') || !name.includes('coding-plan')) {
      continue;
    }
    const value = readOptionalString(rawValue);
    const plain = value ? decryptZcodeCredential(value, key) : null;
    if (plain) {
      return plain;
    }
  }
  return null;
}

/**
 * Synthesizes the official BigModel (GLM) provider as an ordinary api-key provider.
 *
 * ZCode's own account provider (`account:bigmodel-start-plan`) is unusable from
 * a standalone CLI: the desktop app resolves its entitlement and pushes it to
 * the CLI, which otherwise answers "Provider Registry 中不存在 Model". Re-exposing
 * the same coding-plan key as a plain `api-key` provider sidesteps the account
 * layer entirely — verified against 0.16.9, where both models answer on a
 * headless `--prompt` run.
 *
 * Returns `null` when the key cannot be recovered, in which case the official
 * models are simply absent from the catalog.
 */
function resolveZcodeOfficialProvider(): ZcodeOfficialProvider | null {
  const apiKey = readZcodeCodingPlanApiKey();
  if (!apiKey) {
    return null;
  }
  return {
    providerId: ZCODE_OFFICIAL_PROVIDER_ID,
    modelIds: ZCODE_OFFICIAL_MODEL_IDS,
    rule: {
      providerId: ZCODE_OFFICIAL_PROVIDER_ID,
      enabled: true,
      config: {
        group: 'standard-personal',
        visibility: 'visible',
        access: { type: 'api-key', apiKey },
        api: { type: 'anthropic-messages', baseUrl: ZCODE_OFFICIAL_BASE_URL },
        personalModelIds: ZCODE_OFFICIAL_MODEL_IDS,
      },
    },
  };
}

// ---------------------------

//----------------- PROVIDER CATALOG ------------

/** The mutable `providerRules` array of a provider document, or `[]` when absent. */
function readProviderRules(config: AnyRecord): unknown[] {
  const rules = readObjectRecord(config.providerConfigRules)?.providerRules;
  return Array.isArray(rules) ? rules : [];
}

/**
 * Lists the api-key providers a headless run can invoke, in document order.
 *
 * Hidden providers, entitlement-backed access, and providers without a
 * declared model are skipped: none of them can be started with `--prompt`.
 */
function collectZcodePersonalProviders(config: AnyRecord): ZcodeProviderEntry[] {
  const entries: ZcodeProviderEntry[] = [];
  const seen = new Set<string>();

  for (const rawRule of readProviderRules(config)) {
    const rule = readObjectRecord(rawRule);
    if (!rule || rule.enabled === false) {
      continue;
    }
    const providerId = readOptionalString(rule.providerId);
    const ruleConfig = readObjectRecord(rule.config);
    if (!providerId || !ruleConfig || seen.has(providerId)) {
      continue;
    }
    if (readOptionalString(ruleConfig.visibility) === 'hidden') {
      continue;
    }
    if (readOptionalString(readObjectRecord(ruleConfig.access)?.type) !== 'api-key') {
      continue;
    }
    const modelIds = readStringArray(ruleConfig.personalModelIds);
    if (!modelIds || modelIds.length === 0) {
      continue;
    }
    seen.add(providerId);
    entries.push({ providerId, modelIds });
  }

  return entries;
}

/** Reorders providers to follow `providerOrder`; unlisted ones keep document order after it. */
function orderZcodeProviders(config: AnyRecord, entries: ZcodeProviderEntry[]): ZcodeProviderEntry[] {
  const order = readStringArray(config.providerOrder) ?? [];
  const remaining = [...entries];
  const ordered: ZcodeProviderEntry[] = [];
  for (const providerId of order) {
    const index = remaining.findIndex((entry) => entry.providerId === providerId);
    if (index >= 0) {
      ordered.push(...remaining.splice(index, 1));
    }
  }
  return [...ordered, ...remaining];
}

/**
 * Collects every provider a run can select, personal ones first and the
 * synthesized official provider last, ordered by `providerOrder`.
 *
 * The official provider is appended rather than promoted so it never becomes
 * the document's implicit default; promoting it is the job of
 * {@link promoteZcodeSelection} when a run explicitly asks for it.
 */
function collectEffectiveProviders(config: AnyRecord): ZcodeProviderEntry[] {
  const entries = collectZcodePersonalProviders(config);
  const official = resolveZcodeOfficialProvider();
  if (official && !entries.some((entry) => entry.providerId === official.providerId)) {
    entries.push({ providerId: official.providerId, modelIds: official.modelIds });
  }
  return orderZcodeProviders(config, entries);
}

/**
 * Resolves the model a bare `--prompt` run selects.
 *
 * ZCode 0.16.9 ignores the document's `defaultModelSelection` and registry-falls
 * back to the first visible provider (per `providerOrder`) and that provider's
 * first declared model. Only providers the real document declares count: the
 * synthesized official provider exists in no document the CLI reads, so a bare
 * run can never select it — counting it as the default would make
 * {@link resolveZcodeModelEnv} skip the generated copy for a model that cannot
 * run without one.
 */
function readZcodeDefaultModel(config: AnyRecord): string | null {
  const first = orderZcodeProviders(config, collectZcodePersonalProviders(config))[0];
  const modelId = first?.modelIds[0];
  return first && modelId ? `${first.providerId}/${modelId}` : null;
}

/**
 * Reads display names for the picker from the legacy CLI config.
 *
 * The personal provider document stores no display name, but the legacy
 * `provider.<id>.models.<id>.name` labels are still written by the app and give
 * far nicer subtitles than a raw model id, so they are reused when present.
 */
function readLegacyModelLabels(): Map<string, string> {
  const labels = new Map<string, string>();
  const providers = readObjectRecord(readZcodeConfig()?.provider);
  for (const [providerId, rawProvider] of Object.entries(providers ?? {})) {
    const models = readObjectRecord(readObjectRecord(rawProvider)?.models);
    for (const [modelId, rawModel] of Object.entries(models ?? {})) {
      const name = readOptionalString(readObjectRecord(rawModel)?.name);
      if (name) {
        labels.set(`${providerId}/${modelId}`, name);
      }
    }
  }
  return labels;
}

/** Returns true when the document already declares a rule for `providerId`. */
function hasProviderRule(config: AnyRecord, providerId: string): boolean {
  return readProviderRules(config).some(
    (entry) => readOptionalString(readObjectRecord(entry)?.providerId) === providerId,
  );
}

/** Appends a provider rule, creating its container and array when absent. */
function appendProviderRule(config: AnyRecord, rule: AnyRecord): void {
  let container = readObjectRecord(config.providerConfigRules);
  if (!container) {
    container = {};
    config.providerConfigRules = container;
  }
  if (!Array.isArray(container.providerRules)) {
    container.providerRules = [];
  }
  container.providerRules.push(rule);
}

/**
 * Pins a selection inside a cloned provider document: `providerId` moves to the
 * front of `providerOrder` and `modelId` to the front of that provider's model
 * list. Verified against 0.16.9 — this is what makes a headless run pick an
 * arbitrary model, since `--prompt` has no model flag.
 */
function promoteZcodeSelection(config: AnyRecord, providerId: string, modelId: string): void {
  const providerOrder = readStringArray(config.providerOrder) ?? [];
  config.providerOrder = [providerId, ...providerOrder.filter((id) => id !== providerId)];

  const rule = readProviderRules(config).find(
    (entry) => readOptionalString(readObjectRecord(entry)?.providerId) === providerId,
  );
  const ruleConfig = readObjectRecord(readObjectRecord(rule)?.config);
  if (!ruleConfig) {
    return;
  }
  const modelIds = readStringArray(ruleConfig.personalModelIds) ?? [];
  ruleConfig.personalModelIds = [modelId, ...modelIds.filter((id) => id !== modelId)];
}

/**
 * Builds the model catalog from the user's personal provider document.
 *
 * Every model declared under a visible api-key provider's `personalModelIds` is
 * offered, valued `<providerId>/<modelId>` and grouped by channel so providers
 * that share a model id stay distinguishable. The official coding-plan models
 * are appended when their key can be recovered, so the free quota shows up
 * alongside the user's own providers. Labels come from the legacy config's
 * `provider.<id>.models.<id>.name` when present, else the raw id.
 *
 * `DEFAULT` is the model a bare CLI run selects — see
 * {@link readZcodeDefaultModel} — and {@link resolveZcodeModelEnv} covers how an
 * explicit pick reaches a run.
 *
 * Returns `null` when the document yields no usable provider, so the caller
 * falls back to {@link ZCODE_PREDEFINED_MODELS}.
 */
export function loadZcodeModels(): ProviderModelsDefinition | null {
  const config = readZcodeProviderConfig();
  if (!config) {
    return null;
  }

  const labels = readLegacyModelLabels();
  const options: ProviderModelOption[] = [];
  for (const provider of collectEffectiveProviders(config)) {
    for (const modelId of provider.modelIds) {
      const value = `${provider.providerId}/${modelId}`;
      options.push({
        value,
        label: labels.get(value) ?? modelId,
        group: resolveChannelLabel(provider.providerId),
      });
    }
  }

  if (options.length === 0) {
    return null;
  }

  return { OPTIONS: options, DEFAULT: readZcodeDefaultModel(config) ?? options[0]!.value };
}

/** A generated per-run config that makes one `--prompt` run use a chosen model. */
export type ZcodeModelOverride = {
  /** Environment the spawn must merge so the CLI reads the generated document. */
  env: Record<string, string>;
  /** Removes the generated document; idempotent, safe after any run outcome. */
  cleanup: () => void;
};

/**
 * Builds the environment that makes one headless run use `model`.
 *
 * ZCode 0.16.9 dropped the old `ZCODE_MODEL`/`ZCODE_BASE_URL`/`ZCODE_API_KEY`
 * trio, and `--prompt` has no `--model` flag, so the only per-invocation channel
 * is the provider document itself: this clones the user's document, moves the
 * requested provider/model to the front (see {@link promoteZcodeSelection}) —
 * appending the synthesized official provider when that is the target — and
 * points `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` at the copy. The user's real
 * document is never read for the model nor written back.
 *
 * Returns `null` when there is nothing to override: a blank request, a missing
 * document (nothing to mirror), or a request for the model a bare run already
 * selects. Throws when the model's channel cannot supply an api-key provider,
 * because silently falling back would run a different model than the user picked.
 *
 * Known limit (0.16.9): `--resume` keeps the session's persisted model, so a
 * mid-session model change has no effect on a resumed turn.
 */
export function resolveZcodeModelEnv(model: string): ZcodeModelOverride | null {
  const target = model.trim();
  if (!target) {
    return null;
  }

  const document = readZcodeProviderDocument();
  const config = readObjectRecord(document?.config);
  if (!document || !config) {
    return null;
  }

  const separatorIndex = target.indexOf('/');
  const providerId = separatorIndex > 0 ? target.slice(0, separatorIndex) : '';
  const modelId = separatorIndex > 0 ? target.slice(separatorIndex + 1) : '';
  const provider = collectEffectiveProviders(config).find((entry) => entry.providerId === providerId);
  if (!providerId || !modelId || !provider) {
    throw new AppError(
      `ZCode cannot run ${target}: ${getZcodeProviderConfigPath()} has no api-key provider "${providerId || target}".`,
      { code: 'ZCODE_MODEL_CHANNEL_UNRESOLVED', statusCode: 400 },
    );
  }

  if (readZcodeDefaultModel(config) === target) {
    return null;
  }

  // Clone the whole document so the copy is byte-for-byte the CLI expects,
  // then mutate only its `config` layer.
  const generated = JSON.parse(JSON.stringify(document)) as AnyRecord;
  const generatedConfig = readObjectRecord(generated.config);
  if (!generatedConfig) {
    return null;
  }
  const official = resolveZcodeOfficialProvider();
  if (official && providerId === official.providerId && !hasProviderRule(generatedConfig, providerId)) {
    appendProviderRule(generatedConfig, official.rule);
  }
  promoteZcodeSelection(generatedConfig, providerId, modelId);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-zcode-'));
  const filePath = path.join(dir, 'provider_config.json');
  fs.writeFileSync(filePath, JSON.stringify(generated), { encoding: 'utf8', mode: 0o600 });

  return {
    env: { ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: filePath },
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // A leftover temp dir is harmless; the run already finished.
      }
    },
  };
}

// ---------------------------

/** Provider registry model adapter for ZCode's document-driven catalog. */
export class ZcodeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const catalog = loadZcodeModels() ?? ZCODE_PREDEFINED_MODELS;
    // Subtitles come from the shared catalog, resolved through each option's
    // `<provider>/<model>` value, matching the other harnesses.
    return { ...catalog, OPTIONS: applySharedModelDescriptions(catalog.OPTIONS) };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    // `--prompt` always falls back to the first provider's first model, and that
    // is global rather than per-session, so it is the active model for every
    // session the app has not recorded a selection for.
    const config = readZcodeProviderConfig();
    const defaultModel = config ? readZcodeDefaultModel(config) : null;
    if (defaultModel) {
      return { model: defaultModel };
    }
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
