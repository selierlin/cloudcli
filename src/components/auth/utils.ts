import type { ApiErrorPayload } from './types';

export async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function resolveApiErrorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  if (typeof payload.error === 'string') {
    return payload.error;
  }

  // Backend may nest the message inside `error` as an object (e.g. { code, message })
  return payload.error?.message ?? payload.message ?? fallback;
}
