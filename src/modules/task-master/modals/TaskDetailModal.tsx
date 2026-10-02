import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Edit,
  Pause,
  Save,
  X,
} from 'lucide-react';

import { cn,copyTextToClipboard } from '@/shared/utils';
import { api } from '@/shared/api';
import { useTaskMaster } from '@/modules/task-master/context/TaskMasterContext';
import type { TaskId, TaskMasterTask, TaskReference } from '@/shared/types';

type TaskDetailModalProps = {
  task: TaskMasterTask | null;
  isOpen?: boolean;
  className?: string;
  onClose: () => void;
  onEdit?: ((task: TaskMasterTask) => void) | null;
  onStatusChange?: ((taskId: TaskId, status: string) => void) | null;
  onTaskClick?: ((task: TaskReference) => void) | null;
};

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'cancelled', label: 'Cancelled' },
];

function getStatusIcon(status?: string) {
  if (status === 'done') return CheckCircle;
  if (status === 'in-progress') return Clock;
  if (status === 'review') return AlertCircle;
  if (status === 'deferred') return Pause;
  if (status === 'cancelled') return X;
  return Circle;
}

function getPriorityBadgeClass(priority?: string): string {
  if (priority === 'high') return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950';
  if (priority === 'medium') return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950';
  if (priority === 'low') return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950';
  return 'text-n-gray-600 dark:text-n-gray-400 bg-n-gray-50 dark:bg-n-gray-800';
}

