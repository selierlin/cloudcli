import type { IDisposable, Terminal } from '@xterm/xterm';

import { isTouchSelectionEnvironment } from '@/modules/shell/utils/mobileTerminalSelection';

/**
 * Fallback relay for third-party soft keyboards (Doubao, Sogou, …) on touch
 * devices that commit text with an `input` event *after* firing a keydown —
 * usually keyCode 229. xterm 5.5's `_inputEvent` handler only accepts
 * `insertText` events with no preceding keydown (`!e.composed ||
 * !this._keyDownSeen`), so exactly that shape is skipped: the text lands in
 * the hidden textarea's value and never reaches the pty.
 *
 * The listener is registered after xterm's own (capture-phase) `input`
 * listener, so any event xterm did handle has already been passed through its
 * `cancel()` and arrives here with `defaultPrevented` set — that, plus the
 * composition guards, is what prevents double-sends. xterm never drains the
 * textarea's value itself (it only clears on blur and on the CR/ETX keydown),
 * so this tracks the value and clears it after a successful relay.
 *
 * Installed only in touch environments: on desktop a printable key can reach
 * xterm via the keypress path without cancelling the later input event, and
 * relaying it here too would duplicate it.
 */
export function installMobileImeInputFallback(
  terminal: Terminal,
  send: (data: string) => void,
): IDisposable | null {
  if (!isTouchSelectionEnvironment()) {
    return null;
  }

  const textarea = terminal.textarea;
  if (!textarea) {
    return null;
  }

  let isComposing = false;
  let lastValue = '';

  const onCompositionStart = (): void => {
    isComposing = true;
  };

  const onCompositionEnd = (): void => {
    isComposing = false;
    // xterm's own compositionend handler already relayed the composed text,
    // but the value still holds it — re-baseline instead of relaying it again.
    lastValue = textarea.value;
  };

  const onInput = (event: InputEvent): void => {
    if (event.defaultPrevented || isComposing || event.isComposing) {
      lastValue = textarea.value;
      return;
    }

    const value = textarea.value;
    if (!value) {
      return;
    }

    // Deletions and undo cannot be reconstructed as pty input here (xterm
    // normally takes them via keydown anyway); re-baseline so the next
    // insertion's delta stays correct.
    if (typeof event.inputType === 'string' && event.inputType.startsWith('delete')) {
      lastValue = value;
      return;
    }

    const delta = value.startsWith(lastValue) ? value.slice(lastValue.length) : value;
    if (delta) {
      send(delta);
    }

    textarea.value = '';
    lastValue = '';
  };

  textarea.addEventListener('compositionstart', onCompositionStart);
  textarea.addEventListener('compositionend', onCompositionEnd);
  textarea.addEventListener('input', onInput as EventListener);

  return {
    dispose: () => {
      textarea.removeEventListener('compositionstart', onCompositionStart);
      textarea.removeEventListener('compositionend', onCompositionEnd);
      textarea.removeEventListener('input', onInput as EventListener);
    },
  };
}
