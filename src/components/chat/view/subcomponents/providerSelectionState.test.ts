import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldShowProviderSelection } from './providerSelectionState';

test('shows the provider picker when a new session still has a stale local session ID', () => {
  assert.equal(shouldShowProviderSelection(null, 'stale-session-id'), true);
});
