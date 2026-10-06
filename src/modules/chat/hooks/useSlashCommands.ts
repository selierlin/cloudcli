import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';

import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';
import { useProjectSlashCommands } from '@/shared/hooks/useProjectSlashCommands';
import type { LLMProvider, Project, SlashCommand } from '@/shared/types';
import { isSkillCommand } from '@/shared/utils';

const COMMAND_QUERY_DEBOUNCE_MS = 150;

/**
 * Stable fallback for the `commandUsage` preference, used both as a read
 * default and as the `getSnapshot` result when nothing has been recorded yet.
 *
 * It has to be a module-level constant rather than a `{}` literal: `getSnapshot`
 * returning a fresh object on every call reads as an endless change and
 * re-renders forever.
 */
const EMPTY_COMMAND_USAGE: Record<string, number> = {};

const readCommandUsage = (): Record<string, number> =>
  readUserPreference('commandUsage', EMPTY_COMMAND_USAGE);

type UseSlashCommandsOptions = {
  selectedProject: Project | null;
  provider: LLMProvider;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onExecuteCommand: (command: SlashCommand, rawInput?: string) => void | Promise<void>;
};

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
  Boolean(value) && typeof (value as Promise<unknown>).then === 'function';

const filterSlashCommands = (
  commands: SlashCommand[],
  query: string,
): SlashCommand[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return commands;
  }

  const commandPrefix = normalizedQuery.startsWith('/')
    ? normalizedQuery
    : `/${normalizedQuery}`;
  const namePrefixMatches = commands.filter((command) =>
    command.name.toLowerCase().startsWith(commandPrefix),
  );

  // Namespaced commands should behave like path completion. Once a provider
  // namespace is typed, only exact command-prefix matches should stay visible.
  if (normalizedQuery.includes(':') || namePrefixMatches.length > 0) {
    return namePrefixMatches;
  }

  const nameSubstringMatches = commands.filter((command) =>
    command.name.toLowerCase().includes(normalizedQuery),
  );
  if (nameSubstringMatches.length > 0) {
    return nameSubstringMatches;
  }

  return commands.filter((command) =>
    command.description?.toLowerCase().includes(normalizedQuery),
  );
};

