import type { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installMobileImeInputFallback } from '@/modules/shell/utils/mobileImeInputFallback';

type FireInputOptions = {
  value: string;
  inputType?: string;
  data?: string | null;
  isComposing?: boolean;
  // Simulates xterm's own input handler having cancelled the event first.
  cancelledByXterm?: boolean;
};

function makeTextarea(): HTMLTextAreaElement {
  return document.createElement('textarea');
}

function makeTerminal(textarea: HTMLTextAreaElement): Terminal {
  return { textarea } as unknown as Terminal;
}

function fireInput(textarea: HTMLTextAreaElement, options: FireInputOptions): void {
  const event = new InputEvent('input', {
    inputType: options.inputType ?? 'insertText',
    data: options.data ?? null,
    isComposing: options.isComposing ?? false,
    cancelable: true,
  });
  if (options.cancelledByXterm) {
    event.preventDefault();
  }
  textarea.value = options.value;
  textarea.dispatchEvent(event);
}

describe('mobile IME input fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as { ontouchstart?: unknown }).ontouchstart;
  });

  // The vitest jsdom environment always defines `ontouchstart`, so the
  // non-touch case only exists while that marker is removed.
  it('installs nothing outside touch environments', () => {
    delete (window as { ontouchstart?: unknown }).ontouchstart;
    const textarea = makeTextarea();
    const fallback = installMobileImeInputFallback(makeTerminal(textarea), vi.fn());

    expect(fallback).toBeNull();
  });

  describe('in a touch environment', () => {
    function install(textarea: HTMLTextAreaElement, send: (data: string) => void = vi.fn()) {
      // jsdom has no maxTouchPoints or matchMedia; the legacy ontouchstart
      // marker is the one touch signal that can be stubbed via a global.
      vi.stubGlobal('ontouchstart', undefined);
      return installMobileImeInputFallback(makeTerminal(textarea), send);
    }

    it('relays committed insertText and clears the textarea', () => {
      const textarea = makeTextarea();
      const send = vi.fn();
      const fallback = install(textarea, send);
      expect(fallback).not.toBeNull();

      fireInput(textarea, { value: '你好' });

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('你好');
      expect(textarea.value).toBe('');
      fallback?.dispose();
    });

    it('skips events xterm already handled and keeps the baseline in sync', () => {
      const textarea = makeTextarea();
      const send = vi.fn();
      const fallback = install(textarea, send)!;

      fireInput(textarea, { value: 'ab', cancelledByXterm: true });
      expect(send).not.toHaveBeenCalled();
      expect(textarea.value).toBe('ab');

      // The next real insertion only relays the delta past the synced baseline.
      fireInput(textarea, { value: 'abc' });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('c');
      fallback.dispose();
    });

    it('stays silent while a composition is in progress', () => {
      const textarea = makeTextarea();
      const send = vi.fn();
      const fallback = install(textarea, send)!;

      textarea.dispatchEvent(new Event('compositionstart'));
      fireInput(textarea, { value: 'nihao', isComposing: true });
      expect(send).not.toHaveBeenCalled();

      // compositionend: xterm already relayed the composed text itself, so the
      // leftover value is only re-baselined, never sent.
      textarea.dispatchEvent(new Event('compositionend'));
      expect(send).not.toHaveBeenCalled();

      fireInput(textarea, { value: '好' });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('好');
      fallback.dispose();
    });

    it('does not relay deletions', () => {
      const textarea = makeTextarea();
      const send = vi.fn();
      const fallback = install(textarea, send)!;

      fireInput(textarea, { value: 'abc', inputType: 'insertText' });
      expect(send).toHaveBeenCalledTimes(1);

      send.mockClear();
      fireInput(textarea, { value: 'ab', inputType: 'deleteContentBackward' });
      expect(send).not.toHaveBeenCalled();

      // After a rebaselining deletion the next insertion relays only the delta.
      fireInput(textarea, { value: 'abd' });
      expect(send).toHaveBeenCalledWith('d');
      fallback.dispose();
    });

    it('stops relaying after dispose', () => {
      const textarea = makeTextarea();
      const send = vi.fn();
      const fallback = install(textarea, send)!;

      fallback.dispose();
      fireInput(textarea, { value: 'x' });

      expect(send).not.toHaveBeenCalled();
    });
  });
});
