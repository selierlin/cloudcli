import { Check, Minus, MoreHorizontal, Pencil, Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MCP_CATALOG_FORM_PROVIDER,
  MCP_GLOBAL_SUPPORTED_TRANSPORTS,
  MCP_PROVIDER_NAMES,
} from '@/shared/constants';
import type {
  McpCatalogEntry,
  McpCatalogProjectionOutcome,
  McpFormState,
  McpProvider,
  McpScope,
  ProviderMcpServer,
} from '@/shared/types';
import { ActionMenu, Badge, Button, Input } from '@/shared/ui';
import McpMatrixCell from '@/modules/mcp/McpMatrixCell';
import McpServerFormModal from '@/modules/mcp/McpServerFormModal';
import {
  useMcpCatalog,
  getMcpCellKey,
  type McpCatalogCellWrite,
} from '@/modules/mcp/hooks/useMcpCatalog';
import {
  MCP_MATRIX_PROVIDERS,
  getCellDisabledReason,
  getCellState,
  getSearchText,
  type McpMatrixDisabledReason,
} from '@/modules/mcp/utils/mcpMatrixRules';

/**
 * Explains why a cell cannot be switched, naming the harness so a hover text is
 * self-contained when read out of context.
 */
const describeDisabledReason = (
  reason: McpMatrixDisabledReason,
  provider: McpProvider,
  t: TFunction,
): string => {
  const providerName = MCP_PROVIDER_NAMES[provider];

  if (reason.kind === 'transport') {
    return t('mcpMatrix.disabled.transport', { provider: providerName, transport: reason.transport });
  }

  if (reason.kind === 'noNativeSupport') {
    return t('mcpMatrix.disabled.noNativeSupport', { provider: providerName });
  }

  return t('mcpMatrix.disabled.harnessManaged', { provider: providerName });
};

/**
 * The scope list the entry form is given.
 *
 * Module-level because its identity matters: the form reloads its fields
 * whenever this list changes, so a fresh array per render would reset what the
 * user is typing. A catalog entry is always user scope, which is also why the
 * form never needs a project list.
 */
const CATALOG_FORM_SCOPES: McpScope[] = ['user'];

/**
 * Lifts this matrix's portal menus above the dialog that hosts them.
 *
 * Both the Settings dialog and ActionMenu's portal render into `<body>`, and the
 * dialog sits at `z-[9999]` (Settings.tsx). A menu left at ActionMenu's default
 * `z-[70]` therefore paints behind the dialog — on a phone, where the dialog is
 * full-screen, tapping "…" appears to do nothing at all.
 */
const MATRIX_MENU_CLASS = 'z-[10000]';

/** Presents a catalog entry to the shared form, which expects one harness's server. */
const toFormServer = (entry: McpCatalogEntry): ProviderMcpServer => ({
  provider: MCP_CATALOG_FORM_PROVIDER,
  name: entry.name,
  scope: 'user',
  transport: entry.transport,
  ...entry.config,
});

