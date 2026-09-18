import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ZapIcon } from 'lucide-react';

import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';
import { PromptInputButton } from '@/modules/chat/composer/PromptInput';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { useQuickReplies } from '@/shared/hooks/useQuickReplies';
import { isQuickReplyUsable, quickReplyLabel } from '@/shared/quickReplies';
import type { QuickReply } from '@/shared/types';

type QuickReplyMenuProps = {
  /** Receives the picked snippet; the composer owns composing the text and inserting it. */
  onInsert: (reply: QuickReply) => void;
};

/**
 * Rendered by chat's ChatComposer as its quick reply button and the popover
 * listing the user's saved snippets.
 *
 * Reads the list itself rather than taking it as a prop, because the same list
 * is edited in Settings and only this button and that editor care about it.
 */
function QuickReplyMenu({ onInsert }: QuickReplyMenuProps) {
  const { t } = useTranslation('chat');
  const replies = useQuickReplies();
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close);

  // Only snippets that have text are offered: a row being retyped in Settings
  // would otherwise appear here as a nameless row that inserts nothing.
  const usableReplies = replies.filter(isQuickReplyUsable);

  // Nothing to offer means nothing to open; the way back is Settings › Quick replies.
  if (usableReplies.length === 0) {
    return null;
  }

  const ariaLabel = t('quickReplies.button', { defaultValue: 'Quick replies' });

  return (
    <>
      <PromptInputButton
        ref={triggerRef}
        // No tooltip while the list is open: the bubble floats in the same space
        // the popover opens into and paints over its bottom rows.
        tooltip={isOpen ? undefined : { content: ariaLabel }}
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="relative"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <ZapIcon />
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {usableReplies.length}
        </span>
      </PromptInputButton>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          {/* Titles the list and its size the way the slash-command palette titles
              its groups, so the two composer popovers read as one family. */}
          <ComposerMenuHeading>
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <ZapIcon aria-hidden="true" className="h-3 w-3" />
                {ariaLabel}
              </span>
              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                {usableReplies.length}
              </span>
            </span>
          </ComposerMenuHeading>
          {usableReplies.map((reply, index) => (
            <ComposerMenuItem
              key={`${index}-${reply.text}`}
              role="menuitem"
              // Roomier than the other composer menus' rows: these are picked with
              // a thumb on a phone far more often than they are clicked.
              className="min-h-10"
              // The same leading tile the slash-command palette gives its rows,
              // tinted with the badge's colour so the two lists read as one
              // family and the rows do not look like bare text on a wide sheet.
              icon={(
                <span className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                  <ZapIcon aria-hidden="true" className="h-3.5 w-3.5" />
                </span>
              )}
              label={quickReplyLabel(reply)}
              // Only a snippet named differently from its text needs the second line.
              description={reply.label?.trim() ? reply.text : undefined}
              isSelected={false}
              onSelect={() => {
                onInsert(reply);
                close();
              }}
            />
          ))}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke, and this only changes with the stored list. */
export default memo(QuickReplyMenu);
