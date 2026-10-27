import { useCallback, useEffect, useRef, useState } from 'react';

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
 * How long the username and IP inputs settle before they are queried. Without
 * it every keystroke replaced the table with a spinner and raced its own
 * in-flight request, so typing one IP address fired a dozen overlapping loads.
 */
const TEXT_FILTER_DEBOUNCE_MS = 300;

const EMPTY_FILTERS: LoginLogFilters = { eventType: '', username: '', ip: '' };

/** Value equality for filters; a repainted-but-identical set must not refetch. */
const sameFilters = (left: LoginLogFilters, right: LoginLogFilters): boolean =>
  left.eventType === right.eventType
  && left.username === right.username
  && left.ip === right.ip;

/**
 * Loads the login audit trail for the Login Log settings tab, keeping the
 * active filters, the current page and the loading flags in one place.
 */
export function useLoginLogSettings() {
  // Rows for the current page, fetched from the server (never derived locally).
  const [events, setEvents] = useState<AuthEventRow[]>([]);
  // Total rows matching the active filters; drives the page count.
  const [total, setTotal] = useState(0);
  // Offset of the current page; reset to 0 whenever the filters change.
  const [offset, setOffset] = useState(0);
  // What the inputs show. Typing updates this immediately so the caret never lags.
  const [filters, setFilters] = useState<LoginLogFilters>(EMPTY_FILTERS);
  // What the next request asks for: `filters` once the text inputs settle.
  const [query, setQuery] = useState<LoginLogFilters>(EMPTY_FILTERS);
  // True while a request is in flight; disables pagination and the refresh button.
  const [loading, setLoading] = useState(true);
  // False until the first response lands, so only the very first paint is a spinner.
  const [hasLoaded, setHasLoaded] = useState(false);
  // Bumped by an explicit refresh, which refetches even when nothing else changed.
  const [reloadToken, setReloadToken] = useState(0);
  // Last settled filters, so the debounce below can tell what actually changed.
  const appliedFilters = useRef<LoginLogFilters>(EMPTY_FILTERS);

  useEffect(() => {
    const apply = () => {
      if (sameFilters(appliedFilters.current, filters)) {
        return;
      }
      appliedFilters.current = filters;
      setQuery(filters);
    };
    // Picking an event type is a discrete action and applies at once; the text
    // inputs wait for typing to settle.
    if (filters.eventType !== appliedFilters.current.eventType) {
      apply();
      return;
    }
    const timer = setTimeout(apply, TEXT_FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api.settings.authEvents({
      limit: PAGE_SIZE,
      offset,
      eventType: query.eventType || undefined,
      username: query.username.trim() || undefined,
      ip: query.ip.trim() || undefined,
      signal: controller.signal,
    })
      .then((response) => response.json() as Promise<AuthEventsResponse>)
      .then((payload) => {
        // A response that lost the race must not overwrite the newer page.
        if (controller.signal.aborted) return;
        setEvents(payload.events ?? []);
        setTotal(payload.total ?? 0);
        setHasLoaded(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('Error fetching the login audit log:', error);
        setEvents([]);
        setTotal(0);
        setHasLoaded(true);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => controller.abort();
  }, [query, offset, reloadToken]);

  // Applying a filter restarts paging so the new result set begins on page 1.
  const updateFilters = useCallback((next: Partial<LoginLogFilters>) => {
    setOffset(0);
    setFilters((previous) => ({ ...previous, ...next }));
  }, []);

  // Refresh also applies whatever is still sitting in the debounce window, so
  // the button cannot show results for a filter the inputs no longer match.
  const refresh = useCallback(() => {
    appliedFilters.current = filters;
    setQuery(filters);
    setReloadToken((token) => token + 1);
  }, [filters]);

  return {
    events,
    total,
    offset,
    limit: PAGE_SIZE,
    filters,
    loading,
    initialLoading: !hasLoaded,
    setOffset,
    updateFilters,
    refresh,
  };
}
