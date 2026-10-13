import { CornerDownRight, CornerUpLeft, Search } from 'lucide-react';
import { useState } from 'react';
import type { TFunction } from 'i18next';

import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * One selectable parent, already resolved to a display name by the caller so
 * this component never has to know how a session is titled.
 */
export type SessionParentCandidate = {
  id: string;
  name: string;
};

type SessionParentPickerProps = {
  /** Title of the session being filed, shown as the dialog heading context. */
  sessionName: string;
  /** Same-project top-level sessions the row may be filed under. */
  candidates: SessionParentCandidate[];
  /** The session's current parent, or null when it is already top-level. */
  currentParentId: string | null;
  /** Called with the chosen parent, or null to move the session back to top level. */
  onSelect: (parentSessionId: string | null) => void;
  onClose: () => void;
  t: TFunction;
};

/**
 * Picker for the session a row should be filed under. Rendered by the sidebar's
 * SessionParentPickerProvider, which supplies the candidate list and persists the
 * chosen parent; a session row only asks the provider to open it.
 *
 * Only same-project, top-level sessions are offered: the server enforces both
 * (one level, one project), so anything else would be rejected on submit. The
 * list is filterable because a project can hold more sessions than fit without
 * scrolling.
 */
export default function SessionParentPicker({
  sessionName,
  candidates,
  currentParentId,
  onSelect,
  onClose,
  t,
}: SessionParentPickerProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCandidates = normalizedQuery
    ? candidates.filter((candidate) => candidate.name.toLowerCase().includes(normalizedQuery))
    : candidates;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t('sessions.fileUnderSessionTitle', { name: sessionName })}</DialogTitle>

        {candidates.length > 6 && (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('sessions.fileUnderSearchPlaceholder')}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>
        )}

        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {currentParentId !== null && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
            >
              <CornerUpLeft className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="truncate">{t('sessions.moveSessionToTopLevel')}</span>
            </button>
          )}

          {visibleCandidates.length === 0 ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">
              {candidates.length === 0
                ? t('sessions.fileUnderNoCandidates')
                : t('sessions.fileUnderNoMatches')}
            </p>
          ) : (
            visibleCandidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onSelect(candidate.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent',
                  candidate.id === currentParentId && 'border-primary/40 bg-accent',
                )}
              >
                <CornerDownRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="truncate" title={candidate.name}>{candidate.name}</span>
              </button>
            ))
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-lg px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            {t('actions.cancel')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
