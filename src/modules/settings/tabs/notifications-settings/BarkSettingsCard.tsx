import { useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { useBarkNotifications } from '@/modules/settings/hooks/useBarkNotifications';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

const LEVELS = ['active', 'timeSensitive', 'passive'] as const;

function maskKey(key: string): string {
  if (key.length <= 8) {
    return '••••';
  }
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * Accepts a raw key or a full `{server}/{key}` push URL. The URL form is what
 * the Bark app's share sheet produces, and keeping its path prefix means a
 * reversed-proxy deployment (`https://host/bark/<key>`) still works.
 */
function parseDeviceKeyInput(value: string): { serverUrl: string; deviceKey: string } {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const segments = url.pathname.split('/').filter(Boolean);
      const deviceKey = segments.at(-1) ?? '';
      if (deviceKey && deviceKey !== 'push') {
        const prefix = segments.slice(0, -1).join('/');
        return {
          serverUrl: `${url.origin}${prefix ? `/${prefix}` : ''}`,
          deviceKey,
        };
      }
    }
  } catch {
    // Not a URL: the input is the bare device key.
  }
  return { serverUrl: '', deviceKey: trimmed };
}

/**
 * The phone downloads the status icons from CloudCLI, so the useful default is
 * the address this page was opened with. A loopback address is never reachable
 * from the phone, and a non-HTTP origin (the shell's `capacitor://`) is not a
 * URL Bark can fetch, so both start empty and let the user fill it in.
 */
function defaultIconBaseUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const { origin, hostname } = window.location;
  if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
    return '';
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    return '';
  }
  return origin;
}

/**
 * Rendered by NotificationsSettingsTab. Manages this server's Bark endpoints:
 * a user can add several devices, disable one without deleting it, and send a
 * test push that surfaces Bark's own reply.
 */
