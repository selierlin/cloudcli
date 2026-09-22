import { useCallback, useMemo, useState } from 'react';

import type { ModelOptionGroup } from '@/modules/chat/utils/modelGrouping';

type GroupKey = string | null;

/**
 * Tracks which vendor sections are expanded in a collapsed model list.
 *
 * The section holding the selected model starts expanded and every other
 * section collapsed, so the list opens on the active vendor. The default is
 * restored whenever the selected model moves to a different section (catalog
 * hydration, provider switch or stored-model change); callers restore it again
 * through `reset` each time they surface the list, so a previously expanded
 * vendor is collapsed again on the next open. Manual toggles are kept until
 * either event fires.
 */
export function useModelGroupCollapse(
  groups: ModelOptionGroup[],
  selectedValue: string,
) {
  const selectedGroupKey = useMemo<GroupKey>(() => {
    const match = groups.find((group) =>
      group.options.some((option) => option.value === selectedValue),
    );
    // Fall back to the first section when the stored value is not in the
    // catalog yet, so the list never opens with every vendor collapsed.
    return match ? match.key : (groups[0]?.key ?? null);
  }, [groups, selectedValue]);

  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<GroupKey>>(
    () => new Set<GroupKey>([selectedGroupKey]),
  );
  const [expandedFor, setExpandedFor] = useState<GroupKey>(selectedGroupKey);

  const applyDefault = useCallback((key: GroupKey) => {
    setExpandedFor(key);
    setExpandedKeys(new Set<GroupKey>([key]));
  }, []);

  // Re-seed synchronously when the selection lands in another section, so the
  // first frame after the change already shows the new default.
  if (expandedFor !== selectedGroupKey) {
    applyDefault(selectedGroupKey);
  }

  const reset = useCallback(
    () => applyDefault(selectedGroupKey),
    [applyDefault, selectedGroupKey],
  );

  const toggle = useCallback((key: GroupKey) => {
    setExpandedKeys((current) => {
      const next = new Set<GroupKey>(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const isExpanded = useCallback(
    (key: GroupKey) => expandedKeys.has(key),
    [expandedKeys],
  );

  return { isExpanded, toggle, reset };
}
