import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, ShieldAlert } from 'lucide-react';

import { api } from '@/shared/api';
import { MCP_PROVIDER_NAMES } from '@/shared/constants';
import { readSelectedProvider } from '@/shared/selectedProvider';
import { readUserPreference } from '@/shared/userSettings';
import type { ProviderModelSettings } from '@/shared/providerModelSettings';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Button,
  Input,
  LLMProviderLogo,
  Pill,
  PillBar,
} from '@/shared/ui';
import { SelectMenu, type SelectMenuOption } from '@/modules/scheduled-tasks/SelectMenu';
import type {
  LLMProvider,
  ProviderModelsDefinition,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskScheduleKind,
} from '@/shared/types';
import { cn } from '@/shared/utils';

type ScheduledTaskDialogProps = {
  isOpen: boolean;
  /** The task being edited, or null when creating one. */
  task: ScheduledTask | null;
  onClose: () => void;
  onSubmit: (input: ScheduledTaskInput) => Promise<void>;
};

type IntervalUnit = 'minutes' | 'hours';

type FormState = {
  name: string;
  prompt: string;
  provider: LLMProvider;
  model: string;
  effort: string;
  projectPath: string;
  scheduleKind: ScheduledTaskScheduleKind;
  /** `datetime-local` value for a one-time rule, in the browser's zone. */
  onceAt: string;
  /** Amount paired with `everyUnit`; converted to minutes on submit. */
  everyAmount: string;
  everyUnit: IntervalUnit;
  /** `HH:mm` for daily and weekly rules. */
  time: string;
  weekdays: number[];
  timezone: string;
};

/** The weekday order the picker shows, starting on Monday because the work week does. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The rule kinds in the order the pill bar offers them, with their short labels. */
const SCHEDULE_KINDS: { kind: ScheduledTaskScheduleKind; labelKey: string }[] = [
  { kind: 'once', labelKey: 'scheduledTasks.kindOnce' },
  { kind: 'interval', labelKey: 'scheduledTasks.kindInterval' },
  { kind: 'daily', labelKey: 'scheduledTasks.kindDaily' },
  { kind: 'weekly', labelKey: 'scheduledTasks.kindWeekly' },
];

/** Small uppercase heading that separates the form into three readable groups. */
function SectionHeading({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      <span aria-hidden className="h-3 w-[3px] rounded-full bg-primary/50" />
      {children}
    </p>
  );
}

/** Turns an instant into the value a `datetime-local` input expects, which carries no zone. */
function toLocalInputValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function defaultOnceAt(): string {
  return toLocalInputValue(new Date(Date.now() + 60 * 60_000));
}

function readBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The model and effort the user last used for this provider, the same pair a new conversation starts with. */
function readPreferredSelection(provider: LLMProvider): { model?: string; effort?: string } {
  return readUserPreference<ProviderModelSettings>('providerModelSettings', {})[provider] ?? {};
}

/** Names a provider the way the new-conversation picker does, rather than its raw id. */
function providerLabel(provider: LLMProvider): string {
  return MCP_PROVIDER_NAMES[provider] ?? provider;
}

