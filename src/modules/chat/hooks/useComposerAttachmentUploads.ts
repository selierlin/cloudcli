import { useCallback, useRef } from 'react';

import type { ChatAttachment, ComposerAttachmentUpload } from '@/shared/types';
import {
  releaseComposerAttachments,
  uploadComposerAttachments,
} from '@/modules/chat/utils/composerAttachmentUpload';

/** Mutable copy of one pending entry; the hook only publishes frozen snapshots. */
type UploadEntry = {
  key: string;
  file: File;
  status: ComposerAttachmentUpload['status'];
  progress: number;
  descriptor?: ChatAttachment;
  error?: string;
  abort: AbortController;
};

/** Per-key upload state handed to the composer alongside each file. */
export type ComposerUploadState = Omit<ComposerAttachmentUpload, 'key'> & {
  /** 0..1 transfer progress, kept off the type because it is transient. */
  progress?: number;
};

export type UseComposerAttachmentUploadsResult = {
  /** Upload state for one attachment key, or undefined for a file never picked here. */
  getUpload: (key: string) => ComposerUploadState | undefined;
  /** Starts uploads for freshly picked files, replacing any state under the same keys. */
  track: (files: Array<{ key: string; file: File }>) => void;
  /**
   * Resolves the descriptors for the given files, waiting for in-flight uploads
   * and retrying failed ones. Anything still missing is returned in `missing`.
   */
  ensureUploaded: (files: File[], keys?: string[]) => Promise<{
    descriptors: ChatAttachment[];
    missing: File[];
  }>;
  /**
   * Forgets files the composer is done with. A removed attachment passes
   * `keepFiles: false` and its stored copies are released; a sent message
   * keeps them, since the transcript now references the uploaded file.
   */
  release: (files: File[], keys?: string[], options?: { keepFiles?: boolean }) => void;
  /** Forgets every tracked file (the composer switched scope) without touching stored copies. */
  reset: () => void;
  /** Whether any tracked file is still uploading. */
  isUploading: boolean;
  /** Changes on every upload state change; depend on it to re-read `getUpload`. */
  version: number;
};

const ABORTED = 'AbortError';

/**
 * Owns the composer's pending attachment uploads.
 *
 * Files are uploaded as soon as they are picked or pasted, so sending a
 * message with pictures does not stall on a request the user cannot see. The
 * state lives outside React render state (refs only) so the send path can read
 * the current status synchronously and progress updates cannot loop through
 * render. `onChange` is how the owner learns a transfer moved or finished.
 *
 * Consumers: `useChatComposerState` (picks, paste, drop, send, removal) and,
 * through it, `ChatComposer`/`ComposerAttachment` for the per-file chip.
 */