export function useSlashCommands({
  selectedProject,
  provider,
  input,
  setInput,
  textareaRef,
  onExecuteCommand,
}: UseSlashCommandsOptions) {
  const { commands: projectCommands } = useProjectSlashCommands(selectedProject, provider);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);

  const commandQueryTimerRef = useRef<number | null>(null);

  // The subscription is what makes the "frequent" list catch up after hydrate
  // finishes: the preference is read from an in-memory mirror at first paint,
  // and the server's copy only lands once the session is up. Reading through
  // the external store also re-renders on every recorded pick, so the menu
  // reflects a new count immediately. See §3.3 of the sync plan.
  const commandUsage = useSyncExternalStore(subscribeToUserPreferences, readCommandUsage);

  const clearCommandQueryTimer = useCallback(() => {
    if (commandQueryTimerRef.current !== null) {
      window.clearTimeout(commandQueryTimerRef.current);
      commandQueryTimerRef.current = null;
    }
  }, []);

  const resetCommandMenuState = useCallback(() => {
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);
    clearCommandQueryTimer();
  }, [clearCommandQueryTimer]);

  // The shared list ordered by this project's usage history, most-used first,
  // so the menu surfaces what the user actually reaches for.
  const slashCommands = useMemo<SlashCommand[]>(() => {
    if (!selectedProject) {
      return [];
    }

    // Order by recorded usage, read once from the mirror instead of the
    // subscribed `commandUsage`: re-sorting mid-session would reorder the open
    // menu under the pointer. The trade-off is that the non-frequent order can
    // lag a hydrate until the project or provider changes.
    const parsedHistory = readCommandUsage();
    return [...projectCommands].sort((commandA, commandB) => {
      const commandAUsage = parsedHistory[commandA.name] || 0;
      const commandBUsage = parsedHistory[commandB.name] || 0;
      return commandBUsage - commandAUsage;
    });
  }, [projectCommands, selectedProject]);

  useEffect(() => {
    if (!showCommandMenu) {
      setSelectedCommandIndex(-1);
    }
  }, [showCommandMenu]);

  useEffect(() => {
    setFilteredCommands(filterSlashCommands(slashCommands, commandQuery));
  }, [commandQuery, slashCommands]);

  // Derived from `slashCommands`, which is this project's own scanned command
  // and skill list — so a name recorded in some other project, or a project-
  // level skill that does not exist here, can never surface in this menu. That
  // filtering is a contract, not an accident: keep the source list, never list
  // the global usage map on its own.
  const frequentCommands = useMemo(() => {
    if (!selectedProject || slashCommands.length === 0) {
      return [];
    }

    return slashCommands
      .map((command) => ({
        ...command,
        usageCount: commandUsage[command.name] || 0,
      }))
      .filter((command) => command.usageCount > 0)
      .sort((commandA, commandB) => commandB.usageCount - commandA.usageCount)
      .slice(0, 5);
  }, [selectedProject, slashCommands, commandUsage]);

  const trackCommandUsage = useCallback(
    (command: SlashCommand) => {
      if (!selectedProject) {
        return;
      }

      // Copy before changing. `readUserPreference` hands back the very object
      // the store holds, and `writeUserPreference` short-circuits when the new
      // value stringifies equal to the old one — so mutating that object in
      // place would make this write a silent no-op: the count would look right
      // in memory but never reach the mirror, the server or the subscribers.
      const next = { ...readCommandUsage() };
      next[command.name] = (next[command.name] ?? 0) + 1;
      writeUserPreference('commandUsage', next);
    },
    [selectedProject],
  );

  const insertCommandIntoInput = useCallback(
    (command: SlashCommand) => {
      const currentTextarea = textareaRef.current;
      const insertionStart = slashPosition >= 0
        ? slashPosition
        : currentTextarea?.selectionStart ?? input.length;
      const textBeforeCommand = input.slice(0, insertionStart);
      const textAfterCommandStart = input.slice(insertionStart);
      const spaceIndex = textAfterCommandStart.indexOf(' ');
      const textAfterCommand = slashPosition >= 0 && spaceIndex !== -1
        ? textAfterCommandStart.slice(spaceIndex).trimStart()
        : input.slice(currentTextarea?.selectionEnd ?? insertionStart);
      const separator = textBeforeCommand && !/\s$/.test(textBeforeCommand) ? ' ' : '';
      const newInput = `${textBeforeCommand}${separator}${command.name}${textAfterCommand ? ` ${textAfterCommand}` : ' '}`;

      setInput(newInput);
      resetCommandMenuState();

      window.requestAnimationFrame(() => {
        currentTextarea?.focus();
        const nextCursorPosition = `${textBeforeCommand}${separator}${command.name} `.length;
        currentTextarea?.setSelectionRange(nextCursorPosition, nextCursorPosition);
      });
    },
    [input, resetCommandMenuState, setInput, slashPosition, textareaRef],
  );

  const executeNonSkillCommand = useCallback(
    (command: SlashCommand) => {
      const executionResult = onExecuteCommand(command);
      if (isPromiseLike(executionResult)) {
        executionResult.then(
          () => {
            resetCommandMenuState();
          },
          () => {
            resetCommandMenuState();
            // Keep behavior silent; execution errors are handled by caller.
          },
        );
      } else {
        resetCommandMenuState();
      }
    },
    [onExecuteCommand, resetCommandMenuState],
  );

  const selectCommandFromKeyboard = useCallback(
    (command: SlashCommand) => {
      if (isSkillCommand(command)) {
        insertCommandIntoInput(command);
        return;
      }

      executeNonSkillCommand(command);
    },
    [executeNonSkillCommand, insertCommandIntoInput],
  );

  const handleCommandSelect = useCallback(
    (command: SlashCommand | null, index: number, isHover: boolean) => {
      if (!command || !selectedProject) {
        return;
      }

      if (isHover) {
        setSelectedCommandIndex(index);
        return;
      }

      trackCommandUsage(command);
      if (isSkillCommand(command)) {
        insertCommandIntoInput(command);
        return;
      }

      executeNonSkillCommand(command);
    },
    [selectedProject, trackCommandUsage, insertCommandIntoInput, executeNonSkillCommand],
  );

  const handleToggleCommandMenu = useCallback(() => {
    const isOpening = !showCommandMenu;
    setShowCommandMenu(isOpening);
    setCommandQuery('');
    setSelectedCommandIndex(-1);

    if (isOpening) {
      setFilteredCommands(slashCommands);
    }

    // 触摸设备（移动端）不聚焦输入框，避免 iOS 自动弹出软键盘遮挡命令菜单；
    // 菜单在触摸设备上通过点选操作，键盘导航（方向键/回车）仅在桌面端有意义。
    const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    if (!isCoarsePointer) {
      textareaRef.current?.focus();
    }
  }, [showCommandMenu, slashCommands, textareaRef]);

  const handleCommandInputChange = useCallback(
    (newValue: string, cursorPos: number) => {
      if (!newValue.trim()) {
        resetCommandMenuState();
        return;
      }

      const textBeforeCursor = newValue.slice(0, cursorPos);
      const backticksBefore = (textBeforeCursor.match(/```/g) || []).length;
      const inCodeBlock = backticksBefore % 2 === 1;

      if (inCodeBlock) {
        resetCommandMenuState();
        return;
      }

      // Match a command trigger at start of input OR after whitespace, capturing
      // the trigger word up to cursor. Besides ASCII "/", accept the CJK
      // punctuation a Chinese IME emits for the same keystroke: "、" and "／".
      const slashPattern = /(?:^|\s)([/、／]\S*)$/;
      const match = textBeforeCursor.match(slashPattern);

      if (!match) {
        resetCommandMenuState();
        return;
      }

      // Compute actual position of / in the full input string.
      const slashPos = match.index! + (match[0].length - match[1].length);
      const query = match[1].slice(1); // strip leading /

      setSlashPosition(slashPos);
      setShowCommandMenu(true);
      setSelectedCommandIndex(-1);

      clearCommandQueryTimer();
      commandQueryTimerRef.current = window.setTimeout(() => {
        setCommandQuery(query);
      }, COMMAND_QUERY_DEBOUNCE_MS);
    },
    [resetCommandMenuState, clearCommandQueryTimer],
  );

  const handleCommandMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!showCommandMenu) {
        return false;
      }

      if (!filteredCommands.length) {
        if (event.key === 'Escape') {
          event.preventDefault();
          resetCommandMenuState();
          return true;
        }
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex < filteredCommands.length - 1 ? previousIndex + 1 : 0,
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex > 0 ? previousIndex - 1 : filteredCommands.length - 1,
        );
        return true;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        // Until the user arrows through the menu nothing is highlighted, so both
        // keys act on the first match — the entry the menu renders at the top.
        const targetCommand = filteredCommands[selectedCommandIndex >= 0 ? selectedCommandIndex : 0];
        if (!targetCommand) {
          return true;
        }

        // Tab is completion, not submission: it only writes "<name> " into the
        // input and closes the menu, so an argument can still be typed before
        // Enter runs the command. Enter keeps executing the highlighted entry.
        if (event.key === 'Tab') {
          insertCommandIntoInput(targetCommand);
        } else {
          selectCommandFromKeyboard(targetCommand);
        }
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        resetCommandMenuState();
        return true;
      }

      return false;
    },
    [
      showCommandMenu,
      filteredCommands,
      insertCommandIntoInput,
      resetCommandMenuState,
      selectCommandFromKeyboard,
      selectedCommandIndex,
    ],
  );

  useEffect(
    () => () => {
      clearCommandQueryTimer();
    },
    [clearCommandQueryTimer],
  );

  return {
    slashCommands,
    slashCommandsCount: slashCommands.length,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  };
}
