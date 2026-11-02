import { Activity } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isDiagnosticsEnabled,
  setDiagnosticsEnabled,
  subscribeDiagnosticsEnabled,
} from '@/shared/debug/diagnosticsPreference';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsToggle from '@/modules/settings/SettingsToggle';

/**
 * Rendered by Settings for the "diagnostics" tab: the switch for the on-device
 * recorder.
 *
 * The recorder exists because the defects it was built for — flickering glyphs
 * and a stuck drag in a long transcript — only reproduce inside the iOS WebView,
 * where nothing can be inspected. It is kept permanently for that reason, and
 * kept off by default for the opposite one: it patches the scroll APIs and
 * samples every frame, which is not something a reader should pay for.
 */
export default function DiagnosticsTab() {
  const { t } = useTranslation('settings');
  const enabled = useSyncExternalStore(subscribeDiagnosticsEnabled, isDiagnosticsEnabled);

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-medium text-foreground">
            {t('diagnostics.title')}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('diagnostics.description')}</p>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <SettingsRow
          label={t('diagnostics.recorderLabel')}
          description={t('diagnostics.recorderDescription')}
        >
          <SettingsToggle
            checked={enabled}
            onChange={setDiagnosticsEnabled}
            ariaLabel={t('diagnostics.recorderLabel')}
          />
        </SettingsRow>
      </div>

      {enabled && (
        <p className="text-xs text-muted-foreground">{t('diagnostics.howTo')}</p>
      )}
    </div>
  );
}
