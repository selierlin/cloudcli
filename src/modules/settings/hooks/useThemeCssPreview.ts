import { useEffect, useState } from 'react';

import type { AddPastedThemeFailure, PastedThemeFormat } from '@/shared/userThemePastes';
import { compilePastedTheme } from '@/shared/userThemePastes';
import { previewUserThemeStyle } from '@/shared/userThemeStyles';

/**
 * The live preview for the paste box's advanced mode (§5.5).
 *
 * The preview is the page wearing the draft: the settings page compiles the text
 * with the same function the paste path uses and injects the result as a
 * document-level stylesheet, so what is on screen while typing is what the paste
 * would produce. It is deliberately neither stored nor cached — a preview that
 * survived a reload would be a theme the user never asked for — and it is the
 * module that owns the document's stylesheets that injects it
 * (`previewUserThemeStyle`), so a later cleanup cannot miss it.
 *
 * The draft is put on the page after typing pauses rather than on every
 * keystroke: compiling a stylesheet and repainting the whole app per character
 * would make the box feel heavy, and a half-written rule is rarely what the
 * author wants to look at. Whatever is shown stays shown until a later draft
 * replaces it, so pausing mid-word does not blink the page back to the old theme.
 *
 * Only advanced mode has a preview. A token JSON is option A, and its result is
 * a block of declarations the page could wear the same way — but §5.5 puts the
 * editor and the preview on the advanced switch, and a preview nobody asked for
 * would be a second feature rather than this one.
 */

/** How long typing has to pause before the draft is put on the page. */
const PREVIEW_DEBOUNCE_MS = 300;

/** What the preview is doing, for the section to report beside the box. */
export type ThemeCssPreviewState =
  | { kind: 'idle' }
  | { kind: 'previewing' }
  | { kind: 'unavailable'; reason: AddPastedThemeFailure };

/** The one idle value, so "nothing is being previewed" is a stable result. */
const IDLE: ThemeCssPreviewState = { kind: 'idle' };

/**
 * The outcome of one compilation, tagged with the draft it was about.
 *
 * The tag is what keeps a result from being reported against text it did not
 * come from: while the next draft waits out the debounce, the previous attempt
 * still exists but says nothing about what is in the box now.
 */
type PreviewAttempt = {
  draft: string;
  outcome: ThemeCssPreviewState;
};

/** Used by `UserThemesSection` to keep the page wearing the draft being edited. */
export function useThemeCssPreview(
  format: PastedThemeFormat,
  draft: string,
): ThemeCssPreviewState {
  // The last compilation's verdict, kept as state because only the debounced
  // effect below can produce it. It is never read without first checking that it
  // is about the current draft.
  const [attempt, setAttempt] = useState<PreviewAttempt | null>(null);

  // Whether a preview is wanted at all, derived during render so that clearing
  // the box — or switching back to option A — reports idle immediately rather
  // than one effect later.
  const wantsPreview = format === 'css' && draft.trim().length > 0;

  useEffect(() => {
    if (!wantsPreview) {
      previewUserThemeStyle(null);
      return;
    }

    const timer = setTimeout(() => {
      // The id and name are never read on this branch: a stylesheet declares no
      // metadata, and the entry it becomes gets its own id when it is stored.
      // They are here because the compiler's input is a whole entry, and
      // leaving them out would be pretending this is a different call.
      const compiled = compilePastedTheme({
        id: 'paste-preview',
        name: '',
        content: draft,
        format: 'css',
      });
      if (!compiled.ok) {
        previewUserThemeStyle(null);
        setAttempt({ draft, outcome: { kind: 'unavailable', reason: compiled.reason } });
        return;
      }
      previewUserThemeStyle(compiled.css);
      setAttempt({ draft, outcome: { kind: 'previewing' } });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [draft, wantsPreview]);

  // Leaving the page takes the preview with it. Separate from the effect above,
  // whose cleanup runs on every keystroke and has to leave the current preview
  // alone — a later draft is what replaces it.
  useEffect(() => () => previewUserThemeStyle(null), []);

  return wantsPreview && attempt?.draft === draft ? attempt.outcome : IDLE;
}