function toFormState(task: ScheduledTask | null, fallbackProvider: LLMProvider | null): FormState {
  const base: FormState = {
    name: '',
    prompt: '',
    provider: fallbackProvider ?? 'claude',
    model: '',
    effort: '',
    projectPath: '',
    scheduleKind: 'daily',
    onceAt: defaultOnceAt(),
    everyAmount: '1',
    everyUnit: 'hours',
    time: '09:00',
    weekdays: [1, 2, 3, 4, 5],
    timezone: readBrowserTimezone(),
  };

  if (!task) {
    return base;
  }

  const form: FormState = {
    ...base,
    name: task.name,
    prompt: task.prompt,
    provider: task.provider,
    model: task.model ?? '',
    effort: task.effort ?? '',
    projectPath: task.projectPath,
    scheduleKind: task.schedule.kind,
    timezone: task.timezone,
  };

  const schedule = task.schedule;
  if (schedule.kind === 'once') {
    form.onceAt = toLocalInputValue(new Date(schedule.at));
  } else if (schedule.kind === 'interval') {
    // Show whole hours when the stored interval divides evenly, so reopening an
    // "every 2 hours" task does not read as "every 120 minutes".
    const isWholeHours = schedule.everyMinutes % 60 === 0;
    form.everyAmount = String(isWholeHours ? schedule.everyMinutes / 60 : schedule.everyMinutes);
    form.everyUnit = isWholeHours ? 'hours' : 'minutes';
  } else {
    form.time = schedule.time;
    if (schedule.kind === 'weekly') {
      form.weekdays = schedule.weekdays;
    }
  }

  return form;
}

/** Builds the payload the server validates, converting the form's units to the rule's fields. */
function toSchedulePayload(form: FormState): Pick<ScheduledTaskInput, 'scheduleKind' | 'scheduleSpec'> {
  if (form.scheduleKind === 'once') {
    return {
      scheduleKind: 'once',
      scheduleSpec: { at: new Date(form.onceAt).toISOString() },
    };
  }

  if (form.scheduleKind === 'interval') {
    const amount = Number(form.everyAmount);
    return {
      scheduleKind: 'interval',
      scheduleSpec: {
        everyMinutes: Math.max(1, Math.round(amount * (form.everyUnit === 'hours' ? 60 : 1))),
      },
    };
  }

  if (form.scheduleKind === 'daily') {
    return { scheduleKind: 'daily', scheduleSpec: { time: form.time } };
  }

  return {
    scheduleKind: 'weekly',
    scheduleSpec: { time: form.time, weekdays: form.weekdays },
  };
}

