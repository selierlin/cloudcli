import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Square } from 'lucide-react';

import type { PendingPermissionRequest } from '@/shared/types';
import { Button } from '@/shared/ui';
import PermissionRequestsBanner from '@/modules/chat/composer/PermissionRequestsBanner';

type BtwComposerProps = {
  /** True while the copy is being created, closed, or already running a turn. */
  disabled: boolean;
  isProcessing: boolean;
  canAbort: boolean;
  /** Shown read-only: the drawer mirrors the main conversation's mode. */
  permissionModeLabel: string;
  permissionRequests: PendingPermissionRequest[];
  onPermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  /** True when the question was accepted; false keeps the text in the box. */
  onSend: (text: string) => Promise<boolean>;
  onAbort: () => void;
};

/** Input for the side-question drawer; used only by BtwDrawer. */
export default function BtwComposer({
  disabled,
  isProcessing,
  canAbort,
  permissionModeLabel,
  permissionRequests,
  onPermissionDecision,
  onGrantToolPermission,
  onSend,
  onAbort,
}: BtwComposerProps) {
  const { t } = useTranslation('chat');
  // The question being typed. Local to the drawer: a half-written aside must
  // never appear in the main composer's draft.
  const [input, setInput] = useState('');
  // A question is in flight (create + websocket send). Held locally because the
  // run-state frame only arrives after the round-trip.
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Safari reports `compositionend` before the confirming Enter's keydown, so
  // `isComposing` is already false there; a short window after the commit is
  // what tells a confirmed IME candidate apart from a second, real keypress.
  const compositionEndedAtRef = useRef(0);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = useCallback(async () => {
    const content = input.trim();
    if (!content || disabled || sending) {
      return;
    }
    setSending(true);
    try {
      // Keep the text visible until the copy accepted it: a refused create must
      // not also throw away what the reader just typed.
      if (await onSend(content)) {
        setInput('');
      }
    } finally {
      setSending(false);
    }
  }, [disabled, input, onSend, sending]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    if (event.nativeEvent.isComposing || Date.now() - compositionEndedAtRef.current < 30) {
      return;
    }
    event.preventDefault();
    submit();
  }, [submit]);

  const canSend = Boolean(input.trim()) && !disabled && !sending;

  return (
    <div
      className="btw-composer border-t border-border/70"
      // Same reason as the main composer (`.chat-composer-safe-bottom`): the
      // drawer already ends at the keyboard's top edge, so keeping the home
      // indicator's inset while the keyboard is up would float the input above
      // it. Only the part not already covered by the keyboard is real.
      style={{ paddingBottom: 'max(0px, env(safe-area-inset-bottom, 0px) - var(--keyboard-height, 0px))' }}
    >
      {permissionRequests.length > 0 && (
        <div className="px-3 pt-3">
          <PermissionRequestsBanner
            pendingPermissionRequests={permissionRequests}
            handlePermissionDecision={onPermissionDecision}
            handleGrantToolPermission={onGrantToolPermission}
          />
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionEnd={() => {
            compositionEndedAtRef.current = Date.now();
          }}
          rows={2}
          placeholder={t('sideAsk.input.placeholder')}
          aria-label={t('sideAsk.input.placeholder')}
          className="btw-input max-h-40 min-h-11 flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />

        {isProcessing && canAbort ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-9 w-9 flex-shrink-0"
            title={t('sideAsk.input.stop')}
            aria-label={t('sideAsk.input.stop')}
            onClick={onAbort}
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 flex-shrink-0"
            disabled={!canSend}
            title={t('sideAsk.input.send')}
            aria-label={t('sideAsk.input.send')}
            onClick={submit}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>

      <p className="px-3 pb-2 text-[11px] text-muted-foreground">
        {permissionModeLabel}
      </p>
    </div>
  );
}
