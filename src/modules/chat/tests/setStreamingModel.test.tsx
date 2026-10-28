import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

beforeEach(() => {
  sessionMessages.mockReset();
  sessionMessages.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { messages: [], total: 0, hasMore: false } }),
  });
});

afterEach(() => {
  vi.resetModules();
});

function streamingRow(messages: NormalizedMessage[]): NormalizedMessage | undefined {
  return messages.find(m => m.kind === 'stream_delta');
}

async function loadedStore() {
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  const view = renderHook(() => useSessionStore());
  await act(async () => {
    await view.result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
  });
  return view;
}

describe('setStreamingModel', () => {
  it('stamps the model onto an existing live streaming row', async () => {
    const view = await loadedStore();
    const { updateStreamingBatch, setStreamingModel, getMessages } = view.result.current;

    act(() => {
      updateStreamingBatch('session-1', [{ channel: 'text', text: 'partial' }], 'claude');
    });
    act(() => {
      setStreamingModel('session-1', 'claude-opus-5');
    });

    assert.equal(streamingRow(getMessages('session-1'))?.model, 'claude-opus-5');
    assert.equal(streamingRow(getMessages('session-1'))?.content, 'partial');
  });

  it('holds a model reported before the first delta and applies it once the row is created', async () => {
    const view = await loadedStore();
    const { updateStreamingBatch, setStreamingModel, getMessages } = view.result.current;

    // Backend may publish the model before any text delta has built a row.
    act(() => {
      setStreamingModel('session-1', 'claude-sonnet-5');
    });
    assert.equal(streamingRow(getMessages('session-1')), undefined);

    act(() => {
      updateStreamingBatch('session-1', [{ channel: 'text', text: 'hello' }], 'claude');
    });
    assert.equal(streamingRow(getMessages('session-1'))?.model, 'claude-sonnet-5');
  });

  it('keeps the model across subsequent deltas instead of wiping it', async () => {
    const view = await loadedStore();
    const { updateStreamingBatch, setStreamingModel, getMessages } = view.result.current;

    act(() => {
      updateStreamingBatch('session-1', [{ channel: 'text', text: 'a' }], 'claude');
      setStreamingModel('session-1', 'claude-haiku-4-5-20251001');
    });
    act(() => {
      // A later delta replaces the row wholesale; the model must survive.
      updateStreamingBatch('session-1', [{ channel: 'text', text: 'ab' }], 'claude');
    });

    const row = streamingRow(getMessages('session-1'));
    assert.equal(row?.model, 'claude-haiku-4-5-20251001');
    assert.equal(row?.content, 'ab');
  });
});