/** Rendered by the scheduled tasks settings tab to create or edit one task. */
export default function ScheduledTaskDialog({
  isOpen,
  task,
  onClose,
  onSubmit,
}: ScheduledTaskDialogProps) {
  const { t } = useTranslation('settings');
  // Providers this server can actually run, read once when the dialog opens.
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  // The selected provider's catalog, tagged with the provider it was read for
  // so a slow response for the previous provider never feeds the current picker.
  const [catalog, setCatalog] = useState<{
    provider: LLMProvider;
    definition: ProviderModelsDefinition | null;
  } | null>(null);
  // Every field of the task being edited, kept together so switching the rule
  // kind does not lose the values the other kinds use.
  const [form, setForm] = useState<FormState>(() => toFormState(task, null));
  // Shown under the submit button; cleared when the dialog reopens.
  const [error, setError] = useState<string | null>(null);
  // Disables the submit button while a save is in flight.
  const [isSaving, setIsSaving] = useState(false);
  // Tracks the open state the rendered error belongs to, so reopening after a
  // failed save does not show that failure against a fresh form.
  const [renderedOpen, setRenderedOpen] = useState(isOpen);
  if (renderedOpen !== isOpen) {
    setRenderedOpen(isOpen);
    if (isOpen) {
      setError(null);
    }
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await api.providers.available();
        const payload = await response.json();
        const available: LLMProvider[] = Array.isArray(payload?.data?.providers) ? payload.data.providers : [];
        if (cancelled) {
          return;
        }
        setProviders(available);
        setForm((current) => {
          // A new task starts on the tool the user last chose, the way a new
          // conversation does, rather than a hardcoded one that may not be
          // installed. An existing task always keeps the tool it was saved with.
          const provider = task
            ? task.provider
            : available.includes(readSelectedProvider())
              ? readSelectedProvider()
              : available[0] ?? current.provider;
          return { ...toFormState(task, provider), provider };
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, task]);

  useEffect(() => {
    if (!isOpen || !form.provider) {
      return;
    }

    let cancelled = false;
    const targetProvider = form.provider;
    void (async () => {
      try {
        const response = await api.providers.models(targetProvider);
        const payload = await response.json();
        // `/models` answers with a definition ({ OPTIONS, DEFAULT }), not a
        // bare array; reading it as an array left this picker permanently empty.
        const definition: ProviderModelsDefinition | null = Array.isArray(payload?.data?.models?.OPTIONS)
          ? payload.data.models
          : null;
        if (cancelled) {
          return;
        }
        setCatalog({ provider: targetProvider, definition });
        setForm((current) => {
          const options = definition?.OPTIONS ?? [];
          // Keep an explicitly chosen model; otherwise start where a new
          // conversation would: the user's saved pick, then the catalog default.
          if (current.model && options.some((option) => option.value === current.model)) {
            return current;
          }
          const preferred = readPreferredSelection(current.provider);
          const model = preferred.model && options.some((option) => option.value === preferred.model)
            ? preferred.model
            : definition?.DEFAULT ?? options[0]?.value ?? '';
          const effortValues = options.find((option) => option.value === model)?.effort?.values ?? [];
          const effort = !current.effort
            && preferred.effort
            && effortValues.some((value) => value.value === preferred.effort)
            ? preferred.effort
            : current.effort;
          return { ...current, model, effort };
        });
      } catch {
        // A catalog that cannot be read leaves the picker empty; the server
        // still accepts a task whose model is unset.
        if (!cancelled) {
          setCatalog({ provider: targetProvider, definition: null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [form.provider, isOpen]);

  const models = useMemo(
    () => (catalog?.provider === form.provider ? catalog.definition?.OPTIONS ?? [] : []),
    [catalog, form.provider],
  );

  const selectedModel = useMemo(
    () => models.find((option) => option.value === form.model) ?? null,
    [form.model, models],
  );
  const effortValues = selectedModel?.effort?.values ?? [];

  // Rows mirror the composer's model menu: a provider logo per option, and the
  // channel prefix Pi needs to tell two identically named models apart.
  const providerOptions = useMemo<SelectMenuOption[]>(() => {
    // A saved task keeps a provider that is no longer installed, and it still
    // has to show as the current value.
    const list = providers.includes(form.provider) ? providers : [form.provider, ...providers];
    return list.map((provider) => ({
      value: provider,
      label: providerLabel(provider),
      icon: <LLMProviderLogo provider={provider} className="h-3.5 w-3.5 shrink-0" />,
    }));
  }, [form.provider, providers]);

  const modelOptions = useMemo<SelectMenuOption[]>(() => {
    // A single-channel catalog repeats the same prefix on every row, so it is
    // only shown when it actually tells two models apart (Pi's channels).
    const groups = new Set(models.map((option) => option.group).filter(Boolean));
    const showGroup = groups.size > 1;
    return models.map((option) => ({
      value: option.value,
      label: showGroup && option.group ? `${option.group} · ${option.label}` : option.label,
      description: option.description,
    }));
  }, [models]);

  const effortOptions: SelectMenuOption[] = [
    { value: '', label: t('scheduledTasks.effortDefault') },
    ...effortValues.map((option) => ({ value: option.value, label: option.value })),
  ];

  const update = <TKey extends keyof FormState>(key: TKey, value: FormState[TKey]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  // An empty interval input reads as `Number('') === 0`, which the payload
  // builder clamps to one minute; an empty `onceAt` becomes an invalid Date and
  // throws inside `toISOString()`. Both are refused here instead of silently
  // creating a task that runs every minute or showing a raw Date error.
  const intervalAmount = Number(form.everyAmount);
  const scheduleIsValid = form.scheduleKind === 'once'
    ? form.onceAt !== '' && !Number.isNaN(new Date(form.onceAt).getTime())
    : form.scheduleKind === 'interval'
      ? Number.isFinite(intervalAmount) && intervalAmount >= 1
      : true;

  const canSubmit = form.name.trim() !== ''
    && form.prompt.trim() !== ''
    && scheduleIsValid
    && (form.scheduleKind !== 'weekly' || form.weekdays.length > 0);

  const handleSubmit = async () => {
    if (!canSubmit || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const schedule = toSchedulePayload(form);
      await onSubmit({
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        provider: form.provider,
        model: form.model || null,
        effort: form.effort || null,
        // Blank path means the server picks the home folder; sending "" would
        // store it as if it were a real directory.
        projectPath: form.projectPath.trim() || null,
        scheduleKind: schedule.scheduleKind,
        scheduleSpec: schedule.scheduleSpec,
        timezone: form.timezone,
      });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setIsSaving(false);
    }
  };

  const fieldClass = 'w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary';
  const title = task ? t('scheduledTasks.editTitle') : t('scheduledTasks.createTitle');

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] w-[min(94vw,560px)] max-w-[560px] flex-col overflow-hidden p-0">
        {/* Screen-reader name; the visible heading below repeats it for sighted users. */}
        <DialogTitle>{title}</DialogTitle>

        <div className="flex shrink-0 items-start gap-3 border-b border-border/60 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <CalendarClock className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            {/* The dialog's accessible name is the DialogTitle above; this copy is visual only. */}
            <h2 aria-hidden className="truncate text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('scheduledTasks.dialogSubtitle')}</p>
          </div>
        </div>

        {/* The form scrolls; the header and footer stay put, so Save is never below the fold. */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <SectionHeading>{t('scheduledTasks.sectionContent')}</SectionHeading>

            <div className="space-y-1.5">
              <label htmlFor="scheduled-task-name" className="block text-xs font-medium text-muted-foreground">
                {t('scheduledTasks.name')}
              </label>
              <Input
                id="scheduled-task-name"
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                maxLength={120}
                placeholder={t('scheduledTasks.namePlaceholder')}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="scheduled-task-prompt" className="block text-xs font-medium text-muted-foreground">
                {t('scheduledTasks.prompt')}
              </label>
              <textarea
                id="scheduled-task-prompt"
                value={form.prompt}
                onChange={(event) => update('prompt', event.target.value)}
                rows={4}
                className={cn(fieldClass, 'resize-y')}
                placeholder={t('scheduledTasks.promptPlaceholder')}
              />
            </div>
          </section>

          <section className="space-y-3 border-t border-border/60 pt-5">
            <SectionHeading>{t('scheduledTasks.sectionRunner')}</SectionHeading>

            <div className="space-y-1.5">
              <label htmlFor="scheduled-task-project" className="block text-xs font-medium text-muted-foreground">
                {t('scheduledTasks.projectPath')}
              </label>
              <Input
                id="scheduled-task-project"
                value={form.projectPath}
                onChange={(event) => update('projectPath', event.target.value)}
                placeholder={t('scheduledTasks.projectPathPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('scheduledTasks.projectPathHint')}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="scheduled-task-provider" className="block text-xs font-medium text-muted-foreground">
                  {t('scheduledTasks.provider')}
                </label>
                <SelectMenu
                  id="scheduled-task-provider"
                  ariaLabel={t('scheduledTasks.provider')}
                  value={form.provider}
                  options={providerOptions}
                  onChange={(next) => update('provider', next as LLMProvider)}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="scheduled-task-model" className="block text-xs font-medium text-muted-foreground">
                  {t('scheduledTasks.model')}
                </label>
                <SelectMenu
                  id="scheduled-task-model"
                  ariaLabel={t('scheduledTasks.model')}
                  value={form.model}
                  options={modelOptions}
                  placeholder={t('scheduledTasks.modelDefault')}
                  onChange={(next) => setForm((current) => ({ ...current, model: next, effort: '' }))}
                />
              </div>
            </div>

            {effortValues.length > 0 && (
              <div className="space-y-1.5">
                <label htmlFor="scheduled-task-effort" className="block text-xs font-medium text-muted-foreground">
                  {t('scheduledTasks.effort')}
                </label>
                <SelectMenu
                  id="scheduled-task-effort"
                  ariaLabel={t('scheduledTasks.effort')}
                  value={form.effort}
                  options={effortOptions}
                  onChange={(next) => update('effort', next)}
                  className="sm:w-52"
                />
              </div>
            )}
          </section>

          <section className="space-y-3 border-t border-border/60 pt-5">
            <SectionHeading>{t('scheduledTasks.sectionSchedule')}</SectionHeading>

            <PillBar className="grid w-full grid-cols-4">
              {SCHEDULE_KINDS.map(({ kind, labelKey }) => (
                <Pill
                  key={kind}
                  isActive={form.scheduleKind === kind}
                  aria-pressed={form.scheduleKind === kind}
                  onClick={() => update('scheduleKind', kind)}
                  className="justify-center text-xs"
                >
                  {t(labelKey)}
                </Pill>
              ))}
            </PillBar>

            {form.scheduleKind === 'once' && (
              <Input
                aria-label={t('scheduledTasks.runAt')}
                type="datetime-local"
                value={form.onceAt}
                onChange={(event) => update('onceAt', event.target.value)}
                className="w-full sm:w-64"
              />
            )}

            {form.scheduleKind === 'interval' && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t('scheduledTasks.every')}</span>
                <Input
                  aria-label={t('scheduledTasks.intervalAmount')}
                  type="number"
                  min={1}
                  value={form.everyAmount}
                  onChange={(event) => update('everyAmount', event.target.value)}
                  className="w-24"
                />
                <SelectMenu
                  ariaLabel={t('scheduledTasks.intervalUnit')}
                  value={form.everyUnit}
                  options={[
                    { value: 'minutes', label: t('scheduledTasks.unitMinutes') },
                    { value: 'hours', label: t('scheduledTasks.unitHours') },
                  ]}
                  onChange={(next) => update('everyUnit', next as IntervalUnit)}
                  className="w-32"
                />
              </div>
            )}

            {(form.scheduleKind === 'daily' || form.scheduleKind === 'weekly') && (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={t('scheduledTasks.timeOfDay')}
                  type="time"
                  value={form.time}
                  onChange={(event) => update('time', event.target.value)}
                  className="w-28"
                />
                {form.scheduleKind === 'weekly' && (
                  <div className="grid min-w-64 flex-1 grid-cols-7 gap-1.5">
                    {WEEKDAY_ORDER.map((day) => {
                      const selected = form.weekdays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => update(
                            'weekdays',
                            selected ? form.weekdays.filter((value) => value !== day) : [...form.weekdays, day].sort(),
                          )}
                          className={cn(
                            'h-8 rounded-lg border text-xs font-medium transition-colors',
                            selected
                              ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                              : 'border-input bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
                          )}
                        >
                          {t(`scheduledTasks.weekdayShort.${day}`)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="scheduled-task-timezone" className="text-xs font-medium text-muted-foreground">
                {t('scheduledTasks.timezone')}
              </label>
              <Input
                id="scheduled-task-timezone"
                value={form.timezone}
                onChange={(event) => update('timezone', event.target.value)}
                className="h-8 w-44 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">{t('scheduledTasks.timezoneHint')}</p>
            </div>
          </section>

          <div className="flex gap-2.5 rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-xs leading-relaxed text-muted-foreground">{t('scheduledTasks.unattendedNote')}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-border/60 bg-muted/20 px-5 py-3">
          <div className="min-w-0 flex-1">
            {error
              ? <p role="alert" className="text-xs text-destructive">{error}</p>
              : !canSubmit && (
                <p className="truncate text-[11px] text-muted-foreground">{t('scheduledTasks.requiredHint')}</p>
              )}
          </div>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            {t('scheduledTasks.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit || isSaving}>
            {isSaving ? t('scheduledTasks.saving') : t('scheduledTasks.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
