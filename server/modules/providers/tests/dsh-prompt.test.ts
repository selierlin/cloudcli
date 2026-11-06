import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { AcpRequestError } from '@/modules/providers/shared/acp/acp.client.js';
import { buildDshPromptBlocks, isAcpImageRejection } from '@/modules/providers/list/dsh/dsh-prompt.js';

// 1x1 transparent PNG, enough for a canonical-base64 round trip.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Creates a temp working directory holding the named files, used as the allowed root. */
async function fixture(files: Record<string, Buffer | string>): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'dsh-prompt-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(cwd, name), content);
  }
  return cwd;
}

test('buildDshPromptBlocks inlines an image as a canonical base64 block', async () => {
  const cwd = await fixture({ 'shot.png': Buffer.from(PNG_BASE64, 'base64') });

  const blocks = await buildDshPromptBlocks('what is this', [{ path: 'shot.png' }], cwd);

  assert.deepEqual(blocks, [
    { type: 'text', text: 'what is this' },
    { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
  ]);
});

test('buildDshPromptBlocks sends a non-image file as a path reference', async () => {
  const cwd = await fixture({ 'notes.pdf': 'not really a pdf' });
  // The reference carries the resolved path: /var is /private/var on macOS.
  const canonical = await realpath(path.join(cwd, 'notes.pdf'));

  const blocks = await buildDshPromptBlocks('read this', [{ path: 'notes.pdf', name: 'notes.pdf' }], cwd);

  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[1], {
    type: 'resource_link',
    name: 'notes.pdf',
    uri: pathToFileURL(canonical).href,
  });
});

test('buildDshPromptBlocks does not inline an SVG, which the bridge cannot decode', async () => {
  const cwd = await fixture({ 'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' });

  const blocks = await buildDshPromptBlocks('look', [{ path: 'icon.svg' }], cwd);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].type, 'resource_link');
});

test('buildDshPromptBlocks degrades images to path references when inlining is off', async () => {
  const cwd = await fixture({ 'shot.png': Buffer.from(PNG_BASE64, 'base64') });

  const blocks = await buildDshPromptBlocks('what is this', [{ path: 'shot.png' }], cwd, { inlineImages: false });

  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].type, 'resource_link');
});

test('buildDshPromptBlocks drops an attachment outside the run roots', async () => {
  const cwd = await fixture({});
  const outside = await fixture({ 'secret.png': Buffer.from(PNG_BASE64, 'base64') });

  const blocks = await buildDshPromptBlocks('look', [{ path: path.join(outside, 'secret.png') }], cwd);

  assert.deepEqual(blocks, [{ type: 'text', text: 'look' }]);
});

test('isAcpImageRejection only matches the ACP errors an image block can cause', () => {
  assert.equal(isAcpImageRejection(new AcpRequestError('model "x" does not declare image input')), true);
  assert.equal(
    isAcpImageRejection(new AcpRequestError('Internal error', { details: 'image data must be canonical base64' })),
    true,
  );
  assert.equal(isAcpImageRejection(new AcpRequestError('Unknown session')), false);
  assert.equal(isAcpImageRejection(new Error('image')), false);
  // A model-side refusal is not fixable by re-sending a path reference.
  assert.equal(
    isAcpImageRejection(new AcpRequestError('image_url is not supported by this model')),
    false,
  );
});
