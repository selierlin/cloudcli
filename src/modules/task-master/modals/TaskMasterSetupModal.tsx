import { useState } from 'react';
import { Plus, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { Shell } from '@/modules/shell';
import type { TaskMasterProject } from '@/shared/types';

type TaskMasterSetupModalProps = {
  isOpen: boolean;
  project: TaskMasterProject | null;
  onClose: () => void;
  onAfterClose?: (() => void) | null;
};

/** Rendered by TaskBoard and NextTaskBanner to run TaskMaster initialisation for a project in an embedded shell. */
export default function TaskMasterSetupModal({ isOpen, project, onClose, onAfterClose = null }: TaskMasterSetupModalProps) {
  const { t } = useTranslation('tasks');
  const [isTaskMasterComplete, setIsTaskMasterComplete] = useState(false);

  if (!isOpen || !project) {
    return null;
  }

  const closeModal = () => {
    onClose();
    setIsTaskMasterComplete(false);

    // Delay refresh slightly so the CLI has time to flush writes to disk.
    window.setTimeout(() => {
      onAfterClose?.();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-n-black/50 p-4 pt-16 backdrop-blur-sm">
      <div className="flex h-[600px] w-full max-w-4xl flex-col rounded-lg border border-n-gray-200 bg-card shadow-xl dark:border-n-gray-700 dark:bg-n-gray-900">
        <div className="flex items-center justify-between border-b border-n-gray-200 p-4 dark:border-n-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <Terminal className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-n-gray-900 dark:text-n-white">{t('setupModal.title')}</h2>
              <p className="text-sm text-n-gray-500 dark:text-n-gray-400">{t('setupModal.subtitle', { projectName: project.displayName })}</p>
            </div>
          </div>

          <button
            onClick={closeModal}
            className="rounded-md p-2 text-n-gray-400 hover:bg-n-gray-100 hover:text-n-gray-600 dark:hover:bg-n-gray-800 dark:hover:text-n-gray-300"
            title="Close"
          >
            <Plus className="h-5 w-5 rotate-45" />
          </button>
        </div>

        <div className="flex-1 p-4">
          <div className="h-full overflow-hidden rounded-lg bg-n-black">
            <Shell
              selectedProject={project}
              selectedSession={null}
              initialCommand="npx task-master init"
              isPlainShell
              isActive
              onProcessComplete={(exitCode) => {
                if (exitCode === 0) {
                  setIsTaskMasterComplete(true);
                }
              }}
            />
          </div>
        </div>

        <div className="border-t border-n-gray-200 bg-n-gray-50 p-4 dark:border-n-gray-700 dark:bg-n-gray-800/50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-n-gray-600 dark:text-n-gray-400">
              {isTaskMasterComplete ? (
                <span className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  {t('setupModal.completed')}
                </span>
              ) : (
                t('setupModal.willStart')
              )}
            </div>

            <button
              onClick={closeModal}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-colors',
                isTaskMasterComplete
                  ? 'bg-green-600 hover:bg-green-700 text-n-white'
                  : 'text-n-gray-700 dark:text-n-gray-300 bg-card dark:bg-n-gray-700 border border-n-gray-300 dark:border-n-gray-600 hover:bg-n-gray-50 dark:hover:bg-n-gray-600',
              )}
            >
              {isTaskMasterComplete ? t('setupModal.closeContinueButton') : t('setupModal.closeButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
