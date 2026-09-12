import type {
  LLMProvider,
  StreamChannel,
  StreamingChannelUpdate,
} from '@/shared/types';

const FOREGROUND_MIN_PUBLISH_INTERVAL_MS = 32;
const STREAM_PUBLISH_WATCHDOG_MS = 100;
const BACKGROUND_PUBLISH_INTERVAL_MS = 200;

/** One session's authoritative in-flight reply and its publish scheduler. */
type StreamBuffer = {
  text: string;
  thinking: string;
  publishedText: string;
  publishedThinking: string;
  provider: LLMProvider;
  frameId: number | null;
  publishTimer: number | null;
  lastPublishedAt: number | null;
};

/**
 * Session-keyed streaming buffer owned by the chat pane. `ChatInterface`
 * creates it and hands it to `useChatRealtimeHandlers`, which appends deltas
 * and flushes synchronously on `stream_end` / `complete`.
 */
export type StreamingBufferRegistry = {
  /** Appends a non-empty delta to one session/channel and schedules its latest state. */
  append: (sessionId: string, text: string, provider: LLMProvider, channel?: StreamChannel) => void;
  /** Publishes every dirty channel synchronously without finalizing or dropping the buffer. */
  flushNow: (sessionId: string) => void;
  /** Cancels pending work and discards one session buffer without publishing it. */
  drop: (sessionId: string) => void;
  /** Cancels pending work and discards all session buffers. */
  dropAll: () => void;
  /** Whether the session currently holds an in-flight buffer. */
  has: (sessionId: string) => boolean;
};

/**
 * Creates the pane-wide stream scheduler. Visible sessions publish on an
 * eligible animation frame with a watchdog; hidden sessions publish at most
 * five times per second. `flush` always receives one atomic channel batch.
 */
export function createStreamingBufferRegistry(
  flush: (
    sessionId: string,
    updates: StreamingChannelUpdate[],
    provider: LLMProvider,
  ) => void,
  isSessionVisible: (sessionId: string) => boolean = () => true,
): StreamingBufferRegistry {
  const buffers = new Map<string, StreamBuffer>();

  const clearFrame = (buffer: StreamBuffer): void => {
    if (buffer.frameId !== null) {
      window.cancelAnimationFrame(buffer.frameId);
      buffer.frameId = null;
    }
  };

  const clearPublishTimer = (buffer: StreamBuffer): void => {
    if (buffer.publishTimer !== null) {
      window.clearTimeout(buffer.publishTimer);
      buffer.publishTimer = null;
    }
  };

  const clearScheduledPublish = (buffer: StreamBuffer): void => {
    clearFrame(buffer);
    clearPublishTimer(buffer);
  };

  const collectDirtyChannels = (buffer: StreamBuffer): StreamingChannelUpdate[] => {
    const updates: StreamingChannelUpdate[] = [];
    if (buffer.thinking !== buffer.publishedThinking) {
      updates.push({ channel: 'thinking', text: buffer.thinking });
    }
    if (buffer.text !== buffer.publishedText) {
      updates.push({ channel: 'text', text: buffer.text });
    }
    return updates;
  };

  const publishBuffer = (sessionId: string, buffer: StreamBuffer, publishedAt: number): void => {
    clearScheduledPublish(buffer);
    const updates = collectDirtyChannels(buffer);
    if (updates.length === 0) {
      return;
    }

    flush(sessionId, updates, buffer.provider);
    for (const update of updates) {
      if (update.channel === 'thinking') {
        buffer.publishedThinking = update.text;
      } else {
        buffer.publishedText = update.text;
      }
    }
    buffer.lastPublishedAt = publishedAt;
  };

  const scheduleForegroundPublish = (sessionId: string, buffer: StreamBuffer): void => {
    if (buffer.frameId !== null) {
      return;
    }
    clearPublishTimer(buffer);

    const onAnimationFrame = (timestamp: number): void => {
      buffer.frameId = null;
      if (
        buffer.lastPublishedAt !== null
        && timestamp - buffer.lastPublishedAt < FOREGROUND_MIN_PUBLISH_INTERVAL_MS
      ) {
        buffer.frameId = window.requestAnimationFrame(onAnimationFrame);
        return;
      }
      publishBuffer(sessionId, buffer, timestamp);
    };

    buffer.frameId = window.requestAnimationFrame(onAnimationFrame);
    buffer.publishTimer = window.setTimeout(() => {
      buffer.publishTimer = null;
      publishBuffer(sessionId, buffer, performance.now());
    }, STREAM_PUBLISH_WATCHDOG_MS);
  };

  const scheduleBackgroundPublish = (sessionId: string, buffer: StreamBuffer): void => {
    if (buffer.frameId !== null) {
      clearFrame(buffer);
      clearPublishTimer(buffer);
    }
    if (buffer.publishTimer !== null) {
      return;
    }
    buffer.publishTimer = window.setTimeout(() => {
      buffer.publishTimer = null;
      publishBuffer(sessionId, buffer, performance.now());
    }, BACKGROUND_PUBLISH_INTERVAL_MS);
  };

  const append = (
    sessionId: string,
    text: string,
    provider: LLMProvider,
    channel: StreamChannel = 'text',
  ): void => {
    if (!sessionId || !text) {
      return;
    }

    let buffer = buffers.get(sessionId);
    if (!buffer) {
      buffer = {
        text: '',
        thinking: '',
        publishedText: '',
        publishedThinking: '',
        provider,
        frameId: null,
        publishTimer: null,
        lastPublishedAt: null,
      };
      buffers.set(sessionId, buffer);
    }

    buffer.provider = provider;
    buffer[channel] += text;

    if (isSessionVisible(sessionId)) {
      scheduleForegroundPublish(sessionId, buffer);
    } else {
      scheduleBackgroundPublish(sessionId, buffer);
    }
  };

  const flushNow = (sessionId: string): void => {
    const buffer = buffers.get(sessionId);
    if (!buffer) {
      return;
    }
    publishBuffer(sessionId, buffer, performance.now());
  };

  const drop = (sessionId: string): void => {
    const buffer = buffers.get(sessionId);
    if (!buffer) {
      return;
    }
    clearScheduledPublish(buffer);
    buffers.delete(sessionId);
  };

  const dropAll = (): void => {
    buffers.forEach(clearScheduledPublish);
    buffers.clear();
  };

  const has = (sessionId: string): boolean => buffers.has(sessionId);

  return { append, flushNow, drop, dropAll, has };
}
