import { api } from '@/shared/api';
import { expireAuthSession, getStoredAuthToken, storeAuthToken } from '@/shared/authToken';
import { IS_PLATFORM } from '@/shared/utils';
import type { ChatAttachment } from '@/shared/types';

/**
 * Uploads composer attachments with progress and cancellation.
 *
 * The chat composer uploads as soon as a file is picked or pasted, so the file
 * is already stored by the time the user sends. A plain `fetch` gives no
 * progress and no way to stop a request whose attachment the user just
 * removed, so this goes through `XMLHttpRequest` — the same approach the file
 * tree's uploader takes. The auth headers are mirrored from `authenticatedFetch`
 * because that helper only serves `fetch`.
 *
 * Consumers: the chat composer's attachment hook, for picked, pasted and
 * dropped files.
 */
export function uploadComposerAttachments(
  files: File[],
  options: {
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ChatAttachment[]> {
  if (files.length === 0) {
    return Promise.resolve([]);
  }

  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));

  return new Promise<ChatAttachment[]>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/assets/files');
    xhr.responseType = 'text';

    const token = getStoredAuthToken();
    if (!IS_PLATFORM && token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        return;
      }
      // 100% stays reserved for the server's answer, so the caller can tell a
      // finished transfer from a stored file.
      options.onProgress?.(Math.min(0.99, event.loaded / event.total));
    };

    const abort = () => xhr.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => options.signal?.removeEventListener('abort', abort);

    xhr.onload = () => {
      cleanup();
      const refreshedToken = xhr.getResponseHeader('X-Refreshed-Token');
      if (refreshedToken) {
        storeAuthToken(refreshedToken);
      }
      if (xhr.getResponseHeader('X-Auth-Error')) {
        expireAuthSession();
      }

      let body: { attachments?: ChatAttachment[]; error?: string } | null = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(body?.error || `Upload failed (${xhr.status})`));
        return;
      }
      if (!Array.isArray(body?.attachments) || body.attachments.length !== files.length) {
        reject(new Error('File upload returned an incomplete result'));
        return;
      }
      options.onProgress?.(1);
      resolve(body.attachments);
    };

    xhr.onerror = () => {
      cleanup();
      reject(new Error('Upload failed. Check your connection and try again.'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };

    xhr.send(formData);
  });
}

/**
 * Releases stored uploads the composer no longer holds (an attachment removed,
 * a message discarded). Fire-and-forget by design: the server also sweeps
 * abandoned uploads, so a failed release only postpones the cleanup. Consumers:
 * the chat composer's attachment hook.
 */
export function releaseComposerAttachments(storedNames: string[]): void {
  const names = storedNames.filter((name) => typeof name === 'string' && name.trim() !== '');
  if (names.length === 0) {
    return;
  }
  void api.assets.releaseFiles(names).catch(() => undefined);
}
