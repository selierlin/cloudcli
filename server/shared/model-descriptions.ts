import path from 'node:path';

import type { ProviderModelOption } from './types.js';

/**
 * Generic, channel-independent model descriptions keyed by bare model id (the
 * segment after `/` in a picker value, or the whole value when it has none).
 *
 * Only facts that stay true on every gateway belong here (what a model is);
 * channel-specific metadata such as credit multipliers stays in the provider
 * that owns the channel. Adapters overlay these as picker subtitles via
 * {@link applySharedModelDescriptions} when neither the harness config nor the
 * provider's own catalog carries a description.
 */
export const MODEL_DESCRIPTIONS: Record<string, string> = {
  'gpt-6-astra': 'Most capable frontier agentic coding model.',
  'gpt-5.6-sol': 'Latest frontier agentic coding model.',
  'gpt-5.6-terra': 'Balanced agentic coding model for everyday work.',
  'gpt-5.6-luna': 'Fast and affordable agentic coding model.',
  'gpt-5.5': 'Frontier model for complex coding, research, and real-world work.',
  'gpt-5.4-mini': 'Small, fast, and cost-efficient model for simpler coding tasks.',
  'deepseek-v4-flash': 'Fast and affordable DeepSeek coding model.',
  'deepseek-v4-pro': 'Frontier DeepSeek model for complex coding and research.',
  'deepseek-v4-flash-vision-exp': 'Experimental DeepSeek model with image input.',
};

/**
 * Channel-qualified descriptions keyed by `<channel>/<model id>`. This file is
 * the single source of picker subtitles: harness adapters must not carry or
 * read their own description data, and what is here wins over whatever a
 * harness config happens to declare.
 *
 * These carry facts that are only true on one gateway (WorkBuddy credit
 * multipliers and Wuan's token prices, for instance) yet should not be
 * redefined in every harness that can reach that gateway. Adapters that route bare model ids pass their channel
 * to {@link applySharedModelDescriptions}; adapters whose values already carry a
 * channel prefix get the lookup for free.
 */
