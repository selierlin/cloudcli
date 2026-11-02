import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '@/shared/utils';

type SelectProps = ComponentPropsWithoutRef<'select'>;

/**
 * The styled single-choice control, used by the quick-settings panel and the
 * settings module's appearance tab.
 *
 * It drops the native arrow on purpose: the browser paints that arrow inside the
 * control's own padding, so a long option ("Source Code Pro", "卡布奇诺 · Catppuccin")
 * runs underneath it. `appearance-none` plus our own `ChevronDown`, `pr-9` and
 * `truncate` reserve the arrow's space and ellipsize the text instead — the
 * control can then be sized to whatever width its row can spare.
 *
 * `className` sizes the wrapper (and therefore the select), so a row can ask for
 * `w-full`, a fixed `sm:w-40`, or anything else without touching the styling.
 */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <span className={cn('relative block', className)}>
      <select
        className="w-full touch-manipulation appearance-none truncate rounded-lg border border-input bg-card py-2.5 pl-2.5 pr-9 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}
