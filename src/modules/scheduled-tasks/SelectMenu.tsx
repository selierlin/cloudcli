import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Search } from 'lucide-react';

import { cn, isImeKeyEvent } from '@/shared/utils';

/** One row of the menu; `description` renders a second line the way the composer's model menu does. */
export type SelectMenuOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
};

type SelectMenuProps = {
  id?: string;
  /** Also names the listbox, so the trigger and the panel announce the same thing. */
  ariaLabel: string;
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  /** Shown when no option carries `value`, e.g. a catalog that failed to load. */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

/** Tallest the panel may get before it scrolls, so a long model catalog never covers the form. */
const MENU_MAX_HEIGHT = 280;
/** Distance kept between the trigger and the panel. */
const MENU_GAP = 6;
/** The panel may be wider than a narrow trigger, but not so narrow that rows wrap. */
const MENU_MIN_WIDTH = 200;
const VIEWPORT_MARGIN = 8;
/** Space the panel needs below the trigger before it flips above it. */
const MIN_SPACE_BELOW = 180;
/** Option count from which the panel gains a filter input, matching the composer's model menu. */
const SEARCH_MIN_OPTIONS = 15;

/** Where the portalled panel sits, in viewport coordinates. */
type MenuPlacement = {
  left: number;
  width: number;
  maxHeight: number;
  /** Set instead of `bottom` when the panel opens downward. */
  top?: number;
  /** Set instead of `top` when there is more room above the trigger. */
  bottom?: number;
};

/**
 * Used by the scheduled-tasks module's task dialog for provider, model, effort
 * and interval unit: a native `<select>` paints its list with the OS, which
 * looked nothing like the model menu the composer opens for a new turn.
 */
export function SelectMenu({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className,
}: SelectMenuProps) {
  const { t } = useTranslation('settings');
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  // Filters a catalog too long to scan; cleared every time the panel closes.
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // The panel only exists after its placement is measured, so the focus move
  // waits for that render instead of happening when the trigger is clicked.
  const focusPendingRef = useRef(false);

  const selected = options.find((option) => option.value === value) ?? null;

  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN;
    // Downward is the default; a trigger near the bottom edge opens upward
    // instead, and the panel never leaves the viewport either way.
    const openUpward = spaceBelow < MIN_SPACE_BELOW && spaceAbove > spaceBelow;
    const width = Math.max(rect.width, MENU_MIN_WIDTH);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
    );

    setPlacement({
      left,
      width,
      maxHeight: Math.min(MENU_MAX_HEIGHT, Math.max(140, openUpward ? spaceAbove : spaceBelow)),
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + MENU_GAP }
        : { top: rect.bottom + MENU_GAP }),
    });
  }, []);

  // Closing always drops the filter, so reopening shows the whole catalog.
  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu();
      }
    };

    // Capture phase on `window` runs before the dialog's own document-level
    // Escape handler, so one Escape closes only the menu, not the dialog.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isImeKeyEvent(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsidePress);
    window.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('resize', measure);
    // Capture catches the form's own scroll container as well as the page.
    window.addEventListener('scroll', measure, true);
    measure();

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      window.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [closeMenu, isOpen, measure]);

  useEffect(() => {
    if (isOpen && placement && focusPendingRef.current) {
      focusPendingRef.current = false;
      menuRef.current?.focus();
    }
  }, [isOpen, placement]);

  const openMenu = () => {
    focusPendingRef.current = true;
    measure();
    setIsOpen(true);
  };

  const select = (next: string) => {
    onChange(next);
    closeMenu();
    triggerRef.current?.focus();
  };

  /** Moves focus through the rows so arrows and Enter work without a pointer. */
  const moveFocus = (delta: number | 'first' | 'last') => {
    const rows = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    if (rows.length === 0) {
      return;
    }
    if (delta === 'first') {
      rows[0].focus();
      return;
    }
    if (delta === 'last') {
      rows[rows.length - 1].focus();
      return;
    }
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next = current === -1
      ? (delta > 0 ? 0 : rows.length - 1)
      : (current + delta + rows.length) % rows.length;
    rows[next].focus();
  };

  const searchEnabled = options.length >= SEARCH_MIN_OPTIONS;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = useMemo(() => {
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) => (
      `${option.label} ${option.value} ${option.description ?? ''}`.toLowerCase().includes(normalizedQuery)
    ));
  }, [normalizedQuery, options]);

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !isOpen) {
            event.preventDefault();
            openMenu();
          }
        }}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-2.5 text-left text-sm text-foreground transition-colors',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-primary/40',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {selected?.icon}
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.label : value || placeholder}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && placement && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveFocus(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Home' || event.key === 'End') {
              // Inside the filter input these keys move the caret, not the list.
              if ((event.target as HTMLElement).tagName === 'INPUT') {
                return;
              }
              event.preventDefault();
              moveFocus(event.key === 'Home' ? 'first' : 'last');
            } else if (event.key === 'Tab') {
              // The panel is portalled out of the dialog's focus trap, so Tab
              // would otherwise land behind it.
              event.preventDefault();
            }
          }}
          style={{
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
            top: placement.top,
            bottom: placement.bottom,
          }}
          className="fixed z-[100] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover/95 p-1 text-popover-foreground shadow-xl backdrop-blur-md focus:outline-none"
        >
          {searchEnabled && (
            <div className="sticky top-0 z-10 bg-popover/95 pb-1">
              <label className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('scheduledTasks.searchPlaceholder')}
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
            </div>
          )}

          {visibleOptions.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => select(option.value)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                  'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                  isSelected ? 'text-foreground' : 'text-foreground/90',
                )}
              >
                {option.icon && <span className="mt-0.5 flex shrink-0 items-center justify-center">{option.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate leading-5">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{option.description}</span>
                  )}
                </span>
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {isSelected && <Check className="h-3.5 w-3.5 text-foreground" />}
                </span>
              </button>
            );
          })}

          {visibleOptions.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">{t('scheduledTasks.noMatches')}</p>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
