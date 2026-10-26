import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

/**
 * Creates a ZCode session database at the layout the provider resolves
 * (`<storage root>/cli/db/db.sqlite`).
 *
 * Only the columns the provider actually reads are declared, matching ZCode's
 * real schema for `session`/`message`/`part`, including the `sequence` columns
 * the readers order by.
 */
export async function createZcodeDatabase(homeDir: string): Promise<string> {
  const dbPath = path.join(homeDir, '.zcode', 'cli', 'db', 'db.sqlite');
  await mkdir(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        directory TEXT NOT NULL,
        title TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        time_archived INTEGER,
        title_source TEXT NOT NULL DEFAULT 'first_input'
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL,
        sequence INTEGER
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL,
        sequence INTEGER
      );
      -- usage / bookkeeping tables ZCode really has. They are declared WITHOUT
      -- foreign keys on purpose: the fixture then fails if the delete starts
      -- depending on a cascade, which a real schema with the FK would hide.
      CREATE TABLE session_entry (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE model_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        model TEXT NOT NULL
      );
      CREATE TABLE turn_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn INTEGER NOT NULL
      );
      CREATE TABLE tool_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool TEXT NOT NULL
      );
      CREATE TABLE input_history (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        text TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }

  return dbPath;
}

const insertSession = (
  db: Database.Database,
  values: {
    sessionId: string;
    workspacePath: string;
    title: string;
    timeCreated: number;
    timeUpdated: number;
    archived?: number | null;
  },
): void => {
  db.prepare(`
    INSERT INTO session (id, project_id, directory, title, time_created, time_updated, time_archived)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.sessionId,
    'project-1',
    values.workspacePath,
    values.title,
    values.timeCreated,
    values.timeUpdated,
    values.archived ?? null,
  );
};

const insertMessage = (
  db: Database.Database,
  values: { id: string; sessionId: string; sequence: number; timeCreated: number; data: unknown },
): void => {
  db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data, sequence)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    values.id,
    values.sessionId,
    values.timeCreated,
    values.timeCreated,
    JSON.stringify(values.data),
    values.sequence,
  );
};

const insertPart = (
  db: Database.Database,
  values: { id: string; messageId: string; sessionId: string; sequence: number; timeCreated: number; data: unknown },
): void => {
  db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data, sequence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.id,
    values.messageId,
    values.sessionId,
    values.timeCreated,
    values.timeCreated,
    JSON.stringify(values.data),
    values.sequence,
  );
};

/**
 * Seeds a rich ZCode session: a user text turn and an assistant turn with
 * reasoning, text, a completed tool call, and a step-finish marker.
 */
export async function seedZcodeRichSession(
  homeDir: string,
  workspacePath: string,
): Promise<string> {
  const dbPath = await createZcodeDatabase(homeDir);
  const db = new Database(dbPath);
  try {
    insertSession(db, {
      sessionId: 'zcode-session-1',
      workspacePath,
      title: 'ZCode indexed title',
      timeCreated: 1_700_000_000_000,
      timeUpdated: 1_700_000_004_000,
    });

    insertMessage(db, {
      id: 'message-user',
      sessionId: 'zcode-session-1',
      sequence: 0,
      timeCreated: 1_700_000_001_000,
      data: { role: 'user', modelId: 'deepseek-v4-flash', providerId: 'ark', mode: 'edit' },
    });
    insertPart(db, {
      id: 'part-user-text',
      messageId: 'message-user',
      sessionId: 'zcode-session-1',
      sequence: 0,
      timeCreated: 1_700_000_001_000,
      data: { type: 'text', text: JSON.stringify('Build the ZCode integration.') },
    });

    insertMessage(db, {
      id: 'message-assistant',
      sessionId: 'zcode-session-1',
      sequence: 1,
      timeCreated: 1_700_000_002_000,
      data: {
        role: 'assistant',
        modelId: 'deepseek-v4-flash',
        providerId: 'ark',
        finish: 'stop',
        // ZCode folds the cache buckets into `input` (total === input + output),
        // so 15 is the whole prompt and 3 of it was served from the cache.
        tokens: { input: 15, output: 20, reasoning: 0, total: 35, cache: { read: 3, write: 2 } },
      },
    });
    insertPart(db, {
      id: 'part-reasoning',
      messageId: 'message-assistant',
      sessionId: 'zcode-session-1',
      sequence: 0,
      timeCreated: 1_700_000_002_000,
      data: { type: 'reasoning', text: 'I will inspect the provider shape first.' },
    });
    insertPart(db, {
      id: 'part-assistant-text',
      messageId: 'message-assistant',
      sessionId: 'zcode-session-1',
      sequence: 1,
      timeCreated: 1_700_000_002_500,
      data: { type: 'text', text: 'The provider is wired.' },
    });
    insertPart(db, {
      id: 'part-tool',
      messageId: 'message-assistant',
      sessionId: 'zcode-session-1',
      sequence: 2,
      timeCreated: 1_700_000_003_000,
      data: {
        type: 'tool',
        tool: 'bash',
        callID: 'tool-call-1',
        state: { status: 'completed', input: { command: 'npm test' }, output: 'ok' },
      },
    });
    insertPart(db, {
      id: 'part-step-finish',
      messageId: 'message-assistant',
      sessionId: 'zcode-session-1',
      sequence: 3,
      timeCreated: 1_700_000_004_000,
      data: { type: 'step-finish', reason: 'stop' },
    });
  } finally {
    db.close();
  }

  return dbPath;
}

/**
 * Seeds one minimal ZCode session for title-resolution tests. `firstUserText`
 * is stored as a JSON string literal, exactly as the CLI persists prompts.
 */
export async function seedZcodeSession(
  homeDir: string,
  workspacePath: string,
  options: { sessionId: string; title: string | null; firstUserText: string; archived?: boolean },
): Promise<void> {
  const dbPath = await createZcodeDatabase(homeDir);
  const db = new Database(dbPath);
  try {
    insertSession(db, {
      sessionId: options.sessionId,
      workspacePath,
      title: options.title ?? '',
      timeCreated: 1_700_000_000_000,
      timeUpdated: 1_700_000_001_000,
      archived: options.archived ? 1_700_000_002_000 : null,
    });
    insertMessage(db, {
      id: `message-user-${options.sessionId}`,
      sessionId: options.sessionId,
      sequence: 0,
      timeCreated: 1_700_000_001_000,
      data: { role: 'user' },
    });
    insertPart(db, {
      id: `part-user-${options.sessionId}`,
      messageId: `message-user-${options.sessionId}`,
      sessionId: options.sessionId,
      sequence: 0,
      timeCreated: 1_700_000_001_000,
      data: { type: 'text', text: JSON.stringify(options.firstUserText) },
    });
    // One row per usage/bookkeeping table so a delete that skips any of them
    // leaves an orphan behind for the assertions to find.
    const sid = options.sessionId;
    for (const [table, column, value] of [
      ['session_entry', 'data', JSON.stringify({ kind: 'entry' })],
      ['model_usage', 'model', 'deepseek-v4-flash'],
      ['turn_usage', 'turn', '1'],
      ['tool_usage', 'tool', 'bash'],
      ['input_history', 'text', options.firstUserText],
    ] as const) {
      db.prepare(`INSERT INTO ${table} (id, session_id, ${column}) VALUES (?, ?, ?)`).run(
        `${table}-${sid}`,
        sid,
        value,
      );
    }
  } finally {
    db.close();
  }
}
