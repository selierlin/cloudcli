import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { FileCode2, FileJson, FolderOpen, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { PROVIDER_MODELS_CHANGED_EVENT } from '@/shared/constants';
import { Button, Input } from '@/shared/ui';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';

/** Providers that own a config-file source; mirrors the backend scan rules. */
type ProviderConfigSource = 'claude' | 'codex';

type ProviderSettingsSourceSectionProps = {
  provider: ProviderConfigSource;
};

type SettingsSourceProfile = {
  name: string;
  path: string;
};

type SettingsSourcePayload = {
  directory: string | null;
  activeFile: string | null;
  profiles: SettingsSourceProfile[];
  directoryError: string | null;
};

type ProviderConfigSourceCopy = {
  title: string;
  description: string;
  directoryHint: string;
  activeHint: string;
};

/**
 * Fallback copy per provider, used when the active locale has no entry yet.
 *
 * Claude is pointed at its file per run (`--settings <path>`); Codex has no
 * usable passthrough for that through the SDK, so its file is read and layered
 * over `~/.codex/config.toml` as `-c` overrides.
 */
const FALLBACK_COPY: Record<ProviderConfigSource, ProviderConfigSourceCopy> = {
  claude: {
    title: 'Settings file (claude --settings)',
    description:
      'Load a user-maintained Claude settings JSON on every run — useful for pointing at a relay (ANTHROPIC_BASE_URL, auth token, custom model). CloudCLI only stores paths; keep the file contents yourself.',
    directoryHint:
      'Every settings-*.json (or setting-*.json) in this directory is listed below as a profile.',
    activeHint: 'The selected file is loaded on every Claude run, equivalent to passing --settings.',
  },
  codex: {
    title: 'Config file (Codex -c overrides)',
    description:
      'Layer a user-maintained Codex config TOML over ~/.codex/config.toml on every run — useful for switching relays (base URL, auth token, custom model). CloudCLI only stores paths; keep the file contents yourself.',
    directoryHint: 'Every config-*.toml in this directory is listed below as a profile; config.toml itself is never listed.',
    activeHint: 'The selected file is layered over ~/.codex/config.toml as -c overrides on every Codex run.',
  },
};

const SELECT_CLASS =
  'w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/**
 * Config-file source picker for a provider (`claude --settings` equivalent).
 *
 * Lets the user point every run of the provider at one of their own config
 * files — typically one per relay (base URL, auth token, default model). The
 * optional directory is scanned for that provider's profile naming convention
 * so nothing has to be registered by hand; CloudCLI persists only the directory
 * and the active file path, never file contents.
 *
 * Used by AgentCategoryContentSection for claude and codex.
 */
export default function ProviderSettingsSourceSection({ provider }: ProviderSettingsSourceSectionProps) {
  const { t } = useTranslation('settings');
  const fallback = FALLBACK_COPY[provider];
  const SourceIcon = provider === 'claude' ? FileJson : FileCode2;
  const [source, setSource] = useState<SettingsSourcePayload | null>(null);
  const [directoryInput, setDirectoryInput] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = t(`agents.settingsSource.title.${provider}`, { defaultValue: fallback.title });

  const load = useCallback(async () => {
    try {
      const response = await api.providers.settingsSource(provider);
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      const body = (await response.json()) as { data?: SettingsSourcePayload };
      const data = body?.data ?? {
        directory: null,
        activeFile: null,
        profiles: [],
        directoryError: null,
      };
      setSource(data);
      setDirectoryInput(data.directory ?? '');
      setCustomPath('');
      setError(null);
    } catch (cause) {
      console.error('Failed to load the provider config source:', cause);
      setError(t('agents.settingsSource.loadError', { defaultValue: 'Failed to load the config source.' }));
    } finally {
      setLoading(false);
    }
  }, [provider, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (input: { directory?: string; activeFile?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.providers.updateSettingsSource(provider, input);
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      const body = (await response.json()) as { data?: SettingsSourcePayload };
      if (body?.data) {
        setSource(body.data);
        setDirectoryInput(body.data.directory ?? '');
      }
      // The active config file can carry model mappings, so the catalog the
      // chat composer cached at mount is now stale. The settings panel is a
      // portal over an always-mounted chat, so no remount will pick this up.
      window.dispatchEvent(new Event(PROVIDER_MODELS_CHANGED_EVENT));
    } catch (cause) {
      console.error('Failed to save the provider config source:', cause);
      setError(t('agents.settingsSource.saveError', { defaultValue: 'Failed to save the config source.' }));
    } finally {
      setBusy(false);
    }
  }, [provider, t]);

  const handleSaveDirectory = () => {
    void save({ directory: directoryInput.trim() });
  };

  const handleActiveChange = (event: ChangeEvent<HTMLSelectElement>) => {
    void save({ activeFile: event.target.value });
  };

  const handleApplyCustomPath = () => {
    void save({ activeFile: customPath.trim() });
  };

  // Keeps the focused field visible above the on-screen keyboard. Mirrors the
  // sidebar rename-input fix: on focus, and again on every keyboard resize,
  // scroll the active input back into view (`block: 'nearest'` so an already
  // visible field is not yanked to mid-screen where iOS hides it).
  const focusedFieldRef = useRef<HTMLElement | null>(null);

  const handleFieldFocus = useCallback((event: FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    focusedFieldRef.current = event.currentTarget;
    requestAnimationFrame(() => {
      if (document.activeElement === event.currentTarget) {
        event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
  }, []);

  const handleFieldBlur = useCallback(() => {
    focusedFieldRef.current = null;
  }, []);

  useEffect(() => {
    let raf = 0;
    const reveal = () => {
      const field = focusedFieldRef.current;
      if (!field || document.activeElement !== field) {
        return;
      }
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        if (document.activeElement === field) {
          field.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
    };

    const isNativeShell = Boolean(
      (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor?.isNativePlatform?.(),
    );

    if (isNativeShell) {
      let disposed = false;
      const handles: Array<{ remove: () => Promise<void> }> = [];
      void Keyboard.addListener('keyboardWillShow', reveal).then((handle) => {
        if (disposed) void handle.remove(); else handles.push(handle);
      });
      void Keyboard.addListener('keyboardDidShow', reveal).then((handle) => {
        if (disposed) void handle.remove(); else handles.push(handle);
      });
      return () => {
        disposed = true;
        handles.forEach((handle) => void handle.remove());
        window.cancelAnimationFrame(raf);
      };
    }

    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return undefined;
    }
    visualViewport.addEventListener('resize', reveal);
    return () => {
      visualViewport.removeEventListener('resize', reveal);
      window.cancelAnimationFrame(raf);
    };
  }, []);

  if (loading) {
    return (
      <SettingsSection title={title}>
        <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('agents.settingsSource.saving', { defaultValue: 'Saving…' })}</span>
        </div>
      </SettingsSection>
    );
  }

  const activePath = source?.activeFile ?? '';
  const profiles = source?.profiles ?? [];
  const activeInProfiles = profiles.some((profile) => profile.path === activePath);
  const showCustomEntry = profiles.length === 0;

  return (
    <SettingsSection title={title}>
      <SettingsCard divided>
        <div className="flex items-center gap-3 p-4">
          <SourceIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t(`agents.settingsSource.description.${provider}`, { defaultValue: fallback.description })}
          </p>
        </div>

        {/* Config directory */}
        <div className="border-t border-border/60 p-4">
          <label className="text-sm font-medium text-foreground">
            {t('agents.settingsSource.directoryLabel', { defaultValue: 'Config directory' })}
          </label>
          <div className="mt-1 flex gap-2">
            <Input
              value={directoryInput}
              onChange={(event) => setDirectoryInput(event.target.value)}
              onFocus={handleFieldFocus}
              onBlur={handleFieldBlur}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSaveDirectory();
                }
              }}
              placeholder="/absolute/path/to/relay-configs"
              className="flex-1"
            />
            <Button onClick={handleSaveDirectory} disabled={busy} className="shrink-0" size="sm">
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FolderOpen className="mr-2 h-4 w-4" />
              )}
              {t('agents.settingsSource.saveDirectory', { defaultValue: 'Scan directory' })}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`agents.settingsSource.directoryHint.${provider}`, { defaultValue: fallback.directoryHint })}
          </p>
          {source?.directoryError && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{source.directoryError}</p>
          )}
        </div>

        {/* Active config file */}
        <div className="border-t border-border/60 p-4">
          <label className="text-sm font-medium text-foreground">
            {t('agents.settingsSource.activeLabel', { defaultValue: 'Active config file' })}
          </label>
          {profiles.length > 0 ? (
            <select
              value={activePath}
              onChange={handleActiveChange}
              onFocus={handleFieldFocus}
              onBlur={handleFieldBlur}
              className={`mt-1 ${SELECT_CLASS}`}
            >
              <option value="">
                {t('agents.settingsSource.activeNone', { defaultValue: 'None (use default config)' })}
              </option>
              {activePath && !activeInProfiles && (
                <option value={activePath}>{activePath}</option>
              )}
              {profiles.map((profile) => (
                <option key={profile.path} value={profile.path}>
                  {profile.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-1">
              <p className="text-sm text-muted-foreground">
                {t('agents.settingsSource.activeNone', { defaultValue: 'None (use default config)' })}
              </p>
              {activePath && (
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {t('agents.settingsSource.current', { path: activePath })}
                </p>
              )}
            </div>
          )}
          {profiles.length > 0 && activePath && (
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {t('agents.settingsSource.current', { path: activePath })}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`agents.settingsSource.activeHint.${provider}`, { defaultValue: fallback.activeHint })}
          </p>

          {/* Manual path fallback (single file, no directory) */}
          {showCustomEntry && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <label className="text-sm font-medium text-foreground">
                {t('agents.settingsSource.customPathLabel', {
                  defaultValue: 'Or point at a single config file',
                })}
              </label>
              <div className="mt-1 flex gap-2">
                <Input
                  value={customPath}
                  onChange={(event) => setCustomPath(event.target.value)}
                  onFocus={handleFieldFocus}
                  onBlur={handleFieldBlur}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      handleApplyCustomPath();
                    }
                  }}
                  placeholder={provider === 'claude' ? '/absolute/path/to/relay-settings.json' : '/absolute/path/to/relay-config.toml'}
                  className="flex-1"
                />
                <Button onClick={handleApplyCustomPath} disabled={busy} className="shrink-0" size="sm">
                  {t('agents.settingsSource.applyPath', { defaultValue: 'Apply' })}
                </Button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="border-t border-border/60 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </SettingsCard>
    </SettingsSection>
  );
}
