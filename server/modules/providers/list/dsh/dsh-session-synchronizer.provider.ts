import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

/**
 * Provider registry session synchronizer for DSH.
 *
 * The DSH harness persists sessions as JSONL logs under its own storage root
 * (see `@deepseek-ai/dsh-session-persistence-jsonl`). Indexing those logs so
 * past DSH conversations appear in the sidebar lands here.
 */
export class DshSessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(_since?: Date): Promise<number> {
    // TODO(dsh): scan the harness JSONL session directories and upsert sessions.
    return 0;
  }

  async synchronizeFile(_filePath: string): Promise<string | null> {
    // TODO(dsh): parse one JSONL session artifact into a DB session row.
    return null;
  }
}
