import { describe, expect, it } from 'vitest';

import {
  disclosureRegistryReducer,
  resolveReasoningDisclosureState,
  type DisclosureRegistry,
} from '@/modules/chat/utils/reasoningDisclosureRegistry';

const emptyRegistry = (): DisclosureRegistry => ({ sessionId: 's1', entries: {} });

describe('reasoning disclosure registry', () => {
  it('preserves the open live state when persisted history replaces its key', () => {
    const live = disclosureRegistryReducer(emptyRegistry(), {
      type: 'sync',
      rows: [{
        key: 'live-key',
        content: '完整思考',
        isStreaming: true,
        timestamp: '2026-09-13T10:00:00.000Z',
      }],
      now: Date.parse('2026-09-13T10:00:01.000Z'),
    });

    expect(resolveReasoningDisclosureState(live, 'server-key', '完整思考')?.autoCollapsed).toBe(false);

    const persisted = disclosureRegistryReducer(live, {
      type: 'sync',
      rows: [{
        key: 'server-key',
        content: '完整思考',
        isStreaming: false,
        timestamp: '2026-09-13T10:00:02.000Z',
      }],
      now: Date.parse('2026-09-13T10:00:03.000Z'),
    });

    expect(persisted.entries['live-key']).toBeUndefined();
    expect(persisted.entries['server-key']).toMatchObject({
      ownership: 'auto',
      autoCollapsed: false,
      hasEverStreamed: true,
    });
  });

  it('keeps newly loaded historical reasoning collapsed', () => {
    const historical = disclosureRegistryReducer(emptyRegistry(), {
      type: 'sync',
      rows: [{
        key: 'history-key',
        content: '旧思考',
        isStreaming: false,
        timestamp: '2026-09-13T09:00:00.000Z',
      }],
      now: Date.parse('2026-09-13T10:00:00.000Z'),
    });

    expect(historical.entries['history-key']).toMatchObject({
      ownership: 'auto',
      autoCollapsed: true,
      hasEverStreamed: false,
    });
  });
});
