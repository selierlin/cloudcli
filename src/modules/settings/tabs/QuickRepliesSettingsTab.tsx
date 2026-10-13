import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Download, Plus, Trash2, Upload } from 'lucide-react';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import { Button, Input } from '@/shared/ui';
import { useQuickReplies } from '@/shared/hooks/useQuickReplies';
import {
  MAX_QUICK_REPLIES,
  MAX_QUICK_REPLY_LABEL_LENGTH,
  MAX_QUICK_REPLY_TEXT_LENGTH,
  addQuickReply,
  moveQuickReply,
  parseQuickRepliesImport,
  quickReplyLabel,
  removeQuickReplyAt,
  serializeQuickRepliesExport,
  setQuickReplyAt,
  writeQuickReplies,
} from '@/shared/quickReplies';
import type { QuickReplyImportError } from '@/shared/types';

/** Name of the file the export button downloads, matching the app so a pile of share files stays identifiable. */
const EXPORT_FILE_NAME = 'cloudcli-quick-replies.json';

/** Rendered by Settings for the "quickReplies" tab, which edits the snippets the composer offers above its input. */
export default function QuickRepliesSettingsTab() {
  const { t } = useTranslation('settings');
  // The effective list: the stored snippets, or the shipped defaults until the
  // first edit. Editing any row writes the whole list, defaults included.
  const quickReplies = useQuickReplies();
  // The half-typed new row, kept out of the stored list so an abandoned partial
  // snippet never reaches the composer or the server.
  const [newLabel, setNewLabel] = useState('');
  const [newText, setNewText] = useState('');
  // One-shot feedback from the last import attempt: why nothing could be read,
  // how many source rows were dropped, or null after a clean import. The next
  // attempt clears it, so a stale notice never outlives its file.
  const [importFeedback, setImportFeedback] = useState<
    { kind: 'error'; code: QuickReplyImportError } | { kind: 'skipped'; count: number } | null
  >(null);
  // Points at the hidden file input the import button clicks on the user's behalf.
  const fileInputRef = useRef<HTMLInputElement>(null);

  const atLimit = quickReplies.length >= MAX_QUICK_REPLIES;
  const canAdd = newText.trim() !== '' && !atLimit;

  const handleAdd = () => {
    if (!canAdd) {
      return;
    }

    const text = newText.trim();
    const label = newLabel.trim();
    writeQuickReplies(addQuickReply(quickReplies, label ? { label, text } : { text }));
    setNewLabel('');
    setNewText('');
  };

  const handleExport = () => {
    const url = URL.createObjectURL(new Blob([serializeQuickRepliesExport(quickReplies)], {
      type: 'application/json',
    }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = EXPORT_FILE_NAME;
    // The anchor has to be in the document for the click to start the download
    // in every browser, and the object URL must outlive that download: revoking
    // it synchronously can cancel the transfer before the blob is read.
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleImportFile = (file: File) => {
    setImportFeedback(null);
    const reader = new FileReader();
    // A file that cannot be read at all reports the same "nothing usable" the
    // parser does, so a failed pick is never a silent no-op.
    reader.onerror = () => setImportFeedback({ kind: 'error', code: 'empty' });
    // Parsing (and the overwrite confirm) has to wait until the text is in,
    // which is why it lives in the load callback rather than the change handler.
    reader.onload = () => {
      const result = parseQuickRepliesImport(typeof reader.result === 'string' ? reader.result : '');
      if ('error' in result) {
        setImportFeedback({ kind: 'error', code: result.error });
        return;
      }

      if (!window.confirm(t('quickRepliesSettings.importConfirm', {
        current: quickReplies.length,
        incoming: result.replies.length,
      }))) {
        return;
      }

      writeQuickReplies(result.replies);
      setImportFeedback(result.skipped > 0 ? { kind: 'skipped', count: result.skipped } : null);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('quickRepliesSettings.title')}
        description={t('quickRepliesSettings.description')}
      >
        <SettingsCard divided className="overflow-hidden">
          {quickReplies.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t('quickRepliesSettings.empty')}
            </p>
          )}

          {quickReplies.map((reply, index) => (
            <div
              // Snippets have no id: they are a user-ordered list of two strings,
              // and the row's position is what identifies it to the buttons below.
              key={index}
              className="flex flex-wrap items-center gap-2 px-3 py-1.5"
            >
              <span className="hidden w-6 shrink-0 select-none text-right text-xs tabular-nums leading-none text-muted-foreground/60 sm:block">
                {index + 1}
              </span>
              <Input
                value={reply.label ?? ''}
                onChange={(event) => writeQuickReplies(
                  setQuickReplyAt(quickReplies, index, { label: event.target.value }),
                )}
                maxLength={MAX_QUICK_REPLY_LABEL_LENGTH}
                // An empty name means "name this row by its text", which is what
                // the placeholder shows.
                placeholder={quickReplyLabel(reply)}
                aria-label={t('quickRepliesSettings.labelField')}
                // Idle rows read as editable text, not as a stack of nested
                // boxes: the border only appears on hover/focus.
                className="h-8 w-28 shrink-0 border-transparent bg-transparent px-2 shadow-none hover:border-input sm:w-32"
              />
              <Input
                value={reply.text}
                onChange={(event) => writeQuickReplies(
                  setQuickReplyAt(quickReplies, index, { text: event.target.value }),
                )}
                maxLength={MAX_QUICK_REPLY_TEXT_LENGTH}
                aria-label={t('quickRepliesSettings.textField')}
                className="h-8 min-w-32 flex-1 border-transparent bg-transparent px-2 shadow-none hover:border-input"
              />
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  disabled={index === 0}
                  onClick={() => writeQuickReplies(moveQuickReply(quickReplies, index, -1))}
                  aria-label={t('quickRepliesSettings.moveUp')}
                  title={t('quickRepliesSettings.moveUp')}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  disabled={index === quickReplies.length - 1}
                  onClick={() => writeQuickReplies(moveQuickReply(quickReplies, index, 1))}
                  aria-label={t('quickRepliesSettings.moveDown')}
                  title={t('quickRepliesSettings.moveDown')}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => writeQuickReplies(removeQuickReplyAt(quickReplies, index))}
                  aria-label={t('quickRepliesSettings.remove')}
                  title={t('quickRepliesSettings.remove')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-3 py-2.5">
            <span aria-hidden="true" className="hidden w-6 shrink-0 sm:block" />
            <Input
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              maxLength={MAX_QUICK_REPLY_LABEL_LENGTH}
              placeholder={t('quickRepliesSettings.labelPlaceholder')}
              aria-label={t('quickRepliesSettings.labelField')}
              className="h-8 w-28 shrink-0 px-2 shadow-none sm:w-32"
            />
            <Input
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleAdd();
                }
              }}
              maxLength={MAX_QUICK_REPLY_TEXT_LENGTH}
              placeholder={t('quickRepliesSettings.textPlaceholder')}
              aria-label={t('quickRepliesSettings.textField')}
              className="h-8 min-w-32 flex-1 px-2 shadow-none"
            />
            <Button onClick={handleAdd} disabled={!canAdd} size="sm" className="h-8 px-3">
              <Plus className="h-4 w-4" />
              {t('quickRepliesSettings.add')}
            </Button>
          </div>
        </SettingsCard>

        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {atLimit
              ? t('quickRepliesSettings.limitReached', { max: MAX_QUICK_REPLIES })
              : t('quickRepliesSettings.limit', {
                used: quickReplies.length,
                max: MAX_QUICK_REPLIES,
              })}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-muted-foreground hover:text-foreground"
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            {t('quickRepliesSettings.export')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {t('quickRepliesSettings.import')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            className="hidden"
            aria-label={t('quickRepliesSettings.importFile')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared before reading so picking the same file twice still fires.
              event.target.value = '';
              if (file) {
                handleImportFile(file);
              }
            }}
          />
        </div>
        {importFeedback && (
          <p
            role="status"
            className={
              importFeedback.kind === 'error'
                ? 'text-xs text-destructive'
                : 'text-xs text-muted-foreground'
            }
          >
            {importFeedback.kind === 'error'
              ? t('quickRepliesSettings.importEmpty')
              : t('quickRepliesSettings.importSkipped', { count: importFeedback.count })}
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
