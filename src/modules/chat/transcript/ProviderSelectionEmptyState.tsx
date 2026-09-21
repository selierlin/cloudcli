import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import type {
  ProjectSession,
  LLMProvider,
  ProviderModelActions,
  ProviderModelOption,
  ProviderModelsDefinition,
} from "@/shared/types";
import { NextTaskBanner } from "@/modules/task-master";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  Card,
  Badge,
  Button,
  LLMProviderLogo,
} from "@/shared/ui";
import ModelLibraryPanel from "@/modules/chat/modals/ModelLibraryPanel";
import { groupModelOptions } from "@/modules/chat/utils/modelGrouping";
import { writeSelectedProvider } from '@/shared/selectedProvider';
import { useAvailableProviders } from '@/modules/chat/hooks/useAvailableProviders';

const PROVIDER_META: { id: LLMProvider; name: string }[] = [
  { id: "claude", name: "Anthropic" },
  { id: "codex", name: "OpenAI" },
  { id: "cursor", name: "Cursor" },
  { id: "opencode", name: "OpenCode" },
  { id: "dsh", name: "DeepSeek Harness" },
  { id: "workbuddy", name: "WorkBuddy" },
  { id: "pi", name: "Pi" },
  { id: "zcode", name: "ZCode" },
  { id: "omp", name: "OMP" },
];

const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

// cmdk's default filter is fuzzy (loose character-subsequence scoring), which
// surfaces unrelated models — e.g. searching "chatgpt" also matched "Fable".
// Require every whitespace-separated search token to appear as a literal
// substring instead, so "claude 4.5" still matches "Anthropic Claude Haiku 4.5"
// but "chatgpt" only matches models that actually contain it.
function modelSearchFilter(value: string, search: string): number {
  const haystack = value.toLowerCase();
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token)) ? 1 : 0;
}

