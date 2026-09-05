import { useMemo } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SessionOutlineItem } from '@/shared/types';

type QuickSettingsOutlineProps = {
  items: SessionOutlineItem[];
  isLoading: boolean;
  onJumpToMessage: (timestamp: string, snippet: string) => void;
};

function formatTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

export default function QuickSettingsOutline({
  items,
  isLoading,
  onJumpToMessage,
}: QuickSettingsOutlineProps) {
  const { t } = useTranslation('settings');

  // Newest first, so recent questions are immediately visible.
  const rows = useMemo(() => [...items].reverse(), [items]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <MessageSquare className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('quickSettings.outline.empty')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden p-2">
      {rows.map((item, index) => {
        // Server snippet is already capped at 80 chars; this slice is a
        // defensive safety net preserving the old jump contract exactly.
        const label = item.snippet.length > 80
          ? `${item.snippet.slice(0, 80)}…`
          : item.snippet || t('quickSettings.outline.untitled');
        const snippet = item.snippet.slice(0, 80);
        const date = new Date(item.timestamp);
        const time = formatTime(date);
        const timestamp = Number.isNaN(date.getTime()) ? '' : date.toISOString();
        return (
          <button
            key={index}
            type="button"
            onClick={() => {
              if (timestamp) {
                // A single space keeps the search-target effect firing while
                // forcing it to fall back to the timestamp matcher.
                onJumpToMessage(timestamp, snippet || ' ');
              }
            }}
            title={label}
            className="flex w-full flex-col gap-0.5 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-accent"
          >
            <span className="text-sm text-foreground">{label}</span>
            {time && <span className="text-xs text-muted-foreground">{time}</span>}
          </button>
        );
      })}
    </div>
  );
}