export function useComposerAttachmentUploads(
  onChange?: () => void,
): UseComposerAttachmentUploadsResult {
  const entriesRef = useRef<Map<string, UploadEntry>>(new Map());
  // A ref because this hook deliberately keeps upload state out of React state:
  // the send path reads it synchronously, and the composer re-reads it only
  // when the owner is notified. `version` exists so a consumer can memoize.
  const versionRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const publish = useCallback(() => {
    versionRef.current += 1;
    onChangeRef.current?.();
  }, []);

  const setEntry = useCallback((entry: UploadEntry) => {
    entriesRef.current.set(entry.key, entry);
  }, []);

  const startUpload = useCallback((key: string) => {
    const entry = entriesRef.current.get(key);
    if (!entry) {
      return;
    }
    const abort = new AbortController();
    const next: UploadEntry = { key, file: entry.file, status: 'uploading', progress: 0, abort };
    setEntry(next);
    publish();

    let lastPublishedAt = 0;
    /**
     * Entries are matched by attempt, never by object identity: a progress tick
     * replaces the stored entry, so an upload that finished after its last
     * progress event would otherwise look superseded by itself.
     */
    const isCurrentAttempt = () => entriesRef.current.get(key)?.abort === abort;

    void uploadComposerAttachments([entry.file], {
      signal: abort.signal,
      onProgress: (fraction) => {
        const current = entriesRef.current.get(key);
        if (!current || !isCurrentAttempt()) {
          return;
        }
        setEntry({ ...current, progress: fraction });
        // A large file streams hundreds of progress events; repainting the
        // composer on each of them is wasted work, ten a second is plenty.
        const now = Date.now();
        if (now - lastPublishedAt < 100) {
          return;
        }
        lastPublishedAt = now;
        publish();
      },
    })
      .then(([descriptor]) => {
        const current = entriesRef.current.get(key);
        if (!current || !isCurrentAttempt() || !descriptor) {
          return;
        }
        setEntry({ ...current, status: 'ready', progress: 1, descriptor, error: undefined });
        publish();
      })
      .catch((error: unknown) => {
        const current = entriesRef.current.get(key);
        if (!current || !isCurrentAttempt()) {
          return;
        }
        const aborted = error instanceof DOMException && error.name === ABORTED;
        if (aborted) {
          // The attachment was removed; its chip is already gone.
          entriesRef.current.delete(key);
          return;
        }
        setEntry({
          ...current,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
        publish();
      });
  }, [publish, setEntry]);

  const track = useCallback((files: Array<{ key: string; file: File }>) => {
    for (const { key, file } of files) {
      entriesRef.current.get(key)?.abort.abort();
      setEntry({ key, file, status: 'uploading', progress: 0, abort: new AbortController() });
    }
    if (files.length > 0) {
      publish();
    }
    files.forEach(({ key }) => startUpload(key));
  }, [publish, setEntry, startUpload]);

  const ensureUploaded = useCallback(async (files: File[], keys?: string[]) => {
    const descriptors: ChatAttachment[] = [];
    const missing: File[] = [];

    for (const [index, file] of files.entries()) {
      const key = keys?.[index] ?? findTrackedKey(entriesRef.current, file);
      const entry = key ? entriesRef.current.get(key) : undefined;
      if (!entry) {
        // Picked before this hook tracked anything (a restored queued draft):
        // its descriptor, when there is one, is supplied by the caller.
        missing.push(file);
        continue;
      }
      if (entry.status === 'failed') {
        // Retry once on send, so a transient failure does not force the user
        // to re-pick the file.
        startUpload(entry.key);
      }
      // Wait for the current attempt to settle.
      const settled = await waitForSettled(entriesRef.current, entry.key);
      if (settled?.descriptor) {
        descriptors.push(settled.descriptor);
      } else {
        missing.push(file);
      }
    }

    return { descriptors, missing };
  }, [startUpload]);

  const release = useCallback((
    files: File[],
    keys?: string[],
    options: { keepFiles?: boolean } = {},
  ) => {
    const storedNames: string[] = [];
    for (const [index, file] of files.entries()) {
      const key = keys?.[index] ?? findTrackedKey(entriesRef.current, file);
      const entry = key ? entriesRef.current.get(key) : undefined;
      if (!entry) {
        continue;
      }
      entry.abort.abort();
      entriesRef.current.delete(entry.key);
      if (!options.keepFiles && entry.descriptor?.storedName && entry.descriptor.restorable !== false) {
        storedNames.push(entry.descriptor.storedName);
      }
    }
    if (storedNames.length > 0) {
      releaseComposerAttachments(storedNames);
    }
    publish();
  }, [publish]);

  const reset = useCallback(() => {
    entriesRef.current.forEach((entry) => entry.abort.abort());
    entriesRef.current.clear();
    publish();
  }, [publish]);

  const getUpload = useCallback((key: string): ComposerUploadState | undefined => {
    const entry = entriesRef.current.get(key);
    if (!entry) {
      return undefined;
    }
    return {
      status: entry.status,
      progress: entry.progress,
      descriptor: entry.descriptor,
      error: entry.error,
    };
  }, []);

  const isUploading = Array.from(entriesRef.current.values()).some(
    (entry) => entry.status === 'uploading',
  );

  return {
    getUpload,
    track,
    ensureUploaded,
    release,
    reset,
    isUploading,
    // Bumped on every state change, so a consumer memo can depend on it.
    version: versionRef.current,
  };
}

/** A stable key for one picked file: the same paste/drag keeps the same key. */
export function composerAttachmentKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function findTrackedKey(entries: Map<string, UploadEntry>, file: File): string | undefined {
  const key = composerAttachmentKey(file);
  if (entries.has(key)) {
    return key;
  }
  for (const [candidateKey, entry] of entries) {
    if (entry.file === file) {
      return candidateKey;
    }
  }
  return undefined;
}

/**
 * Waits for the attempt in flight under `key` to settle.
 *
 * Polls rather than listening, because an attempt can be replaced (a retry, a
 * release) and the entry object is swapped under the same key. The poll is
 * cheap — a send waits at most while a transfer is actually running — and the
 * bound only stops a send from hanging on a request that never answers.
 *
 * Consumers: `ensureUploaded`, which runs on the send path.
 */
async function waitForSettled(
  entries: Map<string, UploadEntry>,
  key: string,
): Promise<UploadEntry | undefined> {
  const startedAt = Date.now();
  const timeoutMs = 2 * 60 * 1_000;
  for (;;) {
    const entry = entries.get(key);
    if (!entry || entry.status !== 'uploading') {
      return entry;
    }
    if (Date.now() - startedAt > timeoutMs) {
      return entry;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}
