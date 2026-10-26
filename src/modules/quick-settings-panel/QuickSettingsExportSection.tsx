import { ChevronDown, ChevronRight, Download, Loader2, Share2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createCachedDiffCalculator,
  downloadTranscriptExport,
  ShareTranscriptDialog,
  type TranscriptExportFormat,
} from '@/modules/chat';
import { SETTING_ROW_CLASS } from '@/shared/constants';
import { afterNextPaint } from '@/shared/utils';
import type { ChatMessage, LLMProvider, Project } from '@/shared/types';

type QuickSettingsExportSectionProps = {
  messages: ChatMessage[];
  sessionTitle?: string;
  /** Published with the whole-session share; null for a not-yet-persisted session. */
  sessionId?: string | null;
  provider: LLMProvider;
  selectedProject: Project | null;
  /** Controlled expand state — expanding loads the full transcript via the panel hook. */
  isOpen: boolean;
  onToggle: () => void;
  /** True while the full transcript is being fetched after the section expands. */
  isLoading?: boolean;
};

/** Rounds to one decimal from a megabyte up, so the hint never reads "0.98 MB". */
function formatApproxSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1 ? `${megabytes.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Roughly how much text the export will carry.
 *
 * Every read here is `length`, which is O(1) per string, so this is one pass
 * over the rows. Measuring the transcript with `JSON.stringify` instead walked
 * and re-serialized every tool payload — on every stream tick, for a row that
 * only says "about this much". Characters stand in for bytes: the hint is an
 * order of magnitude, and these transcripts are mostly ASCII.
 */
function estimateTextBytes(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => (
    total
    + (message.content?.length ?? 0)
    + (message.reasoning?.length ?? 0)
    + (typeof message.toolInput === 'string' ? message.toolInput.length : 0)
    + (typeof message.toolResult?.content === 'string' ? message.toolResult.content.length : 0)
  ), 0);
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
  sessionId,
  provider,
  selectedProject,
  isOpen,
  onToggle,
  isLoading = false,
}: QuickSettingsExportSectionProps) {
  const { t } = useTranslation('settings');
  const [pendingFormat, setPendingFormat] = useState<TranscriptExportFormat | null>(null);
  const [failed, setFailed] = useState(false);
  // The publish dialog owns its own build/upload lifecycle; this only tracks
  // whether it is on screen, so closing it never disturbs the export rows.
  const [shareOpen, setShareOpen] = useState(false);

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
    setFailed(false);
    setPendingFormat(format);

    try {
      await afterNextPaint();
      await downloadTranscriptExport(
        format,
        exportInput,
        t('export.filePrefix', { ns: 'chat', defaultValue: 'conversation' }),
      );
    } catch (error) {
      // Without this the row just returned to its label, which reads as a
      // download that silently produced nothing.
      console.error('[Chat] Failed to export the conversation:', error);
      setFailed(true);
    } finally {
      setPendingFormat(null);
    }
  };

  const isBusy = pendingFormat !== null;
  // The build is synchronous: a long transcript makes the click look ignored
  // for a few seconds. Measure the text up front so the row can say so first.
  // Inlined images are not in `messages`, hence the "text" qualifier. Nothing
  // is measured while the section is collapsed, and the measure itself is a
  // length sum rather than a full serialization.
  const estimatedBytes = useMemo(
    () => (isOpen ? estimateTextBytes(messages) : 0),
    [isOpen, messages],
  );
  const showSizeHint = messages.length >= 400 || estimatedBytes >= 512 * 1024;

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
            <>
              {showSizeHint && (
                <p className="text-xs text-muted-foreground">
                  {t('quickSettings.export.sizeHint', { size: formatApproxSize(estimatedBytes) })}
                </p>
              )}
              {([
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
              ))}
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                disabled={isBusy}
                className={`${SETTING_ROW_CLASS} w-full ${isBusy ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
              >
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <Share2Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  {t('quickSettings.export.share')}
                </span>
              </button>
              {failed && (
                <p role="alert" className="text-xs text-destructive">
                  {t('transcript.selection.exportFailed', { ns: 'chat' })}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {shareOpen && (
        <ShareTranscriptDialog
          onClose={() => setShareOpen(false)}
          messages={messages}
          sessionTitle={exportInput.sessionTitle}
          provider={provider}
          selectedProject={selectedProject}
          sessionId={sessionId}
        />
      )}
    </div>
  );
}
