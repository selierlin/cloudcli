import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { readStoredQuickReplies, resolveDefaultQuickReplies } from '@/shared/quickReplies';
import type { QuickReply } from '@/shared/types';
import { subscribeToUserPreferences } from '@/shared/userSettings';

/**
 * The quick replies to offer — the stored list, or the shipped defaults when
 * the user has never edited it. Read by chat's quick reply menu and by the
 * settings tab that edits the list.
 *
 * Only the stored list is state: the shipped defaults are resolved during
 * render from the `chat` namespace, so a list the user never edited follows a
 * language change without another read, and an emptied list stays empty. One
 * subscription covers both a write made in this tab (the store notifies the
 * writing tab synchronously) and one arriving with a hydrated preference from
 * another device.
 */
export function useQuickReplies(): QuickReply[] {
  const { t } = useTranslation('chat');

  // Mirrors the stored list so an edit made anywhere else re-renders the
  // composer button and the settings rows without a read on every render.
  const [stored, setStored] = useState(readStoredQuickReplies);

  useEffect(() => subscribeToUserPreferences(() => setStored(readStoredQuickReplies())), []);

  return stored ?? resolveDefaultQuickReplies(t);
}
