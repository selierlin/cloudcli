import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { readCommandUsage, recordCommandUsage } from '@/shared/commandUsage';
import { useAutoHideScrollbar } from '@/shared/hooks/useAutoHideScrollbar';
import type { SlashCommand } from '@/shared/types';
import { isSkillCommand } from '@/shared/utils';

type CommandGroupKey = 'frequent' | 'projectSkills' | 'userSkills' | 'otherSkills' | 'builtIn' | 'custom';

/** A group with its commands already filtered and ordered for display. */
type CommandGroup = {
  key: CommandGroupKey;
  labelKey: string;
  commands: SlashCommand[];
};

// Rendering order of the headings, matching the composer's `/` menu: what the
// user reaches for most, then skills by scope, then what ships with the app.
const GROUP_ORDER: { key: CommandGroupKey; labelKey: string }[] = [
  { key: 'frequent', labelKey: 'quickSettings.commands.groups.frequent' },
  { key: 'projectSkills', labelKey: 'quickSettings.commands.groups.projectSkills' },
  { key: 'userSkills', labelKey: 'quickSettings.commands.groups.userSkills' },
  { key: 'otherSkills', labelKey: 'quickSettings.commands.groups.otherSkills' },
  { key: 'builtIn', labelKey: 'quickSettings.commands.groups.builtIn' },
  { key: 'custom', labelKey: 'quickSettings.commands.groups.custom' },
];

/** How many of the most-used commands the "frequent" group holds, matching the composer menu. */
const FREQUENT_LIMIT = 5;

// Skill commands carry the scope they were scanned from in `namespace`:
// "project" (a project or repo skill), "user" (a global one) or "skill" (a
// plugin's). Built-in and custom `.md` commands are not skills at all.
const groupKeyFor = (command: SlashCommand): Exclude<CommandGroupKey, 'frequent'> => {
  if (!isSkillCommand(command)) {
    return command.type === 'custom' ? 'custom' : 'builtIn';
  }
  if (command.namespace === 'project') return 'projectSkills';
  if (command.namespace === 'user') return 'userSkills';
  return 'otherSkills';
};

const matchesQuery = (command: SlashCommand, normalizedQuery: string): boolean => (
  command.name.toLowerCase().includes(normalizedQuery)
  || (command.description?.toLowerCase().includes(normalizedQuery) ?? false)
);

type QuickSettingsCommandsTabProps = {
  hasProject: boolean;
  commands: SlashCommand[];
  isLoading: boolean;
  hasError: boolean;
  onInsertCommand: (command: SlashCommand) => void;
};

/** Rendered by QuickSettingsPanelView as the Commands tab: a searchable, grouped list of the project's slash commands. */
export default function QuickSettingsCommandsTab({
  hasProject,
  commands,
  isLoading,
  hasError,
  onInsertCommand,
}: QuickSettingsCommandsTabProps) {
  const { t } = useTranslation('settings');
  const autoHideScrollbarRef = useAutoHideScrollbar();
  // The search box text; local because it only narrows this list. It lives as
  // long as the tab does, so a filter survives closing and reopening the panel.
  const [query, setQuery] = useState('');
  // Read once per mount, the way the composer's `/` menu does: re-sorting on
  // every recorded pick would move the row the user just clicked into another
  // group, under the pointer that is still there.
  const [commandUsage] = useState(readCommandUsage);

  const normalizedQuery = query.trim().toLowerCase().replace(/^\//, '');

  // The commands this project actually offers, narrowed by the search box. The
  // usage map is global, so a name recorded elsewhere must not surface here on
  // its own — the source list stays this project's scanned commands.
  const visibleCommands = useMemo(
    () => (normalizedQuery
      ? commands.filter((command) => matchesQuery(command, normalizedQuery))
      : commands),
    [commands, normalizedQuery],
  );

  // Hidden while searching: a search is a plain filter, and the same command
  // would otherwise appear twice (once here, once in its own group).
  const frequentCommands = useMemo(() => {
    if (normalizedQuery) {
      return [];
    }

    return visibleCommands
      .map((command) => ({ command, usageCount: commandUsage[command.name] ?? 0 }))
      .filter((entry) => entry.usageCount > 0)
      .sort((entryA, entryB) => entryB.usageCount - entryA.usageCount)
      .slice(0, FREQUENT_LIMIT)
      .map((entry) => entry.command);
  }, [visibleCommands, commandUsage, normalizedQuery]);

  const groups = useMemo<CommandGroup[]>(() => {
    const frequentNames = new Set(frequentCommands.map((command) => command.name));

    return GROUP_ORDER
      .map(({ key, labelKey }) => ({
        key,
        labelKey,
        commands: key === 'frequent'
          ? frequentCommands
          : visibleCommands.filter(
            (command) => groupKeyFor(command) === key && !frequentNames.has(command.name),
          ),
      }))
      .filter((group) => group.commands.length > 0);
  }, [visibleCommands, frequentCommands]);

  const renderStatus = (message: string) => (
    <p className="px-1 py-6 text-center text-sm text-muted-foreground">{message}</p>
  );

  const renderBody = () => {
    if (!hasProject) return renderStatus(t('quickSettings.commands.noProject'));
    if (isLoading) return renderStatus(t('quickSettings.commands.loading'));
    if (hasError) return renderStatus(t('quickSettings.commands.loadError'));
    if (commands.length === 0) return renderStatus(t('quickSettings.commands.empty'));
    if (groups.length === 0) return renderStatus(t('quickSettings.commands.noMatches'));

    return groups.map((group) => (
      <div key={group.key} className="space-y-0.5">
        <h4 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t(group.labelKey)}
        </h4>
        {group.commands.map((command, index) => (
          <button
            // A project and a user command can share a name (the server does
            // not dedupe them), so the position disambiguates the key.
            key={`${group.key}-${index}-${command.name}`}
            type="button"
            onClick={() => {
              // Counts the pick the same way the composer's `/` menu does, so
              // the two surfaces agree on what belongs in "frequent".
              recordCommandUsage(command.name);
              onInsertCommand(command);
            }}
            title={t('quickSettings.commands.insertTitle', { command: command.name })}
            className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <span className="font-mono text-sm text-foreground">{command.name}</span>
            {command.description && (
              <span className="line-clamp-2 text-xs text-muted-foreground">{command.description}</span>
            )}
          </button>
        ))}
      </div>
    ));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="border-b border-border p-3">
        <label className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 focus-within:border-primary">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('quickSettings.commands.searchPlaceholder')}
            aria-label={t('quickSettings.commands.searchPlaceholder')}
            disabled={!hasProject}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </label>
      </div>
      <div ref={autoHideScrollbarRef} className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-3">
        {renderBody()}
      </div>
    </div>
  );
}