export default function BarkSettingsCard() {
  const { t } = useTranslation('settings');
  const { endpoints, busy, error, testResult, save, remove, setEnabled, test } = useBarkNotifications();

  // In-progress form input. Kept local because it is not server state until
  // the user adds the device; clearing the key afterwards prevents a subsequent
  // "add another device" from reusing it by accident. The other fields stay so a
  // second device on the same server does not need them retyped.
  const [serverUrl, setServerUrl] = useState('');
  const [deviceKey, setDeviceKey] = useState('');
  const [label, setLabel] = useState('');
  const [group, setGroup] = useState('');
  const [sound, setSound] = useState('');
  const [level, setLevel] = useState<string>('active');
  const [iconBaseUrl, setIconBaseUrl] = useState(defaultIconBaseUrl);
  // Validation failure for the form itself, separate from transport/Bark errors.
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const parsedKey = parseDeviceKeyInput(deviceKey);
    const trimmedUrl = serverUrl.trim() || parsedKey.serverUrl;
    const trimmedKey = parsedKey.deviceKey;
    if (!trimmedUrl) {
      setFormError(t('notifications.bark.serverUrlRequired', {
        defaultValue: 'Bark server URL is required.',
      }));
      return;
    }
    if (!trimmedKey) {
      setFormError(t('notifications.bark.deviceKeyRequired', {
        defaultValue: 'Device key is required.',
      }));
      return;
    }

    const saved = await save({
      endpointId: trimmedKey,
      label: label.trim(),
      serverUrl: trimmedUrl,
      group: group.trim(),
      subtitle: '',
      sound: sound.trim(),
      level,
      iconBaseUrl: iconBaseUrl.trim(),
    });

    if (saved) {
      setDeviceKey('');
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <h4 className="font-medium text-foreground">
          {t('notifications.bark.title', { defaultValue: 'Bark push' })}
        </h4>
        <p className="text-sm text-muted-foreground">
          {t('notifications.bark.description', {
            defaultValue: 'Send notifications through your own Bark server so they arrive while the mobile app is in the background.',
          })}
        </p>
      </div>

      {endpoints.length > 0 && (
        <div className="space-y-2">
          {endpoints.map((endpoint) => (
            <div
              key={endpoint.endpointId}
              className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {endpoint.label || endpoint.metadata.serverUrl}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {endpoint.metadata.serverUrl} · {maskKey(endpoint.endpointId)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={endpoint.enabled}
                    disabled={busy}
                    onChange={(event) => {
                      void setEnabled(endpoint.endpointId, event.target.checked);
                    }}
                    className="h-4 w-4"
                  />
                  {t('notifications.bark.enabled', { defaultValue: 'Enabled' })}
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void test(endpoint.endpointId);
                  }}
                >
                  <Send className="h-4 w-4" />
                  {t('notifications.bark.test', { defaultValue: 'Test' })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void remove(endpoint.endpointId);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {t('notifications.bark.remove', { defaultValue: 'Remove' })}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form className="space-y-3" onSubmit={(event) => { void handleSubmit(event); }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t('notifications.bark.serverUrl', { defaultValue: 'Bark server URL' })}
            </span>
            <input
              className={inputClass}
              placeholder="https://bark.example.com"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              autoComplete="url"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t('notifications.bark.deviceKey', { defaultValue: 'Device key' })}
            </span>
            <input
              className={inputClass}
              placeholder={t('notifications.bark.deviceKeyPlaceholder', {
                defaultValue: 'Paste the key or the full push URL',
              })}
              value={deviceKey}
              onChange={(event) => setDeviceKey(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t('notifications.bark.deviceName', { defaultValue: 'Device name (optional)' })}
            </span>
            <input
              className={inputClass}
              placeholder={t('notifications.bark.deviceNamePlaceholder', { defaultValue: 'iPhone' })}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t('notifications.bark.group', { defaultValue: 'Notification group (optional)' })}
            </span>
            <input
              className={inputClass}
              placeholder="CloudCLI · Server A"
              value={group}
              onChange={(event) => setGroup(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t('notifications.bark.sound', { defaultValue: 'Sound (optional)' })}
            </span>
            <input
              className={inputClass}
              placeholder="minuet"
              value={sound}
              onChange={(event) => setSound(event.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {t('notifications.bark.level', { defaultValue: 'Interruption level' })}
            </span>
            <select
              className={inputClass}
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            >
              {LEVELS.map((value) => (
                <option key={value} value={value}>
                  {t(`notifications.bark.levels.${value}`, { defaultValue: value })}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-sm font-medium text-foreground">
              {t('notifications.bark.iconBaseUrl', { defaultValue: 'Icon base URL (optional)' })}
            </span>
            <input
              className={inputClass}
              placeholder="http://192.168.1.5:3001"
              value={iconBaseUrl}
              onChange={(event) => setIconBaseUrl(event.target.value)}
              autoComplete="url"
            />
            <span className="block text-xs text-muted-foreground">
              {t('notifications.bark.iconBaseUrlHint', {
                defaultValue: 'Use the address your phone opens CloudCLI at; the status icons are fetched from it. Leave empty for Bark\u2019s default icon.',
              })}
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('notifications.bark.add', { defaultValue: 'Add device' })}
          </Button>
          {endpoints.length === 0 && (
            <span className="text-xs text-muted-foreground">
              {t('notifications.bark.empty', { defaultValue: 'No Bark device configured yet.' })}
            </span>
          )}
        </div>
      </form>

      {formError && (
        <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
      )}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {testResult && (
        <p className={testResult.ok ? 'text-sm text-green-600 dark:text-green-400' : 'text-sm text-red-600 dark:text-red-400'}>
          {testResult.ok
            ? t('notifications.bark.testOk', { defaultValue: 'Bark accepted the test notification.' })
            : t('notifications.bark.testFailed', {
              defaultValue: 'Bark rejected the test: {{message}}',
              message: testResult.message,
            })}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {t('notifications.bark.note', {
          defaultValue: 'The device key is stored on this server and sent only to the Bark server above. Use HTTPS if that server is not on a trusted network.',
        })}
      </p>
    </div>
  );
}
