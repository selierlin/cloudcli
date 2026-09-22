import { Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { ProviderModelOption } from '@/shared/types';
import { DEFAULT_EFFORT_VALUE } from '@/shared/constants';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { useModelGroupCollapse } from '@/modules/chat/hooks/useModelGroupCollapse';
import { groupModelOptions } from '@/modules/chat/utils/modelGrouping';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSeparator,
  ComposerMenuSurface,
} from '@/modules/chat/composer/ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

/**
 * Composer-side label for a model option. Pi exposes several channels whose ids
 * can carry the same model, so prefix the channel to keep them distinguishable.
 */
function formatModelLabel(option: ProviderModelOption): string {
  const label = option.label || option.value;
  return option.group ? `${option.group} · ${label}` : label;
}

type ComposerModelMenuProps = {
  effort: string;
  /** Effort values the active provider/model actually accepts; empty hides the section. */
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  /** Model catalog for the active provider; empty hides the section. */
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
};

/**
 * Rendered by chat's ChatComposer as the popover for choosing the active
 * provider's model and reasoning effort for the next turn.
 */
function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
  onSelectModel,
  modelsLoading,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const [isModelSectionOpen, setIsModelSectionOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close);

  // The model list starts collapsed every time the menu opens, the way Codex
  // shows reasoning first and keeps the longer model list one click away.
  useEffect(() => {
    if (!isOpen) {
      setIsModelSectionOpen(false);
    }
  }, [isOpen]);

  const defaultEffortLabel = t('composer.effortDefault', { defaultValue: 'Default' });
  const resolvedEffortOptions = useMemo<EffortOption[]>(
    () => (effortOptions.length > 0 ? [{ value: DEFAULT_EFFORT_VALUE }, ...effortOptions] : []),
    [effortOptions],
  );
  const effortLabel = effort === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : effort;

  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.value === model) ?? null,
    [model, modelOptions],
  );
  const modelLabel = selectedModelOption ? formatModelLabel(selectedModelOption) : model;

  // Options are split by channel so a multi-channel catalog stays scannable.
  // A catalog with no channel tags yields one ungrouped section and the menu
  // falls back to its original flat list.
  const modelGroups = useMemo(() => groupModelOptions(modelOptions), [modelOptions]);
  const hasChannelGroups = modelGroups.some((group) => group.key !== null);

  const { isExpanded, toggle, reset } = useModelGroupCollapse(modelGroups, model);

  const hasEffortSection = resolvedEffortOptions.length > 0;
  const hasModelSection = modelOptions.length > 0 || modelsLoading;
  if (!hasEffortSection && !hasModelSection) {
    return null;
  }

  const triggerLabel = hasModelSection ? modelLabel : effortLabel;
  const ariaLabel = t('composer.modelMenu', {
    defaultValue: 'Select model and reasoning effort',
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="flex h-8 max-w-20 shrink-0 items-center gap-1 rounded-lg border border-border/60 bg-muted/40 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:max-w-56"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="truncate">{triggerLabel}</span>
        {hasModelSection && hasEffortSection && effort !== DEFAULT_EFFORT_VALUE && (
          <span className="hidden shrink-0 capitalize text-muted-foreground sm:inline">· {effortLabel}</span>
        )}
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          {hasEffortSection && (
            <>
              <ComposerMenuHeading>
                {t('composer.reasoning', { defaultValue: 'Reasoning' })}
              </ComposerMenuHeading>
              {resolvedEffortOptions.map((option) => (
                <ComposerMenuItem
                  key={option.value}
                  label={option.value === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : option.value}
                  description={option.description}
                  isSelected={option.value === effort}
                  onSelect={() => {
                    onSelectEffort(option.value);
                    setIsOpen(false);
                  }}
                  className="capitalize"
                />
              ))}
            </>
          )}

          {hasModelSection && (
            <>
              {hasEffortSection && <ComposerMenuSeparator />}
              <ComposerMenuItem
                role="menuitem"
                label={modelLabel}
                isSelected={false}
                onSelect={() => {
                  if (!isModelSectionOpen) {
                    reset();
                  }
                  setIsModelSectionOpen((current) => !current);
                }}
                trailing={
                  isModelSectionOpen
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                }
                className="text-muted-foreground"
              />

              {isModelSectionOpen && (
                <>
                  {!hasChannelGroups && (
                    <ComposerMenuHeading>
                      {t('composer.model', { defaultValue: 'Model' })}
                    </ComposerMenuHeading>
                  )}
                  {modelOptions.length === 0 && modelsLoading && (
                    <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                      {t('composer.loadingModels', { defaultValue: 'Loading models…' })}
                    </p>
                  )}
                  {modelGroups.map((group) => {
                    const groupLabel =
                      group.key ?? t('composer.otherModels', { defaultValue: 'Other' });
                    const expanded = !hasChannelGroups || isExpanded(group.key);

                    const items = group.options.map((option) => (
                      <ComposerMenuItem
                        key={option.value}
                        label={option.label || option.value}
                        isSelected={option.value === model}
                        onSelect={() => {
                          onSelectModel(option.value);
                          setIsOpen(false);
                        }}
                      />
                    ));

                    if (!hasChannelGroups) {
                      return <Fragment key={group.key ?? '__ungrouped'}>{items}</Fragment>;
                    }

                    return (
                      <Fragment key={group.key ?? '__ungrouped'}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => toggle(group.key)}
                          aria-expanded={expanded}
                          className="flex w-full items-center gap-1.5 px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {expanded
                            ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                            : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                          <span className="min-w-0 flex-1 truncate text-left">{groupLabel}</span>
                          <span className="shrink-0 text-[10px] font-normal text-muted-foreground/70">
                            {group.options.length}
                          </span>
                        </button>
                        {expanded && items}
                      </Fragment>
                    );
                  })}
                </>
              )}
            </>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerModelMenu);
