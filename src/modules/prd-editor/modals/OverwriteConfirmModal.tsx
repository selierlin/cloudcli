import { AlertTriangle, Save } from 'lucide-react';

type OverwriteConfirmModalProps = {
  isOpen: boolean;
  fileName: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Opened by PRDEditor inside the prd-editor module to confirm overwriting a PRD file that already exists. */
export default function OverwriteConfirmModal({
  isOpen,
  fileName,
  saving,
  onCancel,
  onConfirm,
}: OverwriteConfirmModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-n-black/50" onClick={onCancel} />

      <div className="relative w-full max-w-md rounded-lg border border-n-gray-200 bg-n-white shadow-xl dark:border-n-gray-700 dark:bg-n-gray-800">
        <div className="p-6">
          <div className="mb-4 flex items-center">
            <div className="mr-3 rounded-full bg-yellow-100 p-2 dark:bg-yellow-900">
              <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <h3 className="text-lg font-semibold text-n-gray-900 dark:text-n-white">File Already Exists</h3>
          </div>

          <p className="mb-6 text-sm text-n-gray-600 dark:text-n-gray-400">
            A PRD named "{fileName}" already exists. Do you want to overwrite it?
          </p>

          <div className="flex justify-end gap-3">
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border border-n-gray-300 bg-n-white px-4 py-2 text-sm text-n-gray-700 transition-colors hover:bg-n-gray-50 dark:border-n-gray-600 dark:bg-n-gray-700 dark:text-n-gray-300 dark:hover:bg-n-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-yellow-600 px-4 py-2 text-sm text-n-white transition-colors hover:bg-yellow-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? 'Saving...' : 'Overwrite'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
