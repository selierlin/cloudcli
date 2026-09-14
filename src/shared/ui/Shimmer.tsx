import * as React from 'react';

import { cn } from '@/shared/utils';

type ShimmerProps = {
  children: string;
  className?: string;
  as?: React.ElementType;
};

/**
 * Used by the chat module for streaming placeholder text, plan titles, and the
 * composer's in-flight activity label.
 *
 * The sweep is a rainbow painted through the glyphs via `bg-clip-text`, which
 * imposes three constraints. No `transparent` stop may appear in it, because the
 * glyphs themselves are transparent and a transparent stop would erase the
 * letters it covers. The last stop repeats the first, because the sweep tiles
 * horizontally and a mismatched end colour would leave a visible seam. And its
 * size must exceed 100% of the element width, because `animate-shimmer` moves
 * the background by percentage and a percentage position resolves against
 * (element width - image width), so an image no wider than the element would not
 * move at all; 130% keeps several hues visible at once and still drifts through
 * roughly one full spectrum every two seconds.
 */
export const Shimmer = React.memo<ShimmerProps>(({ children, className, as: Component = 'span' }) => {
  return (
    <Component
      className={cn(
        'animate-shimmer inline-block bg-clip-text text-transparent',
        'bg-[length:130%_100%] bg-[linear-gradient(90deg,#ef4444,#f59e0b,#ca8a04,#22c55e,#06b6d4,#3b82f6,#a855f7,#ef4444)]',
        className
      )}
    >
      {children}
    </Component>
  );
});
Shimmer.displayName = 'Shimmer';
