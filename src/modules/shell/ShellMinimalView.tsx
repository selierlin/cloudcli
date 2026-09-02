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
    <div className="relative h-full w-full bg-gray-900">
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
