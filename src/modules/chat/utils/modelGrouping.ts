import type { ProviderModelOption } from '@/shared/types';

/** One rendered section of a provider's model catalog, split by channel. */
export type ModelOptionGroup = {
  /**
   * Channel id shared by this group's options, or null for the trailing bucket
   * that holds options without a channel (custom rows, single-catalog providers).
   */
  key: string | null;
  options: ProviderModelOption[];
};

/**
 * Splits a provider's model options into channel sections.
 *
 * Providers that expose several channels (Pi reads every vendor from the user's
 * own `models.json`) tag each option with its channel in `group`. Grouping keeps
 * same-named models from different channels distinguishable and gives each menu
 * a heading. Options without a channel collect into one final `key: null` group,
 * so a provider whose catalog is untagged still renders as a single flat list
 * and its menu can skip headings. Group order is first-seen, preserving the
 * catalog's own ordering.
 */
export function groupModelOptions(options: ProviderModelOption[]): ModelOptionGroup[] {
  const groups = new Map<string, ModelOptionGroup>();
  let ungrouped: ModelOptionGroup | null = null;

  for (const option of options) {
    const key = option.group?.trim();
    if (!key) {
      ungrouped ??= { key: null, options: [] };
      ungrouped.options.push(option);
      continue;
    }

    const existing = groups.get(key);
    if (existing) {
      existing.options.push(option);
    } else {
      groups.set(key, { key, options: [option] });
    }
  }

  const ordered = [...groups.values()];
  if (ungrouped) {
    ordered.push(ungrouped);
  }
  return ordered;
}
