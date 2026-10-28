import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

import type { PermissionMode } from '@/shared/types';

/**
 * One name per mode, for every harness.
 *
 * The defect this guards against: `bypassPermissions` was called "Unrestricted"
 * for WorkBuddy, "Bypass Permissions" for Codex and "无限制模式" for OpenCode, so
 * the same setting had three names depending on which panel drew it — and the
 * composer had a second, unrelated word for each of them.
 *
 * `permissions.modes` is the canonical table. A provider may override a title
 * only where the enum value genuinely means something else to it, which today
 * is `default` on the providers whose default is not the default.
 */

const MODES: PermissionMode[] = ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan', 'readonly'];

const RENAMED_DEFAULT = new Set(['dsh', 'omp', 'openclaw', 'pi', 'zcode']);

const LOCALES_DIR = path.resolve(process.cwd(), 'src/modules/i18n/locales');

type ModeEntry = { title?: string; description?: string };
type ProviderBlock = { modes?: Record<string, ModeEntry> };
type PermissionsBlock = Record<string, unknown>;

const locales = fs.readdirSync(LOCALES_DIR).filter((locale) =>
  fs.existsSync(path.join(LOCALES_DIR, locale, 'settings.json')),
);

const readPermissions = (locale: string): PermissionsBlock =>
  (JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'settings.json'), 'utf8')) as {
    permissions: PermissionsBlock;
  }).permissions;

const canonicalOf = (permissions: PermissionsBlock): Record<string, ModeEntry> =>
  (permissions.modes ?? {}) as Record<string, ModeEntry>;

/** Providers, i.e. every block that carries its own mode list. */
const providersOf = (permissions: PermissionsBlock): Array<[string, ProviderBlock]> =>
  Object.entries(permissions).filter(
    ([key, value]) => key !== 'modes' && typeof value === 'object' && value !== null && 'modes' in value,
  ) as Array<[string, ProviderBlock]>;

test('every locale names every mode once, in the shared table', () => {
  assert.ok(locales.length > 1, 'the locale directory should have been found');

  for (const locale of locales) {
    const canonical = canonicalOf(readPermissions(locale));

    for (const mode of MODES) {
      assert.ok(canonical[mode]?.title, `${locale} has no permissions.modes.${mode}.title`);
    }
  }
});

test('a provider renames a mode only where the mode means something else to it', () => {
  for (const locale of locales) {
    for (const [provider, block] of providersOf(readPermissions(locale))) {
      for (const [mode, entry] of Object.entries(block.modes ?? {})) {
        if (!entry?.title) continue;
        assert.ok(
          RENAMED_DEFAULT.has(provider) && mode === 'default',
          `${locale}: ${provider}.modes.${mode}.title gives a shared mode a second name`,
        );
      }
    }
  }
});

test('the canonical table covers exactly the modes the runtimes can report', () => {
  assert.deepEqual(Object.keys(canonicalOf(readPermissions('en'))).sort(), [...MODES].sort());
});
