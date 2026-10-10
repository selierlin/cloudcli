import zlib from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

/**
 * Builds one agent's OpenClaw SQLite transcript store at the layout the
 * providers resolve (`<state root>/agents/<agentId>/agent/
 * openclaw-agent.sqlite`).
 *
 * Only the columns/tables the reader, synchronizer, token-usage and delete
 * paths touch are declared, matching OpenClaw's real schema: `session_nodes`
 * (the session index, keyed by `session_key`) → `session_windows` (one window
 * id per key) → `transcript_events` (seq-ordered entries) →
 * `session_transcript_active_events` (the precomputed leaf path). The
 * `transcript_events` payload columns are mutually exclusive via a CHECK, so
 * the fixture fails if a caller sets both or neither.
 */
export async function createOpenclawAgentDatabase(homeDir: string, agentId: string): Promise<string> {
  const dbPath = path.join(homeDir, 'agents', agentId, 'agent', 'openclaw-agent.sqlite');
  await mkdir(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE session_nodes (
        session_key TEXT PRIMARY KEY,
        current_session_id TEXT,
        display_name TEXT,
        label TEXT,
        entry_json TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        last_interaction_at INTEGER,
        archived_at INTEGER
      );
      CREATE TABLE session_windows (
        session_id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL
      );
      CREATE TABLE transcript_events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_json TEXT,
        event_zstd BLOB,
        PRIMARY KEY (session_id, seq),
        CHECK ((event_json IS NULL) <> (event_zstd IS NULL))
      );
      CREATE TABLE session_transcript_active_events (
        session_id TEXT NOT NULL,
        event_seq INTEGER NOT NULL,
        active_position INTEGER NOT NULL
      );
      CREATE TABLE session_transcript_index_state (
        session_id TEXT PRIMARY KEY
      );
    `);
  } finally {
    db.close();
  }

  return dbPath;
}

/** One stored entry; `null` leaves that seq unwritten (a gap in the log). */
export type OpenclawEventSeed = { json: unknown; compressed?: boolean } | null;

export type OpenclawSessionSeed = {
  /** Session key OpenClaw writes, e.g. `agent:main:main`. Owns the agent id. */
  sessionKey: string;
  /** Current window id (`session_nodes.current_session_id`). */
  windowId: string;
  displayName?: string | null;
  label?: string | null;
  entryJson?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  lastInteractionAt?: number | null;
  archivedAt?: number | null;
  /** Entries in seq order; the array index is the seq. */
  events: OpenclawEventSeed[];
  /** Active path as explicit seq order; defaults to every non-null seq ascending. */
  activeSeq?: number[];
};

/** `agent:<agentId>:<rest>` → agentId, mirroring OpenClaw's session-key shape. */
export function agentIdFromSessionKey(sessionKey: string): string {
  const match = /^agent:([^:]+):/.exec(sessionKey);
  if (!match) {
    throw new Error(`not an OpenClaw session key: ${sessionKey}`);
  }
  return match[1];
}

/** Inserts one session (index row, window, events, active path, index state). */
export async function seedOpenclawSession(homeDir: string, seed: OpenclawSessionSeed): Promise<void> {
  const agentId = agentIdFromSessionKey(seed.sessionKey);
  const dbPath = await createOpenclawAgentDatabase(homeDir, agentId);
  const db = new Database(dbPath);
  try {
    db.prepare(`
      INSERT INTO session_nodes (
        session_key, current_session_id, display_name, label, entry_json,
        created_at, updated_at, last_interaction_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      seed.sessionKey,
      seed.windowId,
      seed.displayName ?? null,
      seed.label ?? null,
      seed.entryJson ?? null,
      seed.createdAt ?? null,
      seed.updatedAt ?? null,
      seed.lastInteractionAt ?? null,
      seed.archivedAt ?? null,
    );

    db.prepare('INSERT INTO session_windows (session_id, session_key) VALUES (?, ?)')
      .run(seed.windowId, seed.sessionKey);

    const insertEvent = db.prepare(`
      INSERT INTO transcript_events (session_id, seq, event_json, event_zstd)
      VALUES (?, ?, ?, ?)
    `);
    seed.events.forEach((event, seq) => {
      if (event === null) {
        return;
      }
      const json = JSON.stringify(event.json);
      if (event.compressed) {
        insertEvent.run(seed.windowId, seq, null, zlib.zstdCompressSync(Buffer.from(json)));
      } else {
        insertEvent.run(seed.windowId, seq, json, null);
      }
    });

    const activeSeq = seed.activeSeq
      ?? seed.events.map((event, seq) => (event === null ? -1 : seq)).filter((seq) => seq >= 0);
    const insertActive = db.prepare(`
      INSERT INTO session_transcript_active_events (session_id, event_seq, active_position)
      VALUES (?, ?, ?)
    `);
    activeSeq.forEach((seq, position) => insertActive.run(seed.windowId, seq, position));

    db.prepare('INSERT INTO session_transcript_index_state (session_id) VALUES (?)').run(seed.windowId);
  } finally {
    db.close();
  }
}

/** The Pi-format transcript header OpenClaw writes at `seq = 0`. */
export function openclawHeaderEntry(cwd: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'session', version: 3, cwd, ...extra };
}

/** One Pi-format `message` entry. */
export function openclawMessageEntry(
  id: string,
  message: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'message',
    id,
    timestamp: '2026-04-24T05:01:00.000Z',
    message: { timestamp: 1_776_000_000_000, ...message },
    ...extra,
  };
}
