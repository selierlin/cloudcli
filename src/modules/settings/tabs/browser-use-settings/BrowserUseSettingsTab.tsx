import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { api, readApiJson } from '@/shared/api';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';

type BrowserUseStatus = {
  available: boolean;
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  installInProgress: boolean;
  message: string;
};

/** Rendered by Settings for the "browser" tab: manages the browser automation runtime. */
export default function BrowserUseSettingsTab() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const statusResponse = await api.browserUse.status();
    const statusData = await readApiJson<{ data: BrowserUseStatus }>(statusResponse);
    setStatus(statusData.data);
  }, []);

  useEffect(() => {
    setError(null);
    setIsStatusLoading(true);

    void loadStatus()
      .catch((err) => setError(err instanceof Error ? err.message : t('browser.loadStatusError')))
      .finally(() => setIsStatusLoading(false));
  }, [loadStatus, t]);

  const installBrowserBinaries = async () => {
    setIsInstalling(true);
    setError(null);
    try {
      const response = await api.browserUse.installRuntime();
      await readApiJson(response);
      setIsStatusLoading(true);
      await loadStatus();
      window.dispatchEvent(new Event('browserRuntimeChanged'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('browser.installRuntimeError'));
    } finally {
      setIsStatusLoading(false);
      setIsInstalling(false);
    }
  };

  const needsBrowserBinaries = Boolean(status && (!status.playwrightInstalled || !status.chromiumInstalled));
  const runtimeLabel = (installed?: boolean) => {
    if (isStatusLoading && !status) {
      return t('browser.checking');
    }
    return installed ? t('browser.installed') : t('browser.missing');
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('browser.title')}
        description={t('browser.description')}
      >
        <SettingsCard divided>
          <div className="space-y-4 px-4 py-4">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border border-border px-2 py-1">
                Playwright: {runtimeLabel(status?.playwrightInstalled)}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                Chromium: {runtimeLabel(status?.chromiumInstalled)}
              </span>
              <span className="rounded-md border border-border px-2 py-1">
                {t('browser.statusLabel')}: {isStatusLoading && !status ? t('browser.checking') : status?.available ? t('browser.ready') : t('browser.setupRequired')}
              </span>
            </div>

            {needsBrowserBinaries && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium text-foreground">{t('browser.runtimeRequired')}</div>
                  <p className="text-sm text-muted-foreground">
                    {status?.message || t('browser.runtimeRequiredDescription')}
                  </p>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={() => void installBrowserBinaries()}
                  disabled={isInstalling || status?.installInProgress}
                  className="flex-shrink-0"
                >
                  {isInstalling || status?.installInProgress ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {isInstalling || status?.installInProgress ? t('browser.installing') : t('browser.installRuntime')}
                </Button>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
