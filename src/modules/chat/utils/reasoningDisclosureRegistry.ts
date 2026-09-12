import type { ChatMessage, ReasoningDisclosureState } from '@/shared/types';

type DisclosureRegistryEntry = ReasoningDisclosureState & {
  content: string;
};

export type DisclosureRegistry = {
  sessionId: string | null;
  entries: Record<string, DisclosureRegistryEntry>;
};

export type DisclosureRegistryAction =
  | { type: 'reset'; sessionId: string | null }
  | {
      type: 'sync';
      rows: Array<{
        key: string;
        content: string;
        isStreaming: boolean;
        timestamp: ChatMessage['timestamp'];
      }>;
      now: number;
    }
  | { type: 'user'; key: string; open: boolean }
  | { type: 'program_open'; key: string; now: number }
  | { type: 'program_collapse'; key: string };

function validTimestampMs(timestamp: ChatMessage['timestamp']): number | undefined {
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) ? value : undefined;
}

function findStreamedReplacement(
  entries: DisclosureRegistry['entries'],
  content: string,
  activeKeys: Set<string>,
): [string, DisclosureRegistryEntry] | undefined {
  const matches = Object.entries(entries).filter(([key, entry]) => (
    !activeKeys.has(key)
    && entry.hasEverStreamed
    && entry.content === content
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

export function disclosureRegistryReducer(
  state: DisclosureRegistry,
  action: DisclosureRegistryAction,
): DisclosureRegistry {
  if (action.type === 'reset') {
    return state.sessionId === action.sessionId
      ? state
      : { sessionId: action.sessionId, entries: {} };
  }

  if (action.type === 'sync') {
    let changed = false;
    const entries = { ...state.entries };
    const activeKeys = new Set(action.rows.map((row) => row.key));
    for (const row of action.rows) {
      let existing = entries[row.key];
      if (!existing) {
        // The persisted transcript replaces the synthetic live row with a new
        // timestamp/id. Carry its disclosure ownership across that handoff so
        // the final-answer delay is not bypassed by a fresh historical state.
        const replacement = findStreamedReplacement(entries, row.content, activeKeys);
        if (replacement) {
          const [previousKey, previousEntry] = replacement;
          delete entries[previousKey];
          existing = { ...previousEntry, content: row.content };
          entries[row.key] = existing;
          changed = true;
        } else {
          entries[row.key] = {
            ownership: 'auto',
            autoCollapsed: !row.isStreaming,
            hasEverStreamed: row.isStreaming,
            streamStartedAtMs: row.isStreaming ? validTimestampMs(row.timestamp) : undefined,
            visibleStartedAtMs: row.isStreaming ? action.now : undefined,
            content: row.content,
          };
          changed = true;
          continue;
        }
      }
      if (existing.content !== row.content) {
        existing = { ...existing, content: row.content };
        entries[row.key] = existing;
        changed = true;
      }
      if (row.isStreaming && !existing.hasEverStreamed) {
        entries[row.key] = {
          ...existing,
          hasEverStreamed: true,
          streamStartedAtMs: validTimestampMs(row.timestamp),
          visibleStartedAtMs: action.now,
        };
        changed = true;
      } else if (
        !row.isStreaming
        && existing.hasEverStreamed
        && existing.visibleDurationSeconds === undefined
        && existing.streamStartedAtMs !== undefined
      ) {
        entries[row.key] = {
          ...existing,
          visibleDurationSeconds: Math.max(1, Math.ceil((action.now - existing.streamStartedAtMs) / 1000)),
        };
        changed = true;
      }
    }
    return changed ? { ...state, entries } : state;
  }

  const existing = state.entries[action.key];
  if (!existing) return state;
  if (action.type === 'user') {
    return {
      ...state,
      entries: {
        ...state.entries,
        [action.key]: {
          ...existing,
          ownership: action.open ? 'user_open' : 'user_closed',
        },
      },
    };
  }
  if (existing.ownership !== 'auto') return state;
  const autoCollapsed = action.type === 'program_collapse';
  if (existing.autoCollapsed === autoCollapsed) return state;
  return {
    ...state,
    entries: {
      ...state.entries,
      [action.key]: {
        ...existing,
        autoCollapsed,
        ...(!autoCollapsed ? { visibleStartedAtMs: action.now } : {}),
      },
    },
  };
}

export function resolveReasoningDisclosureState(
  registry: DisclosureRegistry,
  key: string,
  content: string,
): ReasoningDisclosureState | undefined {
  const direct = registry.entries[key];
  if (direct) return direct;

  const matches = Object.values(registry.entries).filter((entry) => (
    entry.hasEverStreamed && entry.content === content
  ));
  return matches.length === 1 ? matches[0] : undefined;
}