/** Rendered by TaskMasterPanel and NextTaskBanner to show and edit one task's full details and subtasks. */
export default function TaskDetailModal({
  task,
  isOpen = true,
  className = '',
  onClose,
  onEdit = null,
  onStatusChange = null,
  onTaskClick = null,
}: TaskDetailModalProps) {
  const { currentProject, refreshTasks } = useTaskMaster();

  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showTestStrategy, setShowTestStrategy] = useState(false);
  const [editableTask, setEditableTask] = useState<TaskMasterTask | null>(task);

  useEffect(() => {
    setEditableTask(task);
    setIsEditMode(false);
  }, [task]);

  const StatusIcon = useMemo(() => getStatusIcon(task?.status), [task?.status]);

  if (!isOpen || !task || !editableTask) {
    return null;
  }

  const handleSaveChanges = async () => {
    if (!currentProject?.projectId) {
      return;
    }

    const updates: Record<string, string> = {};

    if (editableTask.title !== task.title) {
      updates.title = editableTask.title;
    }

    if (editableTask.description !== task.description) {
      updates.description = editableTask.description ?? '';
    }

    if (editableTask.details !== task.details) {
      updates.details = editableTask.details ?? '';
    }

    if (Object.keys(updates).length === 0) {
      setIsEditMode(false);
      return;
    }

    setIsSaving(true);
    try {
      const response = await api.taskmaster.updateTask(currentProject.projectId, task.id, updates);
      if (!response.ok) {
        const errorPayload = (await response.json()) as { message?: string };
        throw new Error(errorPayload.message ?? 'Failed to update task');
      }

      setIsEditMode(false);
      await refreshTasks();
      onEdit?.(editableTask);
    } catch (error) {
      console.error('Failed to save task changes:', error);
      alert(error instanceof Error ? error.message : 'Failed to update task');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusSelect = async (nextStatus: string) => {
    if (!currentProject?.projectId || nextStatus === task.status) {
      return;
    }

    try {
      const response = await api.taskmaster.updateTask(currentProject.projectId, task.id, { status: nextStatus });
      if (!response.ok) {
        const errorPayload = (await response.json()) as { message?: string };
        throw new Error(errorPayload.message ?? 'Failed to update task status');
      }

      await refreshTasks();
      onStatusChange?.(task.id, nextStatus);
    } catch (error) {
      console.error('Failed to update task status:', error);
      alert(error instanceof Error ? error.message : 'Failed to update task status');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-n-black/50 md:p-4">
      <div
        className={cn(
          'w-full md:max-w-4xl h-full md:h-[90vh] bg-card dark:bg-n-gray-900 border border-n-gray-200 dark:border-n-gray-700 md:rounded-lg shadow-xl flex flex-col',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-n-gray-200 p-4 dark:border-n-gray-700 md:p-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <StatusIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <div className="min-w-0 flex-1">
              <button
                onClick={() => copyTextToClipboard(String(task.id))}
                className="mb-2 inline-flex items-center gap-1 rounded bg-n-gray-100 px-2 py-1 text-xs text-n-gray-600 hover:bg-n-gray-200 dark:bg-n-gray-800 dark:text-n-gray-300 dark:hover:bg-n-gray-700"
                title="Copy task ID"
              >
                <span>Task {task.id}</span>
                <Copy className="h-3 w-3" />
              </button>

              {isEditMode ? (
                <input
                  type="text"
                  value={editableTask.title}
                  onChange={(event) => setEditableTask({ ...editableTask, title: event.target.value })}
                  className="w-full border-b-2 border-blue-500 bg-transparent text-lg font-semibold text-n-gray-900 focus:outline-none dark:text-n-white"
                />
              ) : (
                <h1 className="line-clamp-2 text-lg font-semibold text-n-gray-900 dark:text-n-white md:text-xl">{task.title}</h1>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isEditMode ? (
              <>
                <button
                  onClick={handleSaveChanges}
                  disabled={isSaving}
                  className="rounded-md p-2 text-green-600 hover:bg-green-50 disabled:opacity-50 dark:hover:bg-green-950"
                  title="Save"
                >
                  <Save className={cn('w-5 h-5', isSaving && 'animate-spin')} />
                </button>
                <button
                  onClick={() => {
                    setEditableTask(task);
                    setIsEditMode(false);
                  }}
                  disabled={isSaving}
                  className="rounded-md p-2 text-n-gray-500 hover:bg-n-gray-100 dark:hover:bg-n-gray-800"
                  title="Cancel editing"
                >
                  <X className="h-5 w-5" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditMode(true)}
                className="rounded-md p-2 text-n-gray-500 hover:bg-n-gray-100 dark:hover:bg-n-gray-800"
                title="Edit task"
              >
                <Edit className="h-5 w-5" />
              </button>
            )}
            <button onClick={onClose} className="rounded-md p-2 text-n-gray-500 hover:bg-n-gray-100 dark:hover:bg-n-gray-800" title="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-n-gray-700 dark:text-n-gray-300">Status</label>
              <select
                value={task.status ?? 'pending'}
                onChange={(event) => {
                  void handleStatusSelect(event.target.value);
                }}
                className="w-full rounded-md border border-n-gray-300 bg-card px-3 py-2 text-n-gray-900 dark:border-n-gray-600 dark:bg-n-gray-800 dark:text-n-white"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-n-gray-700 dark:text-n-gray-300">Priority</label>
              <div className={cn('px-3 py-2 rounded-md text-sm font-medium capitalize', getPriorityBadgeClass(task.priority))}>
                {task.priority ?? 'Not set'}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-n-gray-700 dark:text-n-gray-300">Dependencies</label>
              {Array.isArray(task.dependencies) && task.dependencies.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {task.dependencies.map((dependency) => (
                    <button
                      key={String(dependency)}
                      onClick={() => onTaskClick?.({ id: dependency })}
                      className="rounded bg-blue-100 px-2 py-1 text-sm text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800"
                    >
                      <ArrowRight className="mr-1 inline h-3 w-3" />
                      {dependency}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-n-gray-500 dark:text-n-gray-400">No dependencies</span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-n-gray-700 dark:text-n-gray-300">Description</label>
            {isEditMode ? (
              <textarea
                rows={4}
                value={editableTask.description ?? ''}
                onChange={(event) => setEditableTask({ ...editableTask, description: event.target.value })}
                className="w-full rounded-md border border-n-gray-300 bg-card px-3 py-2 dark:border-n-gray-600 dark:bg-n-gray-800"
              />
            ) : (
              <p className="whitespace-pre-wrap text-n-gray-700 dark:text-n-gray-300">{task.description || 'No description provided'}</p>
            )}
          </div>

          {task.details && (
            <div className="rounded-lg border border-n-gray-200 dark:border-n-gray-700">
              <button
                onClick={() => setShowDetails((current) => !current)}
                className="flex w-full items-center justify-between p-4 text-left hover:bg-n-gray-50 dark:hover:bg-n-gray-800"
              >
                <span className="text-sm font-medium text-n-gray-700 dark:text-n-gray-300">Implementation Details</span>
                {showDetails ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {showDetails && (
                <div className="border-t border-n-gray-200 p-4 dark:border-n-gray-700">
                  <p className="whitespace-pre-wrap text-n-gray-700 dark:text-n-gray-300">{task.details}</p>
                </div>
              )}
            </div>
          )}

          {task.testStrategy && (
            <div className="rounded-lg border border-n-gray-200 dark:border-n-gray-700">
              <button
                onClick={() => setShowTestStrategy((current) => !current)}
                className="flex w-full items-center justify-between p-4 text-left hover:bg-n-gray-50 dark:hover:bg-n-gray-800"
              >
                <span className="text-sm font-medium text-n-gray-700 dark:text-n-gray-300">Test Strategy</span>
                {showTestStrategy ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {showTestStrategy && (
                <div className="border-t border-n-gray-200 bg-blue-50 p-4 dark:border-n-gray-700 dark:bg-blue-950/30">
                  <p className="whitespace-pre-wrap text-n-gray-700 dark:text-n-gray-300">{task.testStrategy}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
