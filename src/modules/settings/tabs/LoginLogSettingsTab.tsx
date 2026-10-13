import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '@/shared/ui';
import { IS_PLATFORM } from '@/shared/utils';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import { useLoginLogSettings } from '@/modules/settings/hooks/useLoginLogSettings';
import type { AuthEventType } from '@/shared/types';

const EVENT_TYPES: AuthEventType[] = ['login_success', 'login_failure', 'logout', 'register', 'agent_auth_failure'];

/**
 * Formats a UTC `created_at` (SQLite `CURRENT_TIMESTAMP`, `YYYY-MM-DD HH:MM:SS`)
 * in the viewer's local time. The stored value is UTC, so rendering it raw
 * would shift every row by the local offset.
 */
const formatLocalTime = (utc: string): string => {
  const parsed = new Date(`${utc.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? utc : parsed.toLocaleString();
};

/** Used by the Settings dialog's Login Log tab to render the login audit trail. */
export default function LoginLogSettingsTab() {
  const { t } = useTranslation('settings');
  const { events, total, offset, limit, filters, loading, setOffset, updateFilters, refresh } =
    useLoginLogSettings();

  // Platform deployments have no login flow, so no audit rows can exist; show a
  // placeholder and skip the query entirely.
  if (IS_PLATFORM) {
    return (
      <SettingsSection title={t('mainTabs.loginLog')}>
        <SettingsCard>
          <p className="p-4 text-sm text-muted-foreground">
            {t('loginLog.platformUnavailable', { defaultValue: 'No login log exists in this deployment mode.' })}
          </p>
        </SettingsCard>
      </SettingsSection>
    );
  }

  const currentPage = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <SettingsSection
      title={t('mainTabs.loginLog')}
      description={t('loginLog.description', {
        defaultValue: 'Recent sign-in, sign-out and registration events for this account.',
      })}
    >
      <SettingsCard divided>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {t('loginLog.eventType', { defaultValue: 'Event' })}
            </span>
            <select
              value={filters.eventType}
              onChange={(event) => updateFilters({ eventType: event.target.value as AuthEventType | '' })}
              className="touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">{t('loginLog.allEvents', { defaultValue: 'All events' })}</option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`loginLog.event.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {t('loginLog.username', { defaultValue: 'Username' })}
            </span>
            <Input
              value={filters.username}
              maxLength={128}
              onChange={(event) => updateFilters({ username: event.target.value })}
              className="w-40"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {t('loginLog.ip', { defaultValue: 'IP address' })}
            </span>
            <Input
              value={filters.ip}
              onChange={(event) => updateFilters({ ip: event.target.value })}
              className="w-40"
            />
          </label>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {t('loginLog.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>

        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-4 py-2 font-medium">{t('loginLog.column.time', { defaultValue: 'Time' })}</th>
                <th className="whitespace-nowrap px-4 py-2 font-medium">{t('loginLog.column.event', { defaultValue: 'Event' })}</th>
                <th className="whitespace-nowrap px-4 py-2 font-medium">{t('loginLog.column.username', { defaultValue: 'Username' })}</th>
                <th className="whitespace-nowrap px-4 py-2 font-medium">{t('loginLog.column.ip', { defaultValue: 'IP' })}</th>
                <th className="w-full px-4 py-2 font-medium">{t('loginLog.column.userAgent', { defaultValue: 'User agent' })}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    {t('loginLog.empty', { defaultValue: 'No events match these filters.' })}
                  </td>
                </tr>
              ) : (
                events.map((row) => (
                  <tr key={row.id} className="border-t border-border/40">
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{formatLocalTime(row.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-2">{t(`loginLog.event.${row.event_type}`)}</td>
                    <td className="whitespace-nowrap px-4 py-2">{row.username ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2">{row.ip ?? '—'}</td>
                    <td className="w-full max-w-96 truncate px-4 py-2 text-muted-foreground" title={row.user_agent ?? undefined}>
                      {row.user_agent ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border/60 p-4 text-sm text-muted-foreground">
          <span>{t('loginLog.pageInfo', { defaultValue: 'Page {{page}} of {{pages}} · {{total}} events', page: currentPage, pages: pageCount, total })}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - limit))}>
              {t('loginLog.previous', { defaultValue: 'Previous' })}
            </Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total || loading} onClick={() => setOffset(offset + limit)}>
              {t('loginLog.next', { defaultValue: 'Next' })}
            </Button>
          </div>
        </div>
      </SettingsCard>

      <p className="px-1 text-xs text-muted-foreground">
        {t('loginLog.logoutNote', {
          defaultValue:
            'A "logout" row only means the client cleared its token. Closing the tab or letting the token expire records nothing, and an already-issued JWT stays valid until it expires.',
        })}
      </p>
    </SettingsSection>
  );
}
