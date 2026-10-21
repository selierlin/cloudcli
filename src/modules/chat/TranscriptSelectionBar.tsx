import { DownloadIcon, Loader2, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { PartialExportFormat } from '@/modules/chat/utils/chatExport';

type TranscriptSelectionBarProps = {
  /** Number of rows (questions and answers) picked so far. */
  selectedCount: number;
  /** The last export attempt threw; the bar reports it instead of looking ready. */
  failed?: boolean;
  /** Format currently being built, if any; both buttons stay disabled meanwhile. */
  busyFormat: PartialExportFormat | null;
  onExport: (format: PartialExportFormat) => void;
  onCancel: () => void;
};

/**
 * Rendered by chat's ChatInterface above the composer while the reader is
 * picking turns for a partial export. It is the only confirmation surface for
 * the mode: the count, the two formats, and the way out.
 */
export default function TranscriptSelectionBar({
  selectedCount,
  failed = false,
  busyFormat,
  onExport,
  onCancel,
}: TranscriptSelectionBarProps) {
  const { t } = useTranslation('chat');
  const isBusy = busyFormat !== null;
  const formats: Array<{ id: PartialExportFormat; name: string; label: string }> = [
    { id: 'html', name: 'HTML', label: t('transcript.selection.exportHtml') },
    { id: 'markdown', name: 'Markdown', label: t('transcript.selection.exportMarkdown') },
  ];

  return (
    <div
      role="group"
      aria-label={t('transcript.selection.enter')}
      className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1.5 text-xs shadow-lg backdrop-blur-sm"
    >
      <span className="px-1.5 font-medium text-foreground" aria-live="polite">
        {t('transcript.selection.selectedMessages', { count: selectedCount })}
      </span>
      {failed && (
        <span role="alert" className="px-1.5 text-destructive">
          {t('transcript.selection.exportFailed')}
        </span>
      )}
      {formats.map((format) => (
        <button
          key={format.id}
          type="button"
          onClick={() => onExport(format.id)}
          disabled={isBusy || selectedCount === 0}
          aria-busy={busyFormat === format.id}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50"
        >
          {busyFormat === format.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <DownloadIcon className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {busyFormat === format.id
            ? t('transcript.selection.generating', { format: format.name })
            : format.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onCancel}
        disabled={isBusy}
        title={t('transcript.selection.cancel')}
        aria-label={t('transcript.selection.cancel')}
        className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-50"
      >
        <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
