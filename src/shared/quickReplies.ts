import { readUserPreference, writeUserPreference } from '@/shared/userSettings';
import type { QuickReply } from '@/shared/types';

/**
 * The user's reusable composer snippets: a short name and the text it inserts
 * into the composer box.
 *
 * The whole list is one JSON array under the `quickReplies` preference key, so
 * it follows the user from device to device the way drafts and the other
 * settings do, without a table of its own on the server. Until the user edits
 * the list, the snippets shipped with the app are rendered from i18n instead of
 * being seeded into the preference — which is what keeps them in the reader's
 * own language — and so `[]` means the user deleted every snippet and must keep
 * an empty list rather than having the defaults appear again.
 */

/** Most snippets one user can keep; the settings editor refuses to add past it. */
export const MAX_QUICK_REPLIES = 50;

/** Longest name a snippet row may show. */
export const MAX_QUICK_REPLY_LABEL_LENGTH = 24;

/** Longest text a snippet may insert. */
export const MAX_QUICK_REPLY_TEXT_LENGTH = 200;

/**
 * The snippets shipped with the app, as keys in the `chat` i18n namespace.
 *
 * `textKey` is what gets inserted; `labelKey` names the row when that name
 * differs from the text, and is absent when the two are the same. The order is
 * the display order, most-reached-for openings first, so the rows a phone shows
 * without scrolling are the ones typed most often.
 */
const DEFAULT_QUICK_REPLY_KEYS: Array<{ labelKey?: string; textKey: string }> = [
  { textKey: 'quickReplies.defaults.continue' },
  { textKey: 'quickReplies.defaults.goAhead' },
  { textKey: 'quickReplies.defaults.confirm' },
  { textKey: 'quickReplies.defaults.ok' },
  { textKey: 'quickReplies.defaults.fixIt' },
  { textKey: 'quickReplies.defaults.commit' },
  { textKey: 'quickReplies.defaults.push' },
  { textKey: 'quickReplies.defaults.done' },
  { textKey: 'quickReplies.defaults.dontActYet' },
  { labelKey: 'quickReplies.defaults.assessImpact.label', textKey: 'quickReplies.defaults.assessImpact.text' },
  { labelKey: 'quickReplies.defaults.planFirst.label', textKey: 'quickReplies.defaults.planFirst.text' },
  { labelKey: 'quickReplies.defaults.analyze.label', textKey: 'quickReplies.defaults.analyze.text' },
  { labelKey: 'quickReplies.defaults.debug.label', textKey: 'quickReplies.defaults.debug.text' },
  { labelKey: 'quickReplies.defaults.resumeInterrupted.label', textKey: 'quickReplies.defaults.resumeInterrupted.text' },
  { labelKey: 'quickReplies.defaults.howToVerify.label', textKey: 'quickReplies.defaults.howToVerify.text' },
];

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/**
 * Rewrites one entry into its stored shape, or drops it.
 *
 * Deliberately lossless for anything the editor can produce: it never trims or
 * truncates, because a normalizing round-trip through the preference store
 * would fight the user's own typing in a controlled input. Length limits are
 * held by the editor's `maxLength` attributes instead.
 */
const toStoredQuickReply = (entry: unknown): QuickReply | null => {
  if (!isRecord(entry) || typeof entry.text !== 'string') {
    return null;
  }

  return typeof entry.label === 'string'
    ? { label: entry.label, text: entry.text }
    : { text: entry.text };
};

/** Keeps only what can be a snippet, and never more than `MAX_QUICK_REPLIES` of them. */
export const normalizeQuickReplies = (value: unknown): QuickReply[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const replies: QuickReply[] = [];
  for (const entry of value) {
    const reply = toStoredQuickReply(entry);
    if (reply) {
      replies.push(reply);
    }
    if (replies.length === MAX_QUICK_REPLIES) {
      break;
    }
  }

  return replies;
};

/**
 * The stored snippets, or `null` when the user has never edited the list.
 *
 * `null` and `[]` are different answers: `null` renders the shipped defaults,
 * while `[]` is a user who deleted every snippet and must not see them return.
 */
export const readStoredQuickReplies = (): QuickReply[] | null => {
  const stored = readUserPreference<unknown>('quickReplies', null);
  return stored === null ? null : normalizeQuickReplies(stored);
};

/**
 * Replaces the whole list.
 *
 * Nothing is validated on the server: the preference store writes the mirror
 * immediately and the server on a short debounce, which is what carries the
 * list to another device.
 */
export const writeQuickReplies = (replies: QuickReply[]): void => {
  writeUserPreference('quickReplies', normalizeQuickReplies(replies));
};

/** Resolves the shipped snippets through i18n; used wherever the stored list is unset. */
export const resolveDefaultQuickReplies = (
  translate: (key: string) => string,
): QuickReply[] => DEFAULT_QUICK_REPLY_KEYS.map(({ labelKey, textKey }) => (
  labelKey
    ? { label: translate(labelKey), text: translate(textKey) }
    : { text: translate(textKey) }
));

/** The name a snippet shows: its label, or the text it inserts when it has none. */
export const quickReplyLabel = (reply: QuickReply): string => (
  reply.label?.trim() ? reply.label : reply.text
);

/** Whether a snippet is finished enough to be offered; a row still being typed may not be. */
export const isQuickReplyUsable = (reply: QuickReply): boolean => reply.text.trim() !== '';

/**
 * The composer text an insert produces.
 *
 * A snippet is appended to whatever is already typed, separated by a space —
 * except one that starts with `/`, which replaces the box instead: the send
 * path only reads a leading `/` as a command when it is the first character, so
 * a slash snippet appended behind other text would silently degrade into prose.
 */
export const composeQuickReplyInput = (current: string, text: string): string => {
  if (text.startsWith('/')) {
    return text;
  }

  const base = current.trim();
  return base ? `${base} ${text}` : text;
};

/** Appends a snippet, or returns the list unchanged once it is full. */
export const addQuickReply = (replies: QuickReply[], reply: QuickReply): QuickReply[] => (
  replies.length >= MAX_QUICK_REPLIES ? replies : [...replies, reply]
);

/** Removes one row; an index off either end is a no-op. */
export const removeQuickReplyAt = (replies: QuickReply[], index: number): QuickReply[] => (
  index < 0 || index >= replies.length ? replies : replies.filter((_, at) => at !== index)
);

/** Edits one row; an index off either end is a no-op. */
export const setQuickReplyAt = (
  replies: QuickReply[],
  index: number,
  patch: Partial<QuickReply>,
): QuickReply[] => (
  index < 0 || index >= replies.length
    ? replies
    : replies.map((reply, at) => (at === index ? { ...reply, ...patch } : reply))
);

/** Swaps a row with the neighbour `offset` positions away; a move off either end is a no-op. */
export const moveQuickReply = (
  replies: QuickReply[],
  index: number,
  offset: number,
): QuickReply[] => {
  const target = index + offset;
  if (index < 0 || index >= replies.length || target < 0 || target >= replies.length) {
    return replies;
  }

  const next = [...replies];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};
