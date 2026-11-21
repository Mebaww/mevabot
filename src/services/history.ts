// Persistent per-user message history backed by SQLite.
// Chat history survives server and bot restarts.

import { db }           from './db.js';
import type { Message } from './groq.js';
import { config }       from '../config.js';
import { logger }       from '../utils/logger.js';

const insertStmt = db.prepare(`
  INSERT INTO messages (user_id, role, content, created_at)
  VALUES (?, ?, ?, ?)
`);

const pruneStmt = db.prepare(`
  DELETE FROM messages
  WHERE user_id = ?
    AND id NOT IN (
      SELECT id FROM messages
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
    )
`);

const selectStmt = db.prepare(`
  SELECT role, content FROM (
    SELECT id, role, content FROM messages
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  ) ORDER BY id ASC
`);

const clearStmt = db.prepare(`DELETE FROM messages WHERE user_id = ?`);

/**
 * Stores a message and trims the window so it doesn't exceed config.chat.maxMessages.
 */
export function addMessage(userId: number, role: 'user' | 'assistant', content: string): void {
  insertStmt.run(userId, role, content, Date.now());
  pruneStmt.run(userId, userId, config.chat.maxMessages);
}

/**
 * Retrieves the recent sliding conversation history in chronological order.
 */
export function getHistory(userId: number): Message[] {
  const rows = selectStmt.all(userId, config.chat.maxMessages) as unknown as Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;

  return rows.map((r) => ({ role: r.role, content: r.content }));
}

/**
 * Deletes all stored conversation messages for the current session.
 */
export function clearHistory(userId: number): void {
  clearStmt.run(userId);
  logger.debug('Session messages cleared from SQLite', { userId });
}
