import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT,
  is_guest      INTEGER NOT NULL DEFAULT 0,
  color         TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_token TEXT NOT NULL UNIQUE,
  seq          INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS board_members (
  board_id  TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_members_user ON board_members(user_id);

CREATE TABLE IF NOT EXISTS columns (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  id       TEXT NOT NULL,
  title    TEXT NOT NULL,
  pos      TEXT NOT NULL,
  PRIMARY KEY (board_id, id)
);

CREATE TABLE IF NOT EXISTS cards (
  board_id    TEXT NOT NULL,
  id          TEXT NOT NULL,
  column_id   TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  labels      TEXT NOT NULL DEFAULT '[]',
  assignee_id TEXT,
  pos         TEXT NOT NULL,
  PRIMARY KEY (board_id, id),
  FOREIGN KEY (board_id, column_id) REFERENCES columns(board_id, id) ON DELETE CASCADE
);

-- Append-only log of every accepted operation. It drives the activity feed
-- and lets a reconnecting client fetch only what it missed.
CREATE TABLE IF NOT EXISTS ops (
  board_id  TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  cid       TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  user_name TEXT NOT NULL,
  op        TEXT NOT NULL,
  summary   TEXT NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (board_id, seq)
);

-- Comments hang off their card, so deleting the card (directly, or through
-- its column or board) removes them.
CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  board_id    TEXT NOT NULL,
  card_id     TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (board_id, card_id) REFERENCES cards(board_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS comments_card ON comments(board_id, card_id);
`;

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  addColumnIfMissing(db, 'cards', 'due_date', 'TEXT');
  return db;
}

/**
 * Adds a column to an existing table unless it is already there. New columns
 * go through this (called from `openDb` after the schema) so databases created
 * by an older version pick them up.
 */
export function addColumnIfMissing(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((existing) => existing.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
