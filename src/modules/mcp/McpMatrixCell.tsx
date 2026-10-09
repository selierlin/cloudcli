import { AlertTriangle, Ban, Check, Minus } from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '@/shared/utils';
import { Tooltip } from '@/shared/ui';
import type { McpMatrixCellState } from '@/modules/mcp/utils/mcpMatrixRules';

type McpMatrixCellProps = {
  state: McpMatrixCellState;
  /** Human-readable description of this cell, used as its accessible name and hover text. */
  label: string;
  /** Flips the harness switch for this entry; omitted on read-only screens, which then render the cell inert. */
  onToggle?: () => void;
  /** True while this cell's write is still in flight, so the cell stays inert and reports `aria-busy` instead of accepting a second click. */
  isBusy?: boolean;
};

type CellAppearance = {
  icon: ComponentType<{ className?: string }>;
  className: string;
};

const CELL_APPEARANCE: Record<McpMatrixCellState, CellAppearance> = {
  on: {
    icon: Check,
    className: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  off: {
    icon: Minus,
    className: 'border-border bg-muted/40 text-muted-foreground/50',
  },
  fail: {
    icon: AlertTriangle,
    className: 'border-red-500/40 bg-red-500/15 text-red-600 dark:text-red-400',
  },
  disabled: {
    icon: Ban,
    className: 'border-border/50 bg-muted/20 text-muted-foreground/30',
  },
};

/** Used by the MCP module's matrix to render one entry × harness state as a clickable or inert cell. */
export default function McpMatrixCell({ state, label, onToggle, isBusy = false }: McpMatrixCellProps) {
  const appearance = CELL_APPEARANCE[state];
  const Icon = appearance.icon;
  // A `disabled` cell is refused by the harness's capabilities and can never be
  // flipped; every other state only renders inert while no handler is supplied
  // (the read-only matrix) or while its own write is still in flight.
  const isInert = state === 'disabled' || !onToggle || isBusy;

  return (
    <Tooltip content={label}>
      <button
        type="button"
        data-state={state}
        aria-label={label}
        aria-busy={isBusy || undefined}
        disabled={isInert}
        onClick={onToggle}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
          appearance.className,
          isInert ? 'cursor-not-allowed' : 'hover:brightness-110',
          isBusy && 'opacity-60',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}
