import assert from 'node:assert/strict';

import { test } from 'vitest';

import { forkFailureMessageKey } from '@/modules/chat/utils/forkFailureMessage';

test('ZCode workspace-rewind refusals get their own message', () => {
  assert.equal(forkFailureMessageKey('FORK_WOULD_REWIND_WORKSPACE'), 'message.forkWorkspaceRewind');
});

test('every other refusal code falls back to the generic message', () => {
  // The other codes the fork route can answer with, plus the shapes a failed
  // response can carry instead of a code (a plain network/parse error).
  for (const code of [
    'FORK_ANCHOR_NOT_FOUND',
    'FORK_SOURCE_NOT_READY',
    'FORK_SOURCE_UNREADABLE',
    'INTERNAL_ERROR',
    undefined,
    null,
    'fork_would_rewind_workspace',
  ]) {
    assert.equal(forkFailureMessageKey(code), 'message.forkFailed');
  }
});
