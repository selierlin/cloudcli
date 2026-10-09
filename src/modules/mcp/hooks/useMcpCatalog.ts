import { useCallback, useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type {
  McpCatalogEntry,
  McpCatalogProjectionOutcome,
  McpFormState,
  McpProvider,
} from '@/shared/types';
import { invalidateMcpServersCache } from '@/modules/mcp/hooks/useMcpServers';
import { createMcpCatalogEntryPayload } from '@/modules/mcp/utils/mcpFormatting';
import { getCellDisabledReason } from '@/modules/mcp/utils/mcpMatrixRules';

type McpCatalogResponse = {
  data: { entries: McpCatalogEntry[] };
};

type McpCatalogUpsertResponse = {
  data: { entry: McpCatalogEntry; outcomes: McpCatalogProjectionOutcome[] };
};

type McpCatalogToggleResponse = {
  data: { entry: McpCatalogEntry; outcomes: McpCatalogProjectionOutcome[] };
};

type McpCatalogDeleteResponse = {
  data: { removed: boolean; outcomes: McpCatalogProjectionOutcome[] };
};

type McpCatalogResyncResponse = {
  data: { outcomes: McpCatalogProjectionOutcome[] };
};

/**
 * The in-flight or failed write for one entry × harness cell.
 *
 * A failed write is not a failed switch: the catalog row is already flipped and
 * the cell's `on`/`off` follows it, but projecting that change into the
 * harness's config file failed. `desired` is kept so a retry repeats the value
 * the write was reaching for instead of flipping away from it.
 */
export type McpCatalogCellWrite =
  | { status: 'pending' }
  | { status: 'failed'; desired: boolean; error?: string };

/** Addresses one matrix cell: the entry whose definition is written, and the harness it is written into. */
export const getMcpCellKey = (entryId: string, provider: McpProvider): string => `${entryId}:${provider}`;

/** One entry × harness pair a batch write addresses. */
export type McpCatalogTarget = {
  entry: McpCatalogEntry;
  provider: McpProvider;
};

/**
 * What the last batch write did, so it can be taken back.
 *
 * Only the cells whose value actually changed are kept: a cell that was already
 * `on` when the batch turned the column on is untouched, and undoing it would
 * silently rewrite a config file for nothing.
 */
export type McpCatalogUndo = {
  targets: McpCatalogTarget[];
  /** The value the batch set those cells to; undo writes the opposite back. */
  enabled: boolean;
};

type McpCatalogState = {
  entries: McpCatalogEntry[];
  isLoading: boolean;
  /** The server's own failure message, or null when the last load succeeded. */
  error: string | null;
  /** Write state per cell, keyed by {@link getMcpCellKey}; a cell is absent once its last write succeeded. */
  cellWrites: Record<string, McpCatalogCellWrite>;
  reload: () => void;
  /** Flips one harness switch and projects the entry into (or out of) that harness. */
  toggle: (entry: McpCatalogEntry, provider: McpProvider, enabled: boolean) => Promise<void>;
  /**
   * Creates a catalog entry (when `entry` is null) or rewrites one from the
   * form, then re-projects it into every harness it is enabled for.
   *
   * Resolves with the harnesses that had to be switched off because the saved
   * definition cannot be projected into them any more, so the caller can say so.
   */
  upsert: (entry: McpCatalogEntry | null, formData: McpFormState) => Promise<McpProvider[]>;
  /** Sets one value across many cells (a column or a row) and records it as undoable. */
  applyBatch: (targets: McpCatalogTarget[], enabled: boolean) => Promise<void>;
  /** Deletes one entry from the catalog and from every harness it was projected into. */
  remove: (entry: McpCatalogEntry) => Promise<McpCatalogProjectionOutcome[]>;
  /**
   * Escape hatch: re-applies the whole catalog from its switches and reports the
   * per-harness results, so a projection that failed somewhere without a
   * cell-level retry left to press can be repaired in one go.
   */
  resync: () => Promise<McpCatalogProjectionOutcome[]>;
  /** The undo affordance for the last batch, or null when there is nothing to take back. */
  undo: McpCatalogUndo | null;
  undoBatch: () => Promise<void>;
  dismissUndo: () => void;
};

/** Normalizes anything a write can reject with into displayable text; empty when there is nothing to show. */
const toErrorMessage = (error: unknown): string => {
  if (error === undefined || error === null) {
    return '';
  }

  if (typeof error === 'string') {
    return error;
  }

  return error instanceof Error ? error.message : String(error);
};

/** Rebuilds stale batch targets against the current entries, dropping any that no longer exist. */
const refreshTargets = (
  targets: McpCatalogTarget[],
  entries: McpCatalogEntry[],
): McpCatalogTarget[] => targets
  .map((target) => {
    const entry = entries.find((candidate) => candidate.id === target.entry.id);
    return entry ? { entry, provider: target.provider } : null;
  })
  .filter((target): target is McpCatalogTarget => target !== null);

/**
 * Reads and writes the app-side MCP catalog behind the MCP matrix.
 *
 * Every successful write also drops the per-harness file cache the old
 * per-harness page reads through, because the write landed in that harness's
 * config file.
 */
export function useMcpCatalog(): McpCatalogState {
  const [entries, setEntries] = useState<McpCatalogEntry[]>([]);
  // Drives the loading flag; bumped by `reload` to re-run the effect below.
  const [reloadToken, setReloadToken] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cellWrites, setCellWrites] = useState<Record<string, McpCatalogCellWrite>>({});
  const [undo, setUndo] = useState<McpCatalogUndo | null>(null);

  const reload = useCallback(() => {
    setIsLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  /**
   * Writes one cell and reports whether the harness accepted the projection.
   *
   * The catalog switch is written first by the server, so a rejection here means
   * only the harness's config file is stale — the cell shows `fail` and the same
   * value can be retried.
   */
  const writeCell = useCallback(
    async (entry: McpCatalogEntry, provider: McpProvider, enabled: boolean): Promise<boolean> => {
      const cellKey = getMcpCellKey(entry.id, provider);
      setCellWrites((previous) => ({ ...previous, [cellKey]: { status: 'pending' } }));

      const failWrite = (desired: boolean, writeError: unknown) => {
        const message = toErrorMessage(writeError);
        const failed: McpCatalogCellWrite = message
          ? { status: 'failed', desired, error: message }
          : { status: 'failed', desired };
        setCellWrites((previous) => ({ ...previous, [cellKey]: failed }));
      };

      try {
        const payload = await readApiJson<McpCatalogToggleResponse>(
          await api.providers.mcpCatalogToggle(entry.id, { provider, enabled }),
        );

        setEntries((previous) => previous.map((candidate) => (
          candidate.id === payload.data.entry.id ? payload.data.entry : candidate
        )));

        const outcome = payload.data.outcomes.find((candidate) => candidate.provider === provider);
        if (outcome && !outcome.ok) {
          failWrite(enabled, outcome.error);
          return false;
        }

        setCellWrites((previous) => {
          const next = { ...previous };
          delete next[cellKey];
          return next;
        });
        // The harness's file now disagrees with what that page cached.
        invalidateMcpServersCache(provider);
        return true;
      } catch (writeError) {
        failWrite(enabled, writeError);
        return false;
      }
    },
    [],
  );

  const toggle = useCallback(
    async (entry: McpCatalogEntry, provider: McpProvider, enabled: boolean): Promise<void> => {
      await writeCell(entry, provider, enabled);
    },
    [writeCell],
  );

  /**
   * Saves the form into the catalog and re-projects it.
   *
   * A rejection (a name already taken, an entry deleted meanwhile) propagates so
   * the form can report it and stay open with the user's input; the catalog row
   * is the server's commit point, so nothing is written to a harness before it.
   *
   * The save is what closes the capability gap of §11.1: the harnesses refuse
   * the projection, so the switch is turned off to match, and the caller reports
   * which columns those were.
   */
  const upsert = useCallback(
    async (entry: McpCatalogEntry | null, formData: McpFormState): Promise<McpProvider[]> => {
      const payload = createMcpCatalogEntryPayload(entry?.id ?? null, formData);
      const response = await readApiJson<McpCatalogUpsertResponse>(
        await api.providers.mcpCatalogUpsert(payload),
      );
      const saved = response.data.entry;

      setEntries((previous) => (
        previous.some((candidate) => candidate.id === saved.id)
          ? previous.map((candidate) => (candidate.id === saved.id ? saved : candidate))
          : [...previous, saved]
      ));

      // A harness that cannot speak the new definition must not stay switched
      // on: leaving it would show a cell whose only state is `fail`, and a later
      // `resync` could never clear it. Turning it off is what the projection
      // already failed to do.
      const dropped = (Object.keys(saved.enabled) as McpProvider[]).filter((provider) => (
        saved.enabled[provider] && getCellDisabledReason(saved, provider) !== null
      ));

      for (const provider of dropped) {
        // `writeCell` also drops that harness's cached read once it succeeds.
        await writeCell(saved, provider, false);
      }

      // A harness that refused the projection keeps its switch (the row is the
      // commit point) but has a stale config file, which is exactly the `fail`
      // state — the projection result only exists in this response, so it has to
      // be recorded here or the cell would silently claim the file was written.
      // A dropped column is excluded: it is being turned off, not retried.
      const failures = response.data.outcomes.filter(
        (outcome) => !outcome.ok && !dropped.includes(outcome.provider),
      );
      const failedProviders = new Set(failures.map((failure) => failure.provider));
      if (failures.length > 0) {
        setCellWrites((previous) => {
          const next = { ...previous };
          for (const failure of failures) {
            const desired = saved.enabled[failure.provider];
            next[getMcpCellKey(saved.id, failure.provider)] = failure.error
              ? { status: 'failed', desired, error: failure.error }
              : { status: 'failed', desired };
          }

          return next;
        });
      }

      // An update rewrote the config file of every harness it accepted the write
      // for. A create starts with every switch off, so it wrote nothing; a
      // refusal and a dropped column left that harness's file alone.
      for (const provider of Object.keys(saved.enabled) as McpProvider[]) {
        if (
          saved.enabled[provider]
          && !dropped.includes(provider)
          && !failedProviders.has(provider)
        ) {
          invalidateMcpServersCache(provider);
        }
      }

      return dropped;
    },
    [writeCell],
  );

  /**
   * Applies one value to many cells, one after the other.
   *
   * Cells the harness refuses (a disabled column) and cells already holding the
   * value are skipped: writing them would only rewrite a config file to say what
   * it already says. What is left is what the undo takes back.
   */
  const applyBatch = useCallback(
    async (targets: McpCatalogTarget[], enabled: boolean): Promise<void> => {
      const changed = targets.filter((target) => (
        target.entry.enabled[target.provider] !== enabled
        && !getCellDisabledReason(target.entry, target.provider)
      ));

      setUndo(null);
      for (const target of changed) {
        await writeCell(target.entry, target.provider, enabled);
      }

      if (changed.length > 0) {
        setUndo({ targets: changed, enabled });
      }
    },
    [writeCell],
  );

  /**
   * Takes the last batch back by writing its cells' previous value.
   *
   * The stored targets carry the pre-batch snapshot, so they are re-resolved
   * against the current entries; undo itself is not undoable.
   */
  const undoBatch = useCallback(async (): Promise<void> => {
    if (!undo) {
      return;
    }

    const { targets, enabled } = undo;
    setUndo(null);
    for (const target of refreshTargets(targets, entries)) {
      await writeCell(target.entry, target.provider, !enabled);
    }
  }, [undo, entries, writeCell]);

  const dismissUndo = useCallback(() => {
    setUndo(null);
  }, []);

  const remove = useCallback(
    async (entry: McpCatalogEntry): Promise<McpCatalogProjectionOutcome[]> => {
      const payload = await readApiJson<McpCatalogDeleteResponse>(
        await api.providers.mcpCatalogDelete(entry.id),
      );

      if (!payload.data.removed) {
        return payload.data.outcomes;
      }

      setEntries((previous) => previous.filter((candidate) => candidate.id !== entry.id));
      // The removal touched every harness the entry was enabled for.
      invalidateMcpServersCache();
      return payload.data.outcomes;
    },
    [],
  );

  /**
   * Re-applies the catalog into every harness it manages.
   *
   * A resync does not change a single switch, so the loaded entries stay valid.
   * What it can change is which cells are still `fail`: a harness the resync
   * wrote successfully is back in sync with its switch, and one that failed
   * again keeps its failure.
   */
  const resync = useCallback(async (): Promise<McpCatalogProjectionOutcome[]> => {
    const payload = await readApiJson<McpCatalogResyncResponse>(
      await api.providers.mcpCatalogResync(),
    );
    const outcomes = payload.data.outcomes;
    const attempted = new Set(outcomes.map((outcome) => outcome.provider));
    const failed = new Set(
      outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.provider),
    );
    // A harness is back in sync only when every write attempted for it
    // succeeded: one failure leaves an entry unwritten, and that cell cannot
    // tell which of the harness's writes it is showing.
    const repaired = [...attempted].filter((provider) => !failed.has(provider));

    setCellWrites((previous) => {
      const next = { ...previous };
      for (const entry of entries) {
        for (const provider of repaired) {
          delete next[getMcpCellKey(entry.id, provider)];
        }
      }

      return next;
    });

    // Every repaired harness's config file changed under the old page's cache.
    for (const provider of repaired) {
      invalidateMcpServersCache(provider);
    }

    return outcomes;
  }, [entries]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const payload = await readApiJson<McpCatalogResponse>(await api.providers.mcpCatalog());
        if (cancelled) {
          return;
        }

        setEntries(payload.data.entries);
        setError(null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return {
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
  };
}
