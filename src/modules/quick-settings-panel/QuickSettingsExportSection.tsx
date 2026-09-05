import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  buildTranscriptExport,
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
 * Collapsible "Export conversation" entry that lives inside the Quick Settings
 * tab. Default-collapsed to keep the panel compact; expands to a vertical list
 * of format buttons (Markdown / HTML / PDF). The expand state is controlled by
 * the panel so the full transcript is only loaded once the user opens it — the
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

  const createDiff = createCachedDiffCalculator();
  const exportInput = {
    messages,
    sessionTitle: sessionTitle || t('export.untitled', { ns: 'chat', defaultValue: 'Conversation' }),
    provider,
    selectedProject,
    createDiff,
  };

  const handleExport = async (format: TranscriptExportFormat | 'pdf') => {
    if (format !== 'pdf') {
      await downloadTranscriptExport(format, exportInput);
      return;
    }

    const popup = window.open('', '', 'width=900,height=700');
    if (!popup) {
      window.alert(t('quickSettings.export.printBlocked'));
      return;
    }
    popup.document.write(await buildTranscriptExport('html', exportInput, new Date()));
    popup.document.close();
    popup.focus();
    popup.print();
  };

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
              { id: 'pdf', label: 'PDF (Print to File)' },
            ] as const).map((format) => (
              <button
                key={format.id}
                type="button"
                onClick={() => { void handleExport(format.id); }}
                className={`${SETTING_ROW_CLASS} w-full cursor-pointer`}
              >
                <span className="text-sm text-foreground">{format.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
