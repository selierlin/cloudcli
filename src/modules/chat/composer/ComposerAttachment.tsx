import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileIcon, Loader2, XIcon } from 'lucide-react';

import { ImageLightbox } from '@/modules/chat/transcript/ChatMessageImages';
import type { ComposerAttachmentUpload } from '@/shared/types';

type ComposerAttachmentProps = {
  file: File;
  onRemove: () => void;
  /** Upload state once the file is picked: uploading, ready, or failed. */
  upload?: ComposerAttachmentUpload;
  /**
   * Changes whenever any upload moves. The parent reads upload state from a
   * ref, so it passes this counter to make the chip re-read the value it was
   * given without keeping that state in React.
   */
  uploadVersion?: number;
  error?: string;
};

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Rendered by chat's ChatComposer for each pending attachment, showing its
 * thumbnail or file chip, upload progress and remove control.
 */
const ComposerAttachment = ({ file, onRemove, upload, uploadVersion, error }: ComposerAttachmentProps) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const isImage = file.type.startsWith('image/');
  void uploadVersion;
  const isUploading = upload?.status === 'uploading';
  // A failed upload and a validation error both block sending this chip.
  const failure = upload?.status === 'failed' ? upload.error ?? t('input.attachments.failed') : error;

  // Created inside the effect, not during render: StrictMode mounts, runs the
  // cleanup and mounts again, so a URL created for the first mount is revoked
  // while the chip stays on screen — the thumbnail then stays blank because a
  // render-phase memo has no reason to run again.
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!isImage) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="group relative max-w-full">
      {isImage ? (
        <button
          type="button"
          onClick={() => preview && setExpanded(true)}
          aria-label={t('input.attachments.expand', { name: file.name })}
          className="block overflow-hidden rounded-xl border border-border/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
        >
          {preview
            ? <img src={preview} alt={file.name} className="h-20 w-20 cursor-zoom-in object-cover" />
            : <div className="h-20 w-20 animate-pulse bg-muted" />}
        </button>
      ) : (
        <div className="flex h-20 w-56 max-w-full items-center gap-3 rounded-xl border border-border/50 bg-background/80 px-3 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileIcon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground" title={file.name}>{file.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
          </div>
        </div>
      )}
      {isUploading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-background/60">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
        </div>
      )}
      {failure && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-red-500/50"
          title={failure}
        >
          <AlertCircle className="h-6 w-6 text-white" aria-hidden />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 rounded-full border border-border/40 bg-background/90 p-1 text-foreground shadow-sm backdrop-blur transition-opacity hover:bg-background focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label={t('input.attachments.remove', { name: file.name })}
      >
        <XIcon className="h-3 w-3" aria-hidden />
      </button>
      {expanded && preview && (
        <ImageLightbox src={preview} alt={file.name} onClose={() => setExpanded(false)} />
      )}
    </div>
  );
};

export default ComposerAttachment;
