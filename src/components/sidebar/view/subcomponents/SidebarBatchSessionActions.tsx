import { Archive, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';

type SidebarBatchSessionActionsProps = {
  selectedCount: number;
  selectableCount: number;
  areAllSelected: boolean;
  onToggleSelectAll: () => void;
  onArchive: () => void;
  onCancel: () => void;
  permanentDelete?: boolean;
  t: TFunction;
};

/**
 * Shared by the recent-conversation and per-project lists to keep batch
 * selection controls and archive semantics identical in both locations.
 */
export default function SidebarBatchSessionActions({
  selectedCount,
  selectableCount,
  areAllSelected,
  onToggleSelectAll,
  onArchive,
  onCancel,
  permanentDelete = false,
  t,
}: SidebarBatchSessionActionsProps) {
  return (
    <div className="sticky bottom-0 z-10 mt-2 border-y border-border bg-background/95 px-2 py-2 backdrop-blur-sm">
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onToggleSelectAll} disabled={selectableCount === 0}>
          {areAllSelected ? t('sessions.deselectAll') : t('sessions.selectAll')}
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {t('sessions.selectedCount', { count: selectedCount })}
        </span>
        <Button
          variant="destructive"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={onArchive}
          disabled={selectedCount === 0}
        >
          {permanentDelete ? <Trash2 className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
          {permanentDelete
            ? t('sessions.deleteSelectedPermanently', { count: selectedCount })
            : t('sessions.archiveSelected', { count: selectedCount })}
        </Button>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
      </div>
    </div>
  );
}
