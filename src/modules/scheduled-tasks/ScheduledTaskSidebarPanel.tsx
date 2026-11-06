import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, MoreHorizontal, Pencil, Play, Plus, Power, RefreshCw, Trash2 } from 'lucide-react';

import { ActionMenu, Button } from '@/shared/ui';
import type { ScheduledTask, ScheduledTaskInput } from '@/shared/types';
import { cn } from '@/shared/utils';
import { useScheduledTasks } from '@/modules/scheduled-tasks/hooks/useScheduledTasks';
import { useTaskRuns } from '@/modules/scheduled-tasks/hooks/useTaskRuns';
import {
  RUN_STATUS_CLASSES,
  describeSchedule,
  formatShortDateTime,
} from '@/modules/scheduled-tasks/utils/taskPresentation';
import ScheduledTaskDialog from '@/modules/scheduled-tasks/ScheduledTaskDialog';

/**
 * Rendered by SidebarContent as the "scheduledTasks" section.
 *
 * It is a narrower reading of the same data as the settings panel: the row is
 * one line of state, one line of schedule, and an overflow menu, because the
 * sidebar can be dragged down to 220px where the settings card's button row
 * would wrap into three lines.
 */
export default function ScheduledTaskSidebarPanel() {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const { tasks, isLoading, error, refresh, createTask, updateTask, removeTask, setEnabled, runNow } = useScheduledTasks();
  // The task whose run history is expanded, or null when all are collapsed.
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // The task being edited, `'new'` for the create form, or null when closed.
  const [editing, setEditing] = useState<ScheduledTask | 'new' | null>(null);
  // Per-task failures, so one failing row does not hide the rest.
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const reportError = (taskId: string, actionError: unknown) => {
    setActionErrors((current) => ({
      ...current,
      [taskId]: actionError instanceof Error ? actionError.message : String(actionError),
    }));
  };

  const handleSave = async (input: ScheduledTaskInput) => {
    if (editing && editing !== 'new') {
      await updateTask(editing.id, input);
      return;
    }
    await createTask(input);
  };

  return (
    <div className="space-y-1 px-2 py-1">
      <div className="flex items-center gap-1 pb-1">
        <Button size="sm" className="h-7 flex-1 justify-center px-2 text-xs" onClick={() => setEditing('new')}>
          <Plus className="h-3.5 w-3.5" />
          {t('scheduledTasks.create')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 flex-none p-0 text-muted-foreground hover:text-foreground"
          onClick={() => void refresh()}
          aria-label={t('scheduledTasks.refresh')}
          title={t('scheduledTasks.refresh')}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {error && <p role="alert" className="px-1 pb-1 text-xs text-destructive">{error}</p>}

      {isLoading && (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">{t('scheduledTasks.loading')}</p>
      )}

      {!isLoading && tasks.length === 0 && (
        <div className="px-2 py-8 text-center">
          <CalendarClock className="mx-auto h-5 w-5 text-muted-foreground/60" />
          <p className="mt-2 text-xs font-medium text-foreground">{t('scheduledTasks.emptyTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('scheduledTasks.emptyDescription')}</p>
        </div>
      )}

      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          isExpanded={expandedTaskId === task.id}
          actionError={actionErrors[task.id] ?? null}
          onToggleExpanded={() => setExpandedTaskId((current) => (current === task.id ? null : task.id))}
          onEdit={() => setEditing(task)}
          onRun={() => {
            void runNow(task.id).then(() => setExpandedTaskId(task.id)).catch((runError: unknown) => {
              reportError(task.id, runError);
            });
          }}
          onToggleEnabled={() => {
            void setEnabled(task.id, !task.enabled).catch((toggleError: unknown) => {
              reportError(task.id, toggleError);
            });
          }}
          onRemove={() => {
            if (!window.confirm(t('scheduledTasks.confirmDelete', { name: task.name }))) {
              return;
            }
            void removeTask(task.id).catch((removeError: unknown) => {
              reportError(task.id, removeError);
            });
          }}
          onOpenSession={(sessionId) => navigate(`/session/${encodeURIComponent(sessionId)}`)}
        />
      ))}

      <ScheduledTaskDialog
        isOpen={editing !== null}
        task={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSubmit={handleSave}
      />
    </div>
  );
}

type TaskRowProps = {
  task: ScheduledTask;
  isExpanded: boolean;
  actionError: string | null;
  onToggleExpanded: () => void;
  onEdit: () => void;
  onRun: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
  onOpenSession: (sessionId: string) => void;
};

/** One task in the sidebar: state dot, name, rule and next run, plus its overflow menu. */
function TaskRow({
  task,
  isExpanded,
  actionError,
  onToggleExpanded,
  onEdit,
  onRun,
  onToggleEnabled,
  onRemove,
  onOpenSession,
}: TaskRowProps) {
  const { t } = useTranslation('settings');
  const { runs } = useTaskRuns(task.id);
  // A live run outranks the on/off state: it is what the user is waiting on.
  const isRunning = runs.some((run) => run.status === 'running');

  return (
    <div className="rounded-lg transition-colors hover:bg-accent/50">
      <div className="flex items-start gap-0.5">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          className="min-w-0 flex-1 rounded-lg px-1.5 py-1.5 text-left"
        >
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'h-1.5 w-1.5 flex-none rounded-full',
                isRunning
                  ? 'animate-pulse bg-primary'
                  : task.enabled
                    ? 'bg-emerald-500'
                    : 'bg-muted-foreground/40',
              )}
            />
            <span
              className="truncate text-[13px] text-foreground"
              title={`${task.name}\n${task.projectPath}`}
            >
              {task.name}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {describeSchedule(task.schedule, t)}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground/75">
            {task.enabled
              ? t('scheduledTasks.nextRunShort', { time: formatShortDateTime(task.nextRunAt) })
              : t('scheduledTasks.statusDisabled')}
          </span>
        </button>

        <ActionMenu
          label={task.name}
          ariaLabel={task.name}
          icon={MoreHorizontal}
          iconOnly
          portal
          variant="ghost"
          size="sm"
          className="flex-none"
          triggerClassName="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
          items={[
            { key: 'run', label: t('scheduledTasks.runNow'), icon: Play, onSelect: onRun },
            { key: 'edit', label: t('scheduledTasks.edit'), icon: Pencil, onSelect: onEdit },
            {
              key: 'toggle',
              label: task.enabled ? t('scheduledTasks.disable') : t('scheduledTasks.enable'),
              icon: Power,
              onSelect: onToggleEnabled,
            },
            {
              key: 'remove',
              label: t('scheduledTasks.delete'),
              icon: Trash2,
              isDanger: true,
              showDividerBefore: true,
              onSelect: onRemove,
            },
          ]}
        />
      </div>

      {actionError && <p role="alert" className="px-1.5 pb-1 text-[11px] text-destructive">{actionError}</p>}

      {isExpanded && (
        <div className="mb-1 ml-3 border-l border-border pl-2">
          {runs.length === 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground">{t('scheduledTasks.noRuns')}</p>
          ) : (
            runs.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center gap-1.5 py-0.5 text-[11px]">
                <span className={cn('rounded-full px-1.5 py-0.5 font-medium', RUN_STATUS_CLASSES[run.status])}>
                  {t(`scheduledTasks.runStatus.${run.status}`)}
                </span>
                <span className="text-muted-foreground">{formatShortDateTime(run.startedAt)}</span>
                {run.error && (
                  <span className="min-w-0 flex-1 truncate text-destructive" title={run.error}>{run.error}</span>
                )}
                {run.skippedReason && (
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {t(`scheduledTasks.skipReason.${run.skippedReason}`)}
                  </span>
                )}
                {run.sessionId && (
                  <button
                    type="button"
                    onClick={() => onOpenSession(run.sessionId!)}
                    className="shrink-0 text-primary hover:underline"
                  >
                    {t('scheduledTasks.openConversation')}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
