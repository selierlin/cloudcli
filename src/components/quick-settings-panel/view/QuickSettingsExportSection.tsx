import { useState } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
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
};

/**
 * Collapsible "Export conversation" entry that lives inside the Quick Settings
 * tab. Default-collapsed to keep the panel compact; expands to a vertical list
 * of format buttons (Markdown / HTML / PDF).
 */
export default function QuickSettingsExportSection({
  messages,
  sessionTitle,
}: QuickSettingsExportSectionProps) {
  const { t } = useTranslation('settings');
  const [isOpen, setIsOpen] = useState(false);

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

  const disabled = messages.length === 0;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        disabled={disabled}
        className={`${SETTING_ROW_CLASS} w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`}
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

      {isOpen && !disabled && (
        <div className="space-y-1 pl-6">
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              onClick={() => handleExport(format.id)}
              className={`${SETTING_ROW_CLASS} w-full cursor-pointer`}
            >
              <span className="text-sm text-foreground">{format.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
