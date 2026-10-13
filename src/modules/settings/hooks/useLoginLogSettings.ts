import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { AuthEventRow, AuthEventType } from '@/shared/types';

/** Wire shape of `GET /api/settings/auth-events`; only used here. */
type AuthEventsResponse = {
  events?: AuthEventRow[];
  total?: number;
};

/** Active audit-log filters; an empty string means "no filter". Only used here. */
type LoginLogFilters = {
  eventType: AuthEventType | '';
  username: string;
  ip: string;
};

/** Page size for the audit log; matches the server's default page. */
const PAGE_SIZE = 50;

/**
 * Loads the login audit trail for the Login Log settings tab, keeping the
 * active filters, the current page and the loading flag in one place.
 */
export function useLoginLogSettings() {
  // Rows for the current page, fetched from the server (never derived locally).
  const [events, setEvents] = useState<AuthEventRow[]>([]);
  // Total rows matching the active filters; drives the page count.
  const [total, setTotal] = useState(0);
  // Offset of the current page; reset to 0 whenever the filters change.
  const [offset, setOffset] = useState(0);
  // Filters applied on the next fetch.
  const [filters, setFilters] = useState<LoginLogFilters>({ eventType: '', username: '', ip: '' });
  // True while a fetch is in flight, to show the spinner and hold off an empty state.
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.settings.authEvents({
        limit: PAGE_SIZE,
        offset,
        eventType: filters.eventType || undefined,
        username: filters.username.trim() || undefined,
        ip: filters.ip.trim() || undefined,
      });
      const payload = (await response.json()) as AuthEventsResponse;
      setEvents(payload.events ?? []);
      setTotal(payload.total ?? 0);
    } catch (error) {
      console.error('Error fetching the login audit log:', error);
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  // Applying a filter restarts paging so the new result set begins on page 1.
  const updateFilters = useCallback((next: Partial<LoginLogFilters>) => {
    setOffset(0);
    setFilters((previous) => ({ ...previous, ...next }));
  }, []);

  return {
    events,
    total,
    offset,
    limit: PAGE_SIZE,
    filters,
    loading,
    setOffset,
    updateFilters,
    refresh: fetchEvents,
  };
}
