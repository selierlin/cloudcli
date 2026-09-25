import { Sparkles, X } from 'lucide-react';

type CreateTaskModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/** Rendered by TaskBoard to explain how tasks are created through chat and the TaskMaster CLI. */
export default function CreateTaskModal({ isOpen, onClose }: CreateTaskModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-n-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-n-gray-200 bg-n-white shadow-xl dark:border-n-gray-700 dark:bg-n-gray-800">
        <div className="flex items-center justify-between border-b border-n-gray-200 p-6 dark:border-n-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-n-gray-900 dark:text-n-white">Create AI-Generated Task</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-n-gray-400 hover:bg-n-gray-100 hover:text-n-gray-600 dark:hover:bg-n-gray-700 dark:hover:text-n-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
                <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h4 className="mb-2 font-semibold text-blue-900 dark:text-blue-100">Pro tip: ask Claude Code directly</h4>
                <p className="mb-3 text-sm text-blue-800 dark:text-blue-200">
                  Ask for a task in chat with context and requirements. TaskMaster can generate implementation-ready tasks.
                </p>
                <div className="rounded border border-blue-200 bg-n-white p-3 dark:border-blue-700 dark:bg-n-gray-800">
                  <p className="mb-1 text-xs font-medium text-n-gray-600 dark:text-n-gray-400">Example:</p>
                  <p className="font-mono text-sm text-n-gray-900 dark:text-n-white">
                    Please add a task for profile image uploads and include best-practice research.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-n-gray-200 pt-4 text-center dark:border-n-gray-700">
            <a
              href="https://github.com/eyaltoledano/claude-task-master/blob/main/docs/examples.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View TaskMaster documentation
            </a>
          </div>

          <button
            onClick={onClose}
            className="w-full rounded-lg border border-n-gray-300 bg-n-white px-4 py-2 text-sm font-medium text-n-gray-700 hover:bg-n-gray-50 dark:border-n-gray-600 dark:bg-n-gray-700 dark:text-n-gray-300 dark:hover:bg-n-gray-600"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
