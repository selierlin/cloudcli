import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWatcherChange } from '@/modules/providers/services/sessions-watcher.service.js';

test('an add is always new content', () => {
  assert.equal(classifyWatcherChange('add', null), 'content');
  assert.equal(classifyWatcherChange('add', false), 'content');
  assert.equal(classifyWatcherChange('add', true), 'content');
});

test('a change defers to the content-level signal', () => {
  assert.equal(classifyWatcherChange('change', true), 'content');
  assert.equal(classifyWatcherChange('change', false), 'metadata');
});

test('a change whose provider cannot tell is treated as content, not swallowed', () => {
  // null is "cannot tell" — keep the pre-signal behaviour so a possible new
  // message is never dropped from the sidebar's unread indicator.
  assert.equal(classifyWatcherChange('change', null), 'content');
});
