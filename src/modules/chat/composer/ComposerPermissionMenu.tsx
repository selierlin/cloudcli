import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { LLMProvider, PermissionMode } from '@/shared/types';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { usePermissionNameFit } from '@/modules/chat/hooks/usePermissionNameFit';
import { PROVIDER_PERMISSION_PREFERENCE_KEYS } from '@/shared/constants';
import { usePermissionModeCopy } from '@/shared/hooks/usePermissionModeCopy';
import { getPermissionModeAppearance, PERMISSION_MODE_ACCENT_CLASSES } from '@/shared/permissionModeAppearance';
import { readUserPreference } from '@/shared/userSettings';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

/**
 * The mode's icon, name, description and accent come from the shared
 * appearance/copy modules, so the same mode reads identically here and in
 * settings. The accent's colours are shared too — the menu only adds hover to
 * the same surface the settings card uses.
 */

/**
 * Whether the settings' "skip permissions" toggle will override the mode
 * picked here. Claude and cursor runtimes force bypass under it; for every
 * other provider the toggle is inert, so there is nothing to announce.
 *
 * Read during render rather than passed down: this menu is memoized, so the
 * read costs one preference parse per menu render, and the hint is
 * informational — a stale one until the next menu render is harmless.
 */
const isModeOverriddenBySettings = (provider: LLMProvider | string | undefined): boolean => {
  if (provider !== 'claude' && provider !== 'cursor') {
    return false;
  }

  return Boolean(
    readUserPreference<{ skipPermissions?: boolean }>(PROVIDER_PERMISSION_PREFERENCE_KEYS[provider], {}).skipPermissions,
  );
};

type ComposerPermissionMenuProps = {
  permissionMode: PermissionMode;
  /** Modes the active provider supports, in the order the backend reports them. */
  permissionModes: PermissionMode[];
  onSelectPermissionMode: (mode: PermissionMode) => void;
  providerLabel: string;
  /** Provider id, used to look up the provider's own mode names and descriptions. */
  provider?: LLMProvider | string;
};

/**
 * Rendered by chat's ChatComposer as the popover for choosing the permission
 * mode the active provider runs the next turn under.
 */
function ComposerPermissionMenu({
  permissionMode,
  permissionModes,
  onSelectPermissionMode,
  providerLabel,
  provider,
}: ComposerPermissionMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 22 * 16);
  const activeModeLabel = usePermissionModeCopy(provider, permissionMode).label;
  // The name is shown only where the composer has room for it, so it never
  // pushes the model menu and the send button onto a second row. Plan mode,
  // the one that changes nothing, keeps its name wherever it fits inside the
  // composer, even when that gives the controls a row of their own.
  const isNameShown = usePermissionNameFit(
    triggerRef,
    permissionModes.length > 0 ? activeModeLabel : null,
    permissionMode === 'plan',
  );

  if (permissionModes.length === 0) {
    return null;
  }

  const activeAppearance = getPermissionModeAppearance(permissionMode);
  const activeAccent = PERMISSION_MODE_ACCENT_CLASSES[activeAppearance.accent];
  const ActiveIcon = activeAppearance.icon;
  const heading = t('composer.permissionHeading', {
    provider: providerLabel,
    defaultValue: 'How should {{provider}} actions be approved?',
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className={`flex h-8 min-w-8 max-w-40 shrink-0 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors sm:max-w-48 ${isNameShown ? 'px-2' : 'w-8'} ${activeAccent.surface} ${activeAccent.foreground} ${activeAccent.hover}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        // The mode name leads the accessible name, so what a screen reader
        // announces starts with what the button shows.
        aria-label={t('composer.permissionTriggerLabel', {
          mode: activeModeLabel,
          heading,
          defaultValue: '{{mode}}: {{heading}}',
        })}
        title={t('input.clickToChangeMode')}
      >
        <ActiveIcon className="h-4 w-4 shrink-0" />
        {/* Named, not just drawn: the mode decides what the next message may change. */}
        {isNameShown && <span className="truncate">{activeModeLabel}</span>}
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={heading}>
          <ComposerMenuHeading>{heading}</ComposerMenuHeading>
          {permissionModes.map((mode) => (
            <PermissionMenuItem
              key={mode}
              mode={mode}
              provider={provider}
              isSelected={mode === permissionMode}
              onSelect={() => {
                onSelectPermissionMode(mode);
                setIsOpen(false);
              }}
            />
          ))}
          {permissionMode !== 'plan' && isModeOverriddenBySettings(provider) && (
            <ComposerMenuHeading>
              {t('composer.skipPermissionsOverride', {
                defaultValue: 'Settings has "Skip permissions" on, so this turn runs with Full access.',
              })}
            </ComposerMenuHeading>
          )}
          <ComposerMenuHeading>
            {t('composer.permissionCycleHint', { defaultValue: 'Press Tab in the message box to switch modes' })}
          </ComposerMenuHeading>
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

type PermissionMenuItemProps = {
  mode: PermissionMode;
  provider?: LLMProvider | string;
  isSelected: boolean;
  onSelect: () => void;
};

/** Its own component so each row can look up its copy: hooks cannot run inside the menu's map. */
function PermissionMenuItem({ mode, provider, isSelected, onSelect }: PermissionMenuItemProps) {
  const { label, description } = usePermissionModeCopy(provider, mode);
  const appearance = getPermissionModeAppearance(mode);
  const ModeIcon = appearance.icon;

  return (
    <ComposerMenuItem
      icon={<ModeIcon className="h-4 w-4" />}
      label={label}
      description={description || undefined}
      isSelected={isSelected}
      onSelect={onSelect}
      className={PERMISSION_MODE_ACCENT_CLASSES[appearance.accent].label}
    />
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerPermissionMenu);
