import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createCachedDiffCalculator,
  downloadTranscriptExport,
  type TranscriptExportFormat,
} from '@/modules/chat';
import { SETTING_ROW_CLASS } from '@/shared/constants';
import type { ChatMessage, LLMProvider, Project } from '@/shared/types';

type QuickSettingsExportSectionProps = {
  messages: ChatMessage[];
  sessionTitle?: string;
  provider: LLMProvider;
  selectedProject: Project | null;
  /** Controlled expand state — expanding loads the full transcript via the panel hook. */
  isOpen: boolean;
  onToggle: () => void;
  /** True while the full transcript is being fetched after the section expands. */
  isLoading?: boolean;
};

/**
 * Resolves once the browser has painted the state update made just before the
 * call. Rendering a long transcript is one synchronous pass that can occupy the
 * main thread for seconds, so without this wait the "generating" row would only
 * appear after the work finished — which is exactly the frozen click the row
 * exists to explain.
 */
function afterNextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => { setTimeout(resolve, 0); });
  }

  return new Promise((resolve) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); });
  });
}

/**
 * Collapsible "Export conversation" entry that lives inside the Quick Settings
 * tab. Default-collapsed to keep the panel compact; expands to a vertical list
 * of format buttons (Markdown / HTML). The expand state is controlled by the
 * panel so the full transcript is only loaded once the user opens it — the
 * toggle therefore stays enabled even before data arrives.
 */
export default function QuickSettingsExportSection({
  messages,
  sessionTitle,
  provider,
  selectedProject,
  isOpen,
  onToggle,
  isLoading = false,
}: QuickSettingsExportSectionProps) {
  const { t } = useTranslation('settings');
  const [pendingFormat, setPendingFormat] = useState<TranscriptExportFormat | null>(null);

  const createDiff = createCachedDiffCalculator();
  const exportInput = {
    messages,
    sessionTitle: sessionTitle || t('export.untitled', { ns: 'chat', defaultValue: 'Conversation' }),
    provider,
    selectedProject,
    createDiff,
  };

  const handleExport = async (format: TranscriptExportFormat) => {
    if (pendingFormat) return;
    setPendingFormat(format);

    try {
      await afterNextPaint();
      await downloadTranscriptExport(format, exportInput);
    } finally {
      setPendingFormat(null);
    }
  };

  const isBusy = pendingFormat !== null;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onToggle}
        className={`${SETTING_ROW_CLASS} w-full cursor-pointer`}
      >
        <span className="flex items-center gap-2 text-sm text-foreground">
          <Download className="h-4 w-4 text-muted-foreground" />
          {t('quickSettings.export.title')}
        </span>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="space-y-1 pl-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('quickSettings.export.loading')}
            </div>
          ) : messages.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('quickSettings.outline.empty')}</p>
          ) : (
            ([
              { id: 'markdown', label: 'Markdown (.md)' },
              { id: 'html', label: 'Web Page (.html)' },
            ] as const).map((format) => (
              <button
                key={format.id}
                type="button"
                onClick={() => { void handleExport(format.id); }}
                disabled={isBusy}
                aria-busy={pendingFormat === format.id}
                className={`${SETTING_ROW_CLASS} w-full ${isBusy ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
              >
                {pendingFormat === format.id ? (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('quickSettings.export.generating', { format: format.label })}
                  </span>
                ) : (
                  <span className="text-sm text-foreground">{format.label}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