/** Used by the settings dialog's MCP tab to show one catalog of user-scope servers against every harness they can be projected into. */
export default function McpMatrix() {
  const { t } = useTranslation('settings');
  const {
    entries,
    isLoading,
    error,
    cellWrites,
    reload,
    toggle,
    upsert,
    applyBatch,
    remove,
    resync,
    undo,
    undoBatch,
    dismissUndo,
  } = useMcpCatalog();
  // The search query filters rows only; empty means every entry is shown.
  const [searchQuery, setSearchQuery] = useState('');
  // Holds a failed action (a delete a harness refused) since it is not the load error.
  const [actionError, setActionError] = useState<string | null>(null);
  // Holds a completed action worth stating (a save that had to drop columns).
  const [notice, setNotice] = useState<string | null>(null);
  // The resync is the only action whose progress has no cell to show it in.
  const [isResyncing, setIsResyncing] = useState(false);
  // The entry the add/edit form is open for; `entry: null` means a new one.
  const [formTarget, setFormTarget] = useState<{ entry: McpCatalogEntry | null } | null>(null);

  // Memoized on the state object, which keeps its identity across re-renders, so
  // the form does not reload its fields on every parent render.
  const editingServer = useMemo(
    () => (formTarget?.entry ? toFormServer(formTarget.entry) : null),
    [formTarget],
  );

  const visibleEntries = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) {
      return entries;
    }

    return entries.filter((entry) => getSearchText(entry).includes(needle));
  }, [entries, searchQuery]);

  const isNarrowedBySearch = searchQuery.trim().length > 0;

  // One label per entry × harness, so the cell's hover text and accessible name
  // state the exact pair the user is looking at.
  const describeCell = (entry: McpCatalogEntry, provider: McpProvider, write?: McpCatalogCellWrite): string => {
    const reason = getCellDisabledReason(entry, provider);
    if (reason) {
      return describeDisabledReason(reason, provider, t);
    }

    if (write?.status === 'failed') {
      return t('mcpMatrix.cell.fail', {
        name: entry.name,
        provider: MCP_PROVIDER_NAMES[provider],
        error: write.error || t('mcpMatrix.errors.unknown'),
      });
    }

    const state = getCellState(entry, provider);
    return t(`mcpMatrix.cell.${state}`, { name: entry.name, provider: MCP_PROVIDER_NAMES[provider] });
  };

  /**
   * Flips one cell — or repeats the write it last failed.
   *
   * A failed projection leaves the switch where the user put it, so clicking
   * that cell again retries the value the write was reaching for instead of
   * flipping away from the user's own intent.
   */
  const handleToggle = (entry: McpCatalogEntry, provider: McpProvider, write?: McpCatalogCellWrite) => {
    const enabled = write?.status === 'failed' ? write.desired : !entry.enabled[provider];
    void toggle(entry, provider, enabled);
  };

  /** Sets one value down a column. The scope follows the search, so a narrowed table narrows the batch. */
  const handleColumnBatch = (provider: McpProvider, enabled: boolean) => {
    setActionError(null);
    void applyBatch(visibleEntries.map((entry) => ({ entry, provider })), enabled);
  };

  /** Sets one value across a row's harnesses, skipping the ones that refuse it. */
  const handleRowBatch = (entry: McpCatalogEntry, enabled: boolean) => {
    setActionError(null);
    void applyBatch(MCP_MATRIX_PROVIDERS.map((provider) => ({ entry, provider })), enabled);
  };

  const describeOutcomeFailures = (outcomes: McpCatalogProjectionOutcome[]): string => outcomes
    .filter((outcome) => !outcome.ok)
    .map((outcome) => `${MCP_PROVIDER_NAMES[outcome.provider]}: ${outcome.error ?? t('mcpMatrix.errors.unknown')}`)
    .join('; ');

  const handleDelete = (entry: McpCatalogEntry) => {
    if (!window.confirm(t('mcpMatrix.row.deleteConfirm', { name: entry.name }))) {
      return;
    }

    setActionError(null);
    void remove(entry).then((outcomes) => {
      const details = describeOutcomeFailures(outcomes);
      if (details) {
        setActionError(t('mcpMatrix.row.deleteFailed', { details }));
      }
    });
  };

  /**
   * Re-applies the whole catalog, then reports whatever could not be written.
   *
   * The cells themselves show the outcome — a repaired one drops its `fail`
   * state — so only the remaining failures need saying out loud.
   */
  const handleResync = () => {
    setActionError(null);
    setNotice(null);
    setIsResyncing(true);
    void resync()
      .then((outcomes) => {
        const details = describeOutcomeFailures(outcomes);
        if (details) {
          setActionError(t('mcpMatrix.resyncFailed', { details }));
        }
      })
      .finally(() => setIsResyncing(false));
  };

  /**
   * Saves the form and closes it.
   *
   * A rejection (a duplicate name, an entry deleted while the form was open) is
   * left to propagate: the form reports it and keeps the user's input, so the
   * dialog only closes once the catalog accepted the write.
   */
  const handleFormSubmit = async (formData: McpFormState) => {
    const dropped = await upsert(formTarget?.entry ?? null, formData);
    setFormTarget(null);
    setActionError(null);
    setNotice(dropped.length > 0
      ? t('mcpMatrix.form.droppedColumns', {
        providers: dropped.map((provider) => MCP_PROVIDER_NAMES[provider]).join(', '),
      })
      : null);
  };

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Server className="mt-0.5 h-5 w-5 flex-shrink-0 text-purple-500" />
          <div className="min-w-0 space-y-1">
            <h3 className="text-lg font-medium text-foreground">{t('mcpMatrix.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('mcpMatrix.description')}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResync}
            disabled={isResyncing || entries.length === 0}
            aria-busy={isResyncing}
          >
            <RefreshCw />
            {t('mcpMatrix.resync')}
          </Button>
          <Button size="sm" onClick={() => setFormTarget({ entry: null })}>
            <Plus />
            {t('mcpMatrix.addEntry')}
          </Button>
        </div>
      </div>

      <div className="min-h-4">
        {isLoading && <span className="text-xs text-muted-foreground">{t('mcpMatrix.loading')}</span>}
      </div>

      {(error || actionError) && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
          <span className="min-w-0 break-words">{actionError || error}</span>
          {error && (
            <button
              type="button"
              onClick={reload}
              className="flex-shrink-0 font-medium underline underline-offset-2"
            >
              {t('mcpMatrix.reload')}
            </button>
          )}
        </div>
      )}

      {entries.length > 0 && (
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t('mcpMatrix.searchPlaceholder')}
          aria-label={t('mcpMatrix.searchPlaceholder')}
          className="max-w-sm"
        />
      )}

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
        >
          <span className="min-w-0 break-words">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="flex-shrink-0 font-medium underline underline-offset-2"
          >
            {t('mcpMatrix.undo.dismiss')}
          </button>
        </div>
      )}

      {undo && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
        >
          <span className="min-w-0 break-words">
            {t(undo.enabled ? 'mcpMatrix.undo.enabled' : 'mcpMatrix.undo.disabled', {
              count: undo.targets.length,
            })}
          </span>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void undoBatch()}
              className="font-medium underline underline-offset-2"
            >
              {t('mcpMatrix.undo.action')}
            </button>
            <Button variant="ghost" size="sm" onClick={dismissUndo} aria-label={t('mcpMatrix.undo.dismiss')}>
              <span aria-hidden>×</span>
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !error && entries.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">{t('mcpMatrix.empty')}</div>
      )}

      {entries.length > 0 && visibleEntries.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">{t('mcpMatrix.searchNoResults')}</div>
      )}

      {visibleEntries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-medium text-muted-foreground"
                >
                  {t('mcpMatrix.serverColumn')}
                </th>
                {MCP_MATRIX_PROVIDERS.map((provider) => {
                  const columnDisabled = visibleEntries.every(
                    (entry) => getCellDisabledReason(entry, provider) !== null,
                  );
                  return (
                    <th key={provider} scope="col" className="px-3 py-2 text-center font-medium text-muted-foreground">
                      <ActionMenu
                        label={MCP_PROVIDER_NAMES[provider]}
                        ariaLabel={t('mcpMatrix.bulk.menuLabel', { provider: MCP_PROVIDER_NAMES[provider] })}
                        variant="ghost"
                        size="sm"
                        portal
                        menuClassName={MATRIX_MENU_CLASS}
                        disabled={columnDisabled}
                        header={
                          <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">
                            {t(
                              isNarrowedBySearch ? 'mcpMatrix.bulk.scopeSearch' : 'mcpMatrix.bulk.scopeAll',
                              { count: visibleEntries.length },
                            )}
                          </p>
                        }
                        items={[
                          {
                            key: 'enable',
                            label: t('mcpMatrix.bulk.enableAll'),
                            icon: Check,
                            onSelect: () => handleColumnBatch(provider, true),
                          },
                          {
                            key: 'disable',
                            label: t('mcpMatrix.bulk.disableAll'),
                            icon: Minus,
                            onSelect: () => handleColumnBatch(provider, false),
                          },
                        ]}
                      />
                    </th>
                  );
                })}
                <th scope="col" className="px-3 py-2 text-right font-medium text-muted-foreground">
                  <span className="sr-only">{t('mcpMatrix.actionsColumn')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr key={entry.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-t border-border bg-background px-3 py-2 text-left font-medium text-foreground"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{entry.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {entry.transport}
                      </Badge>
                    </div>
                  </th>
                  {MCP_MATRIX_PROVIDERS.map((provider) => {
                    const write = cellWrites[getMcpCellKey(entry.id, provider)];
                    const disabled = getCellDisabledReason(entry, provider) !== null;
                    return (
                      <td key={provider} className="border-t border-border px-3 py-2 text-center">
                        <McpMatrixCell
                          state={getCellState(entry, provider, write?.status === 'failed')}
                          label={describeCell(entry, provider, write)}
                          isBusy={write?.status === 'pending'}
                          onToggle={disabled ? undefined : () => handleToggle(entry, provider, write)}
                        />
                      </td>
                    );
                  })}
                  <td className="border-t border-border px-3 py-2 text-right">
                    <ActionMenu
                      label={t('mcpMatrix.row.menuLabel', { name: entry.name })}
                      iconOnly
                      icon={MoreHorizontal}
                      variant="ghost"
                      size="sm"
                      portal
                      menuClassName={MATRIX_MENU_CLASS}
                      align="right"
                      items={[
                        {
                          key: 'edit',
                          label: t('mcpMatrix.row.edit'),
                          icon: Pencil,
                          onSelect: () => setFormTarget({ entry }),
                        },
                        {
                          key: 'enable',
                          label: t('mcpMatrix.row.enableAll'),
                          icon: Check,
                          onSelect: () => handleRowBatch(entry, true),
                        },
                        {
                          key: 'disable',
                          label: t('mcpMatrix.row.disableAll'),
                          icon: Minus,
                          onSelect: () => handleRowBatch(entry, false),
                        },
                        {
                          key: 'delete',
                          label: t('mcpMatrix.row.delete'),
                          icon: Trash2,
                          isDanger: true,
                          showDividerBefore: true,
                          onSelect: () => handleDelete(entry),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formTarget && (
        <McpServerFormModal
          provider={MCP_CATALOG_FORM_PROVIDER}
          editingServer={editingServer}
          currentProjects={[]}
          supportedScopes={CATALOG_FORM_SCOPES}
          supportedTransports={MCP_GLOBAL_SUPPORTED_TRANSPORTS}
          title={t(editingServer ? 'mcpMatrix.form.editTitle' : 'mcpMatrix.form.addTitle')}
          description={t('mcpMatrix.form.description')}
          submitLabel={t(editingServer ? 'mcpMatrix.form.submitEdit' : 'mcpMatrix.form.submitAdd')}
          onClose={() => setFormTarget(null)}
          onSubmit={handleFormSubmit}
        />
      )}
    </div>
  );
}
