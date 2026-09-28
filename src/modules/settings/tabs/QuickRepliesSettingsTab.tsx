import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

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

        <p className="text-xs text-muted-foreground">
          {atLimit
            ? t('quickRepliesSettings.limitReached', { max: MAX_QUICK_REPLIES })
            : t('quickRepliesSettings.limit', {
              used: quickReplies.length,
              max: MAX_QUICK_REPLIES,
            })}
        </p>
      </SettingsSection>
    </div>
  );
}
