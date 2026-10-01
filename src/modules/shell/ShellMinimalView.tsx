import type { RefObject } from 'react';

type ShellMinimalViewProps = {
  terminalContainerRef: RefObject<HTMLDivElement>;
  onContainerMouseDown?: () => void;
};

/** Rendered by Shell in minimal mode to show the bare terminal container without the header or overlays. */
export default function ShellMinimalView({
  terminalContainerRef,
  onContainerMouseDown,
}: ShellMinimalViewProps) {
  return (
    // The board again, the same surface Shell's full view paints: minimal mode
    // drops the header and overlays but the canvas still fills this box exactly,
    // so the colour only ever shows if the terminal letterboxes.
    <div className="relative h-full w-full bg-[hsl(var(--term-background))]">
      <div
        ref={terminalContainerRef}
        tabIndex={0}
        onMouseDown={onContainerMouseDown}
        className="h-full w-full focus:outline-none"
        style={{ outline: 'none' }}
      />
    </div>
  );
}