export const CHANNEL_MODEL_DESCRIPTIONS: Record<string, string> = {
  'deepseek/best': '',
  'deepseek/deepseek-flash': '',
  'deepseek/deepseek-v4-flash': '',
  'deepseek/deepseek-v4-pro': '',
  'deepseek/default': '',
  'deepseek/fable': '',
  'deepseek/haiku': '',
  'deepseek/high': '',
  'deepseek/low': '',
  'deepseek/max': '',
  'deepseek/medium': '',
  'deepseek/opus': '',
  'deepseek/opus[1m]': '',
  'deepseek/opusplan': '',
  'deepseek/sonnet': '',
  'deepseek/sonnet[1m]': '',
  'deepseek/xhigh': '',
  'opencode/big-pickle': 'OpenCode Zen · Free',
  'opencode/deepseek-v4-flash-free': 'OpenCode Zen · Free',
  'opencode/laguna-s-2.1-free': 'OpenCode Zen · Free',
  'opencode/ling-3.0-flash-free': 'OpenCode Zen · Free',
  'opencode/mimo-v2.5-free': 'OpenCode Zen · Free',
  'opencode/nemotron-3-ultra-free': 'OpenCode Zen · Free',
  'opencode/north-mini-code-free': 'OpenCode Zen · Free',
  'volcano-ark/ark-code-latest': '',
  'volcano-ark/best': '',
  'volcano-ark/deepseek-v4-flash': '',
  'volcano-ark/deepseek-v4-pro': '',
  'volcano-ark/default': '',
  'volcano-ark/doubao-seed-2.0-lite': '',
  'volcano-ark/doubao-seed-2.1-turbo': '',
  'volcano-ark/doubao-seed-evolving': '',
  'volcano-ark/fable': '',
  'volcano-ark/glm-5.3': '',
  'volcano-ark/glm-5.3-flash': '',
  'volcano-ark/glm-latest': '',
  'volcano-ark/haiku': '',
  'volcano-ark/high': '',
  'volcano-ark/kimi-k2.7-code': '',
  'volcano-ark/kimi-k3': '',
  'volcano-ark/low': '',
  'volcano-ark/max': '',
  'volcano-ark/medium': '',
  'volcano-ark/minimax-m3': '',
  'volcano-ark/opus': '',
  'volcano-ark/opus[1m]': '',
  'volcano-ark/opusplan': '',
  'volcano-ark/sonnet': '',
  'volcano-ark/sonnet[1m]': '',
  'volcano-ark/xhigh': '',
  'workbuddy/auto': '自动匹配最优模型，积分倍率随之浮动',
  'workbuddy/deepseek-v4-flash': '积分倍率 0.17x（夜间折扣）',
  'workbuddy/deepseek-v4-pro': '积分倍率 0.51x（夜间折扣）',
  'workbuddy/deepseek-v4.1-flash': '积分倍率 0.11x（夜间折扣）',
  'workbuddy/glm-5.1': '积分倍率 0.79x',
  'workbuddy/glm-5.2': '积分倍率 0.79x（夜间折扣）',
  'workbuddy/glm-5.3': '积分倍率 0.79x',
  'workbuddy/glm-5.3-flash': '积分倍率 0.06x',
  'workbuddy/glm-5v-turbo': '积分倍率 0.71x',
  'workbuddy/hy3': '积分倍率 0.00x（限时免费）',
  'workbuddy/hy4-preview': '积分倍率 0.29x（夜间折扣）',
  'workbuddy/kimi-k2.6': '积分倍率 0.52x',
  'workbuddy/kimi-k2.7': '积分倍率 0.57x',
  'workbuddy/kimi-k2.8-preview': '积分倍率 0.77x',
  'workbuddy/kimi-k3-1': '积分倍率 1.62x',
  'workbuddy/minimax-m3': '积分倍率 0.25x',
  'workbuddy/space-bunny': '积分倍率 0.03x（限时折扣）',
  // Wuan (`wuanai`) channel, keyed by the id the harness configs already use
  // (`wuanai`). Price subtitles come from the vendor's published list per
  // million tokens: `<billing unit>/百万 · 输入 · 输出`.
  // Snapshot of the Wuan price table, 2026-10-04 — re-read it when repricing.
  'wuanai/best': '',
  'wuanai/claude-fable-5-1': '高级点数/百万 · 输入 3000 · 输出 15000',
  'wuanai/claude-haiku-4.5': '高级点数/百万 · 输入 100 · 输出 500',
  'wuanai/claude-opus-4-6': '高级点数/百万 · 输入 500 · 输出 2500',
  'wuanai/claude-opus-5': '高级点数/百万 · 输入 500 · 输出 2500',
  'wuanai/claude-opus-5-5': '高级点数/百万 · 输入 800 · 输出 4000',
  'wuanai/claude-sonnet-4.5': '高级点数/百万 · 输入 300 · 输出 1500',
  'wuanai/claude-sonnet-5': '高级点数/百万 · 输入 200 · 输出 1000',
  'wuanai/deepseek-v4.1-flash': '积分/百万 · 输入 200 · 输出 800',
  'wuanai/deepseek-v4.1-flash-fast': '高级点数/百万 · 输入 200 · 输出 800',
  'wuanai/default': '',
  'wuanai/fable': '',
  'wuanai/gemini-3.1-flash-lite': '高级点数/百万 · 输入 25 · 输出 150',
  'wuanai/gemini-3.1-pro-preview': '高级点数/百万 · 输入 200 · 输出 1200',
  'wuanai/gemini-3.5-flash': '高级点数/百万 · 输入 150 · 输出 900',
  'wuanai/gemini-3.5-flash-lite': '高级点数/百万 · 输入 30 · 输出 250',
  'wuanai/gemini-3.6-flash': '高级点数/百万 · 输入 75 · 输出 375',
  'wuanai/gemini-3.7-flash': '高级点数/百万 · 输入 75 · 输出 375',
  'wuanai/gemini-3.8-flash': '高级点数/百万 · 输入 75 · 输出 375',
  'wuanai/gemma-4-31b-it': '积分/百万 · 输入 9 · 输出 34',
  'wuanai/glm-5.3': '积分/百万 · 输入 140 · 输出 440',
  'wuanai/glm-5.3-flash': '积分/百万 · 输入 15 · 输出 50',
  'wuanai/gpt-5.6-luna': '高级点数/百万 · 输入 20 · 输出 120',
  'wuanai/gpt-5.6-sol': '高级点数/百万 · 输入 400 · 输出 2000',
  'wuanai/gpt-5.6-terra': '高级点数/百万 · 输入 200 · 输出 1200',
  'wuanai/gpt-6-astra': '高级点数/百万 · 输入 1000 · 输出 5000',
  'wuanai/gpt-6-luna': '高级点数/百万 · 输入 10 · 输出 50',
  'wuanai/gpt-6-sol': '高级点数/百万 · 输入 200 · 输出 1000',
  // Image model; not in the dialogue price table, so the channel label stands in.
  'wuanai/gpt-image-2': '',
  'wuanai/gpt-oss-120b': '积分/百万 · 输入 15 · 输出 60',
  'wuanai/haiku': '',
  'wuanai/high': '',
  'wuanai/kimi-k3': '积分/百万 · 输入 300 · 输出 1500',
  'wuanai/low': '',
  'wuanai/max': '',
  'wuanai/medium': '',
  'wuanai/muse-glimmer-30b': '积分/百万 · 输入 35 · 输出 150',
  'wuanai/muse-spark-1.3-contributor': '积分/百万 · 输入 10 · 输出 20',
  'wuanai/nemotron-3.5-lightning-30b-a3b': '积分/百万 · 输入 8 · 输出 20',
  'wuanai/opus': '',
  'wuanai/opus[1m]': '',
  'wuanai/opusplan': '',
  'wuanai/sonnet': '',
  'wuanai/sonnet[1m]': '',
  'wuanai/xhigh': '',
  'zai/zai/glm-5.1': '',
};

