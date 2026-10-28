import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

import { PROVIDER_SPECIFIC_MODE_NAMES } from '@/shared/permissionModes';
import type { PermissionMode } from '@/shared/types';

/**
 * Names are shared, except where sharing them would lie.
 *
 * The defect this guards against: `bypassPermissions` was called "Unrestricted"
 * for WorkBuddy, "Bypass Permissions" for Codex and "无限制模式" for OpenCode, so
 * the same switch had three names depending on which panel drew it — and the
 * composer had a second, unrelated word for each of them.
 *
 * The opposite defect is just as bad: `auto` means a model classifier in
 * Claude, in-process approval in WorkBuddy and an ACP "allow once" answer in
 * DSH/OpenClaw. Calling all three "Auto" hid three different mechanisms behind
 * one word. So `permissions.modes` is the canonical table, and the pairs in
 * `PROVIDER_SPECIFIC_MODE_NAMES` are the only ones allowed to rename a mode.
 */

const MODES: PermissionMode[] = ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan', 'readonly'];

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

const isDeclared = (provider: string, mode: string): boolean => {
  const declared = (PROVIDER_SPECIFIC_MODE_NAMES as Record<string, readonly string[]>)[provider];
  return declared?.includes(mode) ?? false;
};

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
          isDeclared(provider, mode),
          `${locale}: ${provider}.modes.${mode}.title renames a shared mode without a declared reason`,
        );
      }
    }
  }
});

test('every declared rename is used, so the table cannot outlive its reason', () => {
  const permissions = readPermissions('en');

  for (const [provider, modes] of Object.entries(PROVIDER_SPECIFIC_MODE_NAMES)) {
    const renamed = providersOf(permissions).find(([name]) => name === provider)?.[1].modes ?? {};

    for (const mode of modes) {
      assert.ok(
        renamed[mode]?.title,
        `PROVIDER_SPECIFIC_MODE_NAMES declares ${provider}.${mode}, but en has no title for it`,
      );
    }
  }
});

test('the canonical table covers exactly the modes the runtimes can report', () => {
  assert.deepEqual(Object.keys(canonicalOf(readPermissions('en'))).sort(), [...MODES].sort());
});
