import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '../../chat/types/types';
import {
  EXPORT_FORMATS,
  downloadHTML,
  downloadMarkdown,
  downloadPDF,
} from '../../chat/utils/chatExport';

type QuickSettingsExportBarProps = {
  messages: ChatMessage[];
  sessionTitle?: string;
};

export default function QuickSettingsExportBar({ messages, sessionTitle }: QuickSettingsExportBarProps) {
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
    <div className="border-t border-border p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Download className="h-3.5 w-3.5" />
        {t('quickSettings.export.title')}
      </p>
      <div className="flex flex-wrap gap-2">
        {EXPORT_FORMATS.map((format) => (
          <button
            key={format.id}
            type="button"
            onClick={() => handleExport(format.id)}
            disabled={messages.length === 0}
            className="flex-1 rounded-lg border border-border/60 px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {format.label}
          </button>
        ))}
      </div>
    </div>
  );
}
