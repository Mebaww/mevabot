// Shared SQLite database instance (built into Node 22+).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync }     from 'node:fs';
import { dirname }       from 'node:path';

const dbPath = process.env.DB_PATH?.trim() || 'data/mevabot.db';

// Ensure data/ directory exists
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

// Fast concurrent reads and writes
db.exec('PRAGMA journal_mode = WAL;');

// Initialize schema for messages and long-term memories
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages (user_id, id DESC);

  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    fact TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_fact ON memories (user_id, fact);
`);