type ProviderSelectionEmptyStateProps = {
  selectedSession: ProjectSession | null;
  provider: LLMProvider;
  setProvider: (next: LLMProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  providerModels: Record<LLMProvider, string>;
  /** Records the pick as this provider's default and persists it. */
  setProviderModel: (provider: LLMProvider, model: string) => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelActions: ProviderModelActions;
  providerModelsLoading: boolean;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
};

type ProviderGroup = {
  id: LLMProvider;
  name: string;
  models: ProviderModelOption[];
};

function getModelConfig(
  p: LLMProvider,
  catalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>,
): ProviderModelsDefinition {
  const entry = catalog[p];
  return entry ?? { OPTIONS: [], DEFAULT: "" };
}

function getModelLabel(
  p: LLMProvider,
  modelValue: string,
  catalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>,
): string {
  const config = getModelConfig(p, catalog);
  const found = config.OPTIONS.find((option) => option.value === modelValue);
  if (!found) {
    return modelValue;
  }
  // Pi exposes several channels, so the collapsed picker names the channel too;
  // without it two channels offering the same model id read identically.
  return found.group ? `${found.group} · ${found.label}` : found.label;
}

function getProviderDisplayName(p: LLMProvider) {
  if (p === "claude") return "Claude";
  if (p === "cursor") return "Cursor";
  if (p === "codex") return "Codex";
  if (p === "opencode") return "OpenCode";
  if (p === "dsh") return "DeepSeek Harness";
  if (p === "workbuddy") return "WorkBuddy";
  if (p === "pi") return "Pi";
  if (p === "zcode") return "ZCode";
  if (p === "omp") return "OMP";
  return "Claude";
}

/**
 * Rendered by chat's ChatMessagesPane when a session has no messages yet. The
 * picker is a two-step flow: first choose the tool (provider) whose config
 * drives this chat, then pick a model from that tool's own model list.
 */
export default function ProviderSelectionEmptyState({
  selectedSession,
  provider,
  setProvider,
  textareaRef,
  providerModels,
  setProviderModel,
  providerModelCatalog,
  providerModelActions,
  providerModelsLoading,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation("chat");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false);
  const availableProviders = useAvailableProviders();

  const visibleProviders = useMemo(
    () => PROVIDER_META.filter(({ id }) => availableProviders?.has(id)),
    [availableProviders],
  );

  useEffect(() => {
    const fallbackProvider = visibleProviders[0]?.id;
    if (fallbackProvider && !availableProviders?.has(provider)) {
      setProvider(fallbackProvider);
      writeSelectedProvider(fallbackProvider);
    }
  }, [availableProviders, provider, setProvider, visibleProviders]);

  const nextTaskPrompt = t("tasks.nextTaskPrompt", {
    defaultValue: "Start the next task",
  });

  const currentModel = providerModels[provider];

  const currentModelLabel = useMemo(() => {
    return getModelLabel(provider, currentModel, providerModelCatalog);
  }, [provider, currentModel, providerModelCatalog]);

  // The model dialog is scoped to the active tool: after picking a tool the
  // list shows only the models that tool's own config exposes.
  const activeProviderGroup = useMemo<ProviderGroup | null>(() => {
    const meta = PROVIDER_META.find((p) => p.id === provider);
    if (!meta) {
      return null;
    }
    return {
      id: meta.id,
      name: meta.name,
      models: providerModelCatalog[meta.id]?.OPTIONS ?? [],
    };
  }, [provider, providerModelCatalog]);

  // Pi exposes every configured channel, so its models are split into sections
  // that keep same-named entries from different channels distinguishable. A
  // single-catalog provider yields one ungrouped section and renders as before.
  const modelGroups = useMemo(
    () => groupModelOptions(activeProviderGroup?.models ?? []),
    [activeProviderGroup],
  );
  const hasChannelGroups = modelGroups.some((group) => group.key !== null);

  const handleToolSelect = useCallback(
    (providerId: LLMProvider) => {
      setProvider(providerId);
      writeSelectedProvider(providerId);
    },
    [setProvider],
  );

  const handleModelSelect = useCallback(
    (providerId: LLMProvider, modelValue: string) => {
      setProvider(providerId);
      writeSelectedProvider(providerId);
      setProviderModel(providerId, modelValue);
      setDialogOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    },
    [setProvider, setProviderModel, textareaRef],
  );

  const openModelLibrary = () => {
    setDialogOpen(false);
    setModelLibraryOpen(true);
  };

  const closeModelLibrary = () => {
    setModelLibraryOpen(false);
    setDialogOpen(true);
  };

  if (!selectedSession) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-[34.25rem]">
          <div className="mb-6 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {t("providerSelection.title")}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("providerSelection.description")}
            </p>
          </div>

          {/* Step 1: pick the tool (provider) whose config drives this chat. */}
          <div>
            <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("providerSelection.chooseTool", { defaultValue: "1 · Choose your tool" })}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {visibleProviders.map((p) => {
                const isActive = provider === p.id;
                const toolModelLabel = getModelLabel(p.id, providerModels[p.id], providerModelCatalog);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleToolSelect(p.id)}
                    aria-pressed={isActive}
                    title={`${getProviderDisplayName(p.id)} · ${toolModelLabel}`}
                    className={`group flex items-center gap-2 rounded-xl border p-3 text-left transition-all duration-150 active:scale-[0.99] ${
                      isActive
                        ? "border-primary/50 bg-primary/[0.06] shadow-sm"
                        : "border-border/60 hover:border-border hover:shadow-md"
                    }`}
                  >
                    <LLMProviderLogo provider={p.id} className="h-5 w-5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground">
                          {getProviderDisplayName(p.id)}
                        </span>
                        {isActive && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {toolModelLabel}
                      </span>
                    </span>
                  </button>
                );
              })}
              {availableProviders === null && (
                <p className="col-span-2 py-4 text-center text-xs text-muted-foreground">
                  {t('providerSelection.checkingTools', { defaultValue: 'Checking installed tools…' })}
                </p>
              )}
              {availableProviders && visibleProviders.length === 0 && (
                <p className="col-span-2 py-4 text-center text-xs text-muted-foreground">
                  {t('providerSelection.noInstalledTools', { defaultValue: 'No supported tools are installed.' })}
                </p>
              )}
            </div>
          </div>

          {/* Step 2: pick the active tool's model from its config. */}
          <div className="mt-5">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("providerSelection.chooseModelStep", { defaultValue: "2 · Choose a model" })}
            </p>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Card
                  className="group mx-auto mt-2 max-w-xs cursor-pointer border-border/60 transition-all duration-150 hover:border-border hover:shadow-md active:scale-[0.99]"
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-center gap-2 p-3">
                    <LLMProviderLogo
                      provider={provider}
                      className="h-5 w-5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-semibold text-foreground">
                          {getProviderDisplayName(provider)}
                        </span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="truncate text-xs text-foreground">
                          {currentModelLabel}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {t("providerSelection.clickToChooseModel", {
                          defaultValue: "Click to choose a model",
                        })}
                      </p>
                    </div>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5" />
                  </div>
                </Card>
              </DialogTrigger>

              <DialogContent className="max-w-md overflow-hidden p-0">
                <DialogTitle>
                  {t("providerSelection.modelSelectorTitle", { defaultValue: "Model Selector" })}
                </DialogTitle>
                <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <LLMProviderLogo provider={provider} className="h-5 w-5 shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {t("providerSelection.chooseModelForTool", {
                          tool: getProviderDisplayName(provider),
                          defaultValue: "{{tool}} models",
                        })}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {t("providerSelection.chooseModelDescription", {
                          defaultValue: "Models available in this tool's config",
                        })}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={openModelLibrary}
                    className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("providerSelection.addModel", { defaultValue: "Add model" })}
                  </Button>
                </div>
                <Command filter={modelSearchFilter}>
                  <CommandInput
                    placeholder={t("providerSelection.searchModels", {
                      defaultValue: "Search models...",
                    })}
                  />
                  <CommandList className="max-h-[350px]">
                    <CommandEmpty>
                      {t("providerSelection.noModelsFound", {
                        defaultValue: "No models found.",
                      })}
                    </CommandEmpty>
                    {activeProviderGroup && (
                      <>
                        {activeProviderGroup.models.length === 0 && providerModelsLoading ? (
                          <CommandGroup>
                            <CommandItem disabled className="ml-4 border-l border-border/40 pl-4 text-muted-foreground">
                              {t("providerSelection.loadingModels", { defaultValue: "Loading models…" })}
                            </CommandItem>
                          </CommandGroup>
                        ) : null}
                        {modelGroups.map((group) => (
                          <CommandGroup
                            key={group.key ?? '__ungrouped'}
                            heading={
                              hasChannelGroups
                                ? group.key ?? t("providerSelection.otherModels", { defaultValue: "Other" })
                                : undefined
                            }
                          >
                            {group.options.map((model) => {
                              const isSelected = currentModel === model.value;
                              return (
                                <CommandItem
                                  key={`${activeProviderGroup.id}-${model.value}`}
                                  value={`${group.key ?? ''} ${activeProviderGroup.name} ${model.label} ${model.description || ''}`}
                                  onSelect={() => handleModelSelect(activeProviderGroup.id, model.value)}
                                  className="ml-4 border-l border-border/40 pl-4"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span className="truncate">{model.label}</span>
                                      {model.isCustom && (
                                        <Badge className="h-4 shrink-0 rounded-full px-1.5 text-[8px]">
                                          {t("providerSelection.custom", { defaultValue: "Custom" })}
                                        </Badge>
                                      )}
                                    </div>
                                    {model.label !== model.value && (
                                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                                        {model.value}
                                      </div>
                                    )}
                                  </div>
                                  {isSelected && (
                                    <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                                  )}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        ))}
                      </>
                    )}
                  </CommandList>
                </Command>
              </DialogContent>
            </Dialog>
          </div>

          <Dialog
            open={modelLibraryOpen}
            onOpenChange={(open) => {
              if (open) {
                setModelLibraryOpen(true);
              } else {
                closeModelLibrary();
              }
            }}
          >
            <DialogContent className="flex h-[min(90dvh,46rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden rounded-3xl p-4 sm:p-5">
              <DialogTitle>
                {t("providerSelection.manageModels", {
                  defaultValue: "Manage models",
                })}
              </DialogTitle>
              <ModelLibraryPanel
                initialProvider={provider}
                providerModelCatalog={providerModelCatalog}
                actions={providerModelActions}
                onDone={closeModelLibrary}
              />
            </DialogContent>
          </Dialog>

          <p className="mt-4 text-center text-sm text-muted-foreground/70">
            {
              {
                claude: t("providerSelection.readyPrompt.claude", {
                  model: currentModelLabel,
                }),
                cursor: t("providerSelection.readyPrompt.cursor", {
                  model: currentModelLabel,
                }),
                codex: t("providerSelection.readyPrompt.codex", {
                  model: currentModelLabel,
                }),
                opencode: t("providerSelection.readyPrompt.opencode", {
                  model: currentModelLabel,
                  defaultValue: "Ready with OpenCode {{model}}",
                }),
                dsh: t("providerSelection.readyPrompt.dsh", {
                  model: currentModelLabel,
                  defaultValue: "Ready with DeepSeek Harness {{model}}",
                }),
                pi: t("providerSelection.readyPrompt.pi", {
                  model: currentModelLabel,
                  defaultValue: "Ready with Pi {{model}}",
                }),
                workbuddy: t("providerSelection.readyPrompt.workbuddy", {
                  model: currentModelLabel,
                  defaultValue: "Ready with WorkBuddy {{model}}",
                }),
                zcode: t("providerSelection.readyPrompt.zcode", {
                  model: currentModelLabel,
                  defaultValue: "Ready with ZCode {{model}}",
                }),
                omp: t("providerSelection.readyPrompt.omp", {
                  model: currentModelLabel,
                  defaultValue: "Ready with OMP {{model}}",
                }),
              }[provider]
            }
          </p>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground/60">
            <Trans
              ns="chat"
              i18nKey="providerSelection.pressToSearch"
              values={{ shortcut: MOD_KEY === "⌘" ? "⌘K" : "Ctrl+K" }}
              components={{
                kbd: (
                  <kbd className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]" />
                ),
              }}
            />
          </p>

          {provider && tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-[34.25rem] px-6 text-center">
          <p className="mb-1.5 text-lg font-semibold text-foreground">
            {t("session.continue.title")}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("session.continue.description")}
          </p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
