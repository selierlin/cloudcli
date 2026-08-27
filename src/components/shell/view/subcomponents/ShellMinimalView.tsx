import type { RefObject } from 'react';

type ShellMinimalViewProps = {
  terminalContainerRef: RefObject<HTMLDivElement>;
  onContainerMouseDown?: () => void;
};

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
