import { useCallback, useEffect, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { Button, Input } from '@/shared/ui';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';

type ProxyPayload = {
  proxyUrl: string | null;
};

/**
 * Global network proxy used by CloudCLI and every agent CLI it spawns.
 *
 * One machine-level URL. Leaving it blank makes sessions go direct and also
 * clears any proxy variable inherited from the shell that launched the server.
 * Saving applies from the next spawned session onward — a running session keeps
 * the environment it started with.
 */
export default function NetworkSettingsTab() {
  const { t } = useTranslation('settings');

  // Draft URL bound to the field; only persisted when the user saves.
  const [proxyUrl, setProxyUrl] = useState('');
  // True until the stored value is read, so saves cannot race the initial load.
  const [loading, setLoading] = useState(true);
  // True while a save is in flight, to block duplicate submits.
  const [busy, setBusy] = useState(false);
  // Load/save failure surfaced inline so the form keeps the user's input.
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.network.proxy();
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      const body = (await response.json()) as { data?: ProxyPayload };
      setProxyUrl(body?.data?.proxyUrl ?? '');
      setError(null);
    } catch (cause) {
      console.error('Failed to load the global proxy setting:', cause);
      setError(t('network.loadError', { defaultValue: 'Failed to load the proxy setting.' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.network.updateProxy({ proxyUrl: proxyUrl.trim() });
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      const body = (await response.json()) as { data?: ProxyPayload };
      // Echo the server's normalized value so the field reflects what was stored.
      setProxyUrl(body?.data?.proxyUrl ?? '');
    } catch (cause) {
      console.error('Failed to save the global proxy setting:', cause);
      setError(t('network.saveError', { defaultValue: 'Failed to save the proxy setting.' }));
    } finally {
      setBusy(false);
    }
  }, [proxyUrl, t]);

  return (
    <SettingsSection
      title={t('network.title', { defaultValue: 'Network' })}
      description={t('network.description', {
        defaultValue: 'HTTP proxy for CloudCLI and every agent it starts.',
      })}
    >
      <SettingsCard divided>
        <div className="flex items-start gap-3 p-4">
          <Globe className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t('network.hint', {
              defaultValue:
                'Applies to every agent (Claude, Codex, WorkBuddy, Pi, DSH, …) and to CloudCLI itself. Saving takes effect on the next session; running sessions keep their current network environment.',
            })}
          </p>
        </div>

        <div className="border-t border-border/60 p-4">
          <label htmlFor="network-proxy-url" className="text-sm font-medium text-foreground">
            {t('network.urlLabel', { defaultValue: 'Proxy URL' })}
          </label>
          <div className="mt-1 flex gap-2">
            <Input
              id="network-proxy-url"
              value={proxyUrl}
              onChange={(event) => setProxyUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void save();
                }
              }}
              disabled={loading}
              placeholder="http://127.0.0.1:7890"
              className="flex-1"
            />
            <Button
              onClick={() => void save()}
              disabled={busy || loading}
              className="shrink-0"
              size="sm"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('network.save', { defaultValue: 'Save' })}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('network.urlHint', {
              defaultValue:
                'Example: http://127.0.0.1:7890. Clear the field and save to stop using a proxy — localhost addresses always bypass it.',
            })}
          </p>
          {loading && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('network.loading', { defaultValue: 'Loading…' })}
            </p>
          )}
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
