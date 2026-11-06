import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Decodes the session-log encodings providers write to disk.
 *
 * DSH persists a session as `<sessions-root>/<project-key>/<session-id>/
 * session[.vN].jsonl.zstd`: a concatenation of independent Zstandard frames
 * (one header frame plus one frame per append batch). Every other provider
 * writes plaintext JSONL. Consumers: the DSH session adapter and the asset
 * collector, which has to read the same bytes to know what a transcript
 * references.
 */

const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Decodes a concatenated-zstd session log into its logical JSONL lines. */
export function decodeZstdFrames(buffer: Buffer): string {
  let text = '';
  let index = buffer.indexOf(ZSTD_FRAME_MAGIC);
  while (index !== -1) {
    const next = buffer.indexOf(ZSTD_FRAME_MAGIC, index + ZSTD_FRAME_MAGIC.length);
    const frame = buffer.subarray(index, next === -1 ? buffer.length : next);
    try {
      text += zlib.zstdDecompressSync(frame).toString('utf8');
    } catch {
      // A corrupt frame ends the readable prefix; keep the frames decoded so far.
    }
    index = next;
  }
  return text;
}

/**
 * Decodes one session-log buffer into its logical JSONL text. A root uses a
 * single physical encoding for every generation: `.jsonl.zstd` holds
 * concatenated Zstandard frames, while a `compression: 'none'` root holds
 * plaintext lines.
 */
export function decodeSessionLogBuffer(buffer: Buffer, logPath: string): string {
  return path.basename(logPath).endsWith('.zstd')
    ? decodeZstdFrames(buffer)
    : buffer.toString('utf8');
}
