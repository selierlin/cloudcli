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
      data: { role: 'user', modelID: 'deepseek-v4-flash', providerID: 'ark', mode: 'edit' },
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
        modelID: 'deepseek-v4-flash',
        providerID: 'ark',
        finish: 'stop',
        tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 3, write: 2 } },
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
  } finally {
    db.close();
  }
}
