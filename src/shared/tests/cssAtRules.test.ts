import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { containsImportAtRule } from '@/shared/cssAtRules';
import { IMPORT_GATE_VECTORS } from '@/shared/tests/cssImportVectors';

/**
 * The `@import` gate's scanner, against the shared vector list (§5.8 v8).
 *
 * The point of importing `IMPORT_GATE_VECTORS` rather than writing cases here
 * is the two-gate rule: the server's file scan runs the same list, so a vector
 * added for one side is exercised on the other or a test somewhere goes red.
 */
describe('containsImportAtRule', () => {
  for (const { css, expect, why } of IMPORT_GATE_VECTORS) {
    test(`${why}: ${JSON.stringify(css)}`, () => {
      assert.equal(containsImportAtRule(css), expect);
    });
  }
});
