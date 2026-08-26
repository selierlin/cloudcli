import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '../../chat/types/types';
import {
  EXPORT_FORMATS,
  downloadHTML,
  downloadMarkdown,
  downloadPDF,
} from '../../chat/utils/chatExport';
import { SETTING_ROW_CLASS } from '../constants';

type QuickSettingsExportSectionProps = {
  messages: ChatMessage[];
  sessionTitle?: string;
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
  isOpen,
  onToggle,
  isLoading = false,
}: QuickSettingsExportSectionProps) {
  const { t } = useTranslation('settings');

  const handleExport = (format: (typeof EXPORT_FORMATS)[number]['id']) => {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${sessionTitle || 'chat'}-${timestamp}`;

    switch (format) {
      case 'markdown':
        downloadMarkdown(messages, `${filename}.md`, sessionTitle);
        break;
      case 'html':
        downloadHTML(messages, `${filename}.html`, sessionTitle);
        break;
      case 'pdf':
        downloadPDF(messages, filename, sessionTitle);
        break;
    }
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
            EXPORT_FORMATS.map((format) => (
              <button
                key={format.id}
                type="button"
                onClick={() => handleExport(format.id)}
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
