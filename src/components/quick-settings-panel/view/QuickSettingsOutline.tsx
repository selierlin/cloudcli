import { useMemo } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '../../chat/types/types';

type QuickSettingsOutlineProps = {
  userMessages: ChatMessage[];
  isLoading: boolean;
  onJumpToMessage: (timestamp: string, snippet: string) => void;
};

/** First non-empty line of a message's content. */
function getFirstLine(content: unknown): string {
  if (typeof content !== 'string') return '';
  return (content.split('\n').find((part) => part.trim().length > 0) ?? '').trim();
}

function formatTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

export default function QuickSettingsOutline({
  userMessages,
  isLoading,
  onJumpToMessage,
}: QuickSettingsOutlineProps) {
  const { t } = useTranslation('settings');

  // Newest first, so recent questions are immediately visible.
  const items = useMemo(() => [...userMessages].reverse(), [userMessages]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <MessageSquare className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('quickSettings.outline.empty')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden p-2">
      {items.map((message, index) => {
        const firstLine = getFirstLine(message.content);
        const label = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
        const snippet = firstLine.slice(0, 80);
        const date = new Date(message.timestamp);
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
            <span className="text-sm text-foreground">{label || t('quickSettings.outline.untitled')}</span>
            {time && <span className="text-xs text-muted-foreground">{time}</span>}
          </button>
        );
      })}
    </div>
  );
}
