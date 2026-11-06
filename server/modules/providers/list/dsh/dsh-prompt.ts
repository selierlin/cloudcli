import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { AcpRequestError, type AcpPromptBlock } from '@/modules/providers/shared/acp/acp.client.js';
import {
  isAllowedImageSourcePath,
  normalizeAttachmentDescriptors,
  resolveImageAbsolutePath,
  resolveImageMediaType,
  type ChatAttachmentDescriptor,
} from '@/shared/image-attachments.js';

/**
 * Turns CloudCLI's chat attachments into an ACP content-block list.
 *
 * DSH accepts images as inline base64 blocks and everything else only as a
 * `resource_link` (which the server renders into the prompt as a bracketed path
 * line); inline `resource` blocks are refused. Media types outside the four the
 * bridge decodes are therefore sent as links rather than failing the turn.
 */

/** Media types the DSH ACP bridge decodes into an inline image block. */
const ACP_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export type DshPromptOptions = {
  /** Inline image bytes; `false` sends every attachment as a path reference. */
  inlineImages: boolean;
};

/**
 * Resolves an attachment to the path the model will see, enforcing the same
 * trust boundary as the other providers: only the upload store or the run's
 * working directory, checked again after following symlinks.
 */
const resolveTrustedPath = async (
  descriptor: ChatAttachmentDescriptor,
  cwd: string,
): Promise<{ path: string; name: string } | null> => {
  const resolvedPath = resolveImageAbsolutePath(cwd, descriptor.path);
  if (!isAllowedImageSourcePath(resolvedPath, cwd)) {
    console.warn(`[DSH] Refusing to send attachment outside allowed roots: ${descriptor.path}`);
    return null;
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(resolvedPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[DSH] Dropping attachment that is not readable: ${descriptor.path} (${message})`);
    return null;
  }
  if (!isAllowedImageSourcePath(canonicalPath, cwd)) {
    console.warn(`[DSH] Refusing to send symlinked attachment outside allowed roots: ${descriptor.path}`);
    return null;
  }
  return { path: canonicalPath, name: descriptor.name ?? path.basename(canonicalPath) };
};

/** Reads one image into a block, or returns null when it cannot be inlined. */
const readInlineImage = async (
  canonicalPath: string,
  mediaType: string,
): Promise<AcpPromptBlock | null> => {
  try {
    const bytes = await readFile(canonicalPath);
    return { type: 'image', mimeType: mediaType, data: bytes.toString('base64') };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[DSH] Failed to read image ${canonicalPath}: ${message}`);
    return null;
  }
};

/**
 * Builds the `session/prompt` payload for one turn: the user's text, then the
 * attachments in the order the composer listed them.
 *
 * Consumers: `dsh-runtime.provider.ts` (the `run()` turn it sends over ACP).
 */
export async function buildDshPromptBlocks(
  command: string,
  attachments: unknown,
  cwd: string,
  options: DshPromptOptions = { inlineImages: true },
): Promise<AcpPromptBlock[]> {
  const blocks: AcpPromptBlock[] = [{ type: 'text', text: command }];

  for (const descriptor of normalizeAttachmentDescriptors(attachments)) {
    if (!descriptor.path.trim()) {
      continue;
    }
    const trusted = await resolveTrustedPath(descriptor, cwd);
    if (!trusted) {
      continue;
    }

    const mediaType = resolveImageMediaType(descriptor);
    if (options.inlineImages && mediaType && ACP_IMAGE_MEDIA_TYPES.has(mediaType)) {
      const image = await readInlineImage(trusted.path, mediaType);
      if (image) {
        blocks.push(image);
        continue;
      }
    }

    blocks.push({ type: 'resource_link', name: trusted.name, uri: pathToFileURL(trusted.path).href });
  }

  return blocks;
}

/**
 * True when the ACP child refused the turn because of the image blocks.
 *
 * DSH re-checks image support against the *session's* model route at prompt
 * time, while it advertises `promptCapabilities.image` from the profile's
 * default model at `initialize`. Picking a text-only model in CloudCLI
 * therefore gets an image-capable connection that still rejects the turn.
 * Retrying is safe: admission runs before the message is queued, so a rejected
 * prompt leaves the session unchanged.
 *
 * Consumers: `dsh-runtime.provider.ts`, deciding whether to retry a turn with
 * path references instead of inline images.
 */
export function isAcpImageRejection(error: unknown): boolean {
  if (!(error instanceof AcpRequestError)) {
    return false;
  }
  // Only the bridge's own admission/decoding refusals: those are fixable by
  // re-sending the attachment as a path. A model-side rejection ("this model
  // cannot read images") would fail the retry too, so it must not match.
  return /does not declare image input|image data must be|image prompts? are not supported/i.test(
    `${error.message} ${error.details ?? ''}`,
  );
}
