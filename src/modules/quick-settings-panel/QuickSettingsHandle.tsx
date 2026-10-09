import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { QuickSettingsHandleStyle } from '@/shared/types';

type QuickSettingsHandleProps = {
  isOpen: boolean;
  isDragging: boolean;
  style: QuickSettingsHandleStyle;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

/** Rendered by QuickSettingsPanelView as the draggable edge handle that opens and closes the drawer. */
export default function QuickSettingsHandle({
  isOpen,
  isDragging,
  style,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
}: QuickSettingsHandleProps) {
  const { t } = useTranslation('settings');

  const placementClass = isOpen ? 'right-80' : 'right-0';
  const borderClass = isDragging
    ? 'border-blue-500 dark:border-blue-400'
    : 'border-border';
  const transitionClass = isDragging
    ? ''
    : 'transition-all duration-150 ease-out';
  const cursorClass = isDragging ? 'cursor-grabbing' : 'cursor-pointer';
  const ariaLabel = isDragging
    ? t('quickSettings.dragHandle.dragging')
    : isOpen
      ? t('quickSettings.dragHandle.closePanel')
      : t('quickSettings.dragHandle.openPanel');
  const title = isDragging
    ? t('quickSettings.dragHandle.draggingStatus')
    : t('quickSettings.dragHandle.toggleAndMove');

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      className={`fixed ${placementClass} z-50 ${transitionClass} border bg-card dark:bg-secondary ${borderClass} rounded-l-md p-2 shadow-lg transition-colors hover:bg-muted dark:hover:bg-sunken ${cursorClass} touch-none`}
      style={{
        ...style,
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
      }}
      aria-label={ariaLabel}
      title={title}
    >
      {isDragging ? (
        <GripVertical className="h-5 w-5 text-blue-500 dark:text-blue-400" />
      ) : isOpen ? (
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      ) : (
        <ChevronLeft className="h-5 w-5 text-muted-foreground" />
      )}
    </button>
  );
}
