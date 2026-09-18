import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import SettingsSection from '@/modules/settings/SettingsSection';
import { Button, Input } from '@/shared/ui';
import { useQuickReplies } from '@/shared/hooks/useQuickReplies';
import {
  MAX_QUICK_REPLIES,
  MAX_QUICK_REPLY_LABEL_LENGTH,
  MAX_QUICK_REPLY_TEXT_LENGTH,
  addQuickReply,
  moveQuickReply,
  quickReplyLabel,
  removeQuickReplyAt,
  setQuickReplyAt,
  writeQuickReplies,
} from '@/shared/quickReplies';

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

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('quickRepliesSettings.title')}
        description={t('quickRepliesSettings.description')}
      >
        <div className="space-y-3">
          {quickReplies.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('quickRepliesSettings.empty')}</p>
          )}

          {quickReplies.map((reply, index) => (
            <div
              // Snippets have no id: they are a user-ordered list of two strings,
              // and the row's position is what identifies it to the buttons below.
              key={index}
              className="space-y-2 rounded-lg border border-border p-3"
            >
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {quickReplyLabel(reply)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
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
                  className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
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
                  className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => writeQuickReplies(removeQuickReplyAt(quickReplies, index))}
                  aria-label={t('quickRepliesSettings.remove')}
                  title={t('quickRepliesSettings.remove')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                />
                <Input
                  value={reply.text}
                  onChange={(event) => writeQuickReplies(
                    setQuickReplyAt(quickReplies, index, { text: event.target.value }),
                  )}
                  maxLength={MAX_QUICK_REPLY_TEXT_LENGTH}
                  aria-label={t('quickRepliesSettings.textField')}
                  className="sm:col-span-2"
                />
              </div>
            </div>
          ))}

          <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
                maxLength={MAX_QUICK_REPLY_LABEL_LENGTH}
                placeholder={t('quickRepliesSettings.labelPlaceholder')}
                aria-label={t('quickRepliesSettings.labelField')}
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
                className="sm:col-span-2"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {atLimit
                  ? t('quickRepliesSettings.limitReached', { max: MAX_QUICK_REPLIES })
                  : t('quickRepliesSettings.limit', {
                    used: quickReplies.length,
                    max: MAX_QUICK_REPLIES,
                  })}
              </p>
              <Button onClick={handleAdd} disabled={!canAdd} size="sm" className="h-9 px-4">
                <Plus className="h-4 w-4" />
                {t('quickRepliesSettings.add')}
              </Button>
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