/**
 * Fills missing picker subtitles, preferring in order: a description the
 * harness config or provider catalog already carries, a channel-qualified
 * shared description ({@link CHANNEL_MODEL_DESCRIPTIONS}), then a generic one
 * ({@link MODEL_DESCRIPTIONS}). `channel` is only needed by adapters whose
 * option values are bare model ids; otherwise the value's own prefix decides.
 * When nothing model-specific matches, the channel's own display name from
 * {@link MODEL_CHANNELS} becomes the subtitle, so channel-name subtitles also
 * come from this file instead of being repeated per model in the adapters.
 * Used by the model adapters of Codex, DSH, Pi, OpenCode, and WorkBuddy.
 */
export function applySharedModelDescriptions(
  options: ProviderModelOption[],
  channel?: string,
): ProviderModelOption[] {
  return options.map((option) => {
    if (option.description) {
      return option;
    }
    const separatorIndex = option.value.indexOf('/');
    const channelPrefix = separatorIndex > 0 ? option.value.slice(0, separatorIndex) : channel;
    const modelId = separatorIndex > 0 ? option.value.slice(separatorIndex + 1) : option.value;
    const shared = (channelPrefix && CHANNEL_MODEL_DESCRIPTIONS[`${channelPrefix}/${modelId}`])
      || MODEL_DESCRIPTIONS[modelId]
      || (channelPrefix && resolveChannelLabel(channelPrefix));
    return shared ? { ...option, description: shared } : option;
  });
}

/**
 * Canonical display names for vendor channels, keyed by the raw channel id the
 * harness configs use (Pi's `models.json` provider key, DSH's settings provider
 * key, OpenCode's provider id).
 *
 * Only vendors with an unambiguous official name are listed; unknown ids fall
 * back to their raw id via {@link resolveChannelLabel}. Adapters apply the
 * label to `ProviderModelOption.group` so every harness shows the same vendor
 * heading without redefining it per channel.
 */
export const MODEL_CHANNELS: Record<string, string> = {
  anthropic: 'Anthropic',
  bigmodel: 'BigModel',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  'volcano-ark': 'Volcano Ark',
  workbuddy: 'WorkBuddy',
};

/**
 * Resolves a raw channel id to its canonical display name, falling back to the
 * id itself for vendors without a shared entry. Used by the DSH, Pi, and
 * OpenCode model adapters when tagging picker groups.
 */
export function resolveChannelLabel(channelId: string): string {
  return MODEL_CHANNELS[channelId] ?? channelId;
}

/**
 * Derives a channel tag from a single-channel provider's active profile file
 * name, e.g. `settings-wuanai-glm.json` -> `wuanai` and `config-ark.toml` ->
 * `ark`. Convention: `<base>-<channel>[-<variant>].<ext>`. The channel is the
 * remainder after the `settings`/`config` base, resolved by the longest
 * matching known channel id ({@link MODEL_CHANNELS} keys): `config-volcano-ark.toml`
 * yields `Volcano Ark`, not a dash-cut `volcano`. Unknown remainders fall back
 * to their first dash segment (`acme-glm` -> `acme`). Plain `settings.json` /
 * `config.toml` carry no channel and yield null.
 *
 * Claude and Codex configure exactly one vendor at a time through these
 * profile files, so the file name is the only vendor signal they have.
 */
export function resolveChannelFromProfileFile(
  fileName: string | null | undefined,
): string | null {
  if (!fileName) {
    return null;
  }
  const stem = path.basename(fileName).replace(/\.(json|toml)$/i, '');
  const match = /^(?:settings|config)-(.+)$/.exec(stem);
  if (!match) {
    return null;
  }
  const remainder = match[1];
  const knownChannels = Object.keys(MODEL_CHANNELS);
  // Longest known channel id that is the whole remainder or its dash-prefix
  // wins, so multi-segment vendor ids (volcano-ark) survive the variant suffix.
  const known = knownChannels
    .filter((id) => remainder === id || remainder.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0];
  const channel = known ?? remainder.split('-')[0].trim();
  return channel ? resolveChannelLabel(channel) : null;
}
