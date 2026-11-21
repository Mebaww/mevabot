import { db } from './db.js';

export interface Reminder {
  id: number;
  user_id: number;
  text: string;
  due_at: number;
  created_at: number;
  notified: number;
}

// Initialize reminders table in SQLite
db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    due_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders (due_at, notified);
`);

/**
 * Adds a new reminder.
 */
export function addReminder(userId: number, text: string, dueAt: number): Reminder {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO reminders (user_id, text, due_at, created_at, notified)
    VALUES (?, ?, ?, ?, 0)
  `);
  const result = stmt.run(userId, text, dueAt, now);
  return {
    id: Number(result.lastInsertRowid),
    user_id: userId,
    text,
    due_at: dueAt,
    created_at: now,
    notified: 0,
  };
}

/**
 * Returns all active pending reminders for a user.
 */
export function getPendingReminders(userId: number): Reminder[] {
  const stmt = db.prepare(`
    SELECT id, user_id, text, due_at, created_at, notified
    FROM reminders
    WHERE user_id = ? AND notified = 0
    ORDER BY due_at ASC
  `);
  return stmt.all(userId) as unknown as Reminder[];
}

/**
 * Returns all due reminders that have not yet been notified.
 */
export function getDueReminders(): Reminder[] {
  const now = Date.now();
  const stmt = db.prepare(`
    SELECT id, user_id, text, due_at, created_at, notified
    FROM reminders
    WHERE due_at <= ? AND notified = 0
    ORDER BY due_at ASC
  `);
  return stmt.all(now) as unknown as Reminder[];
}

/**
 * Marks a reminder as notified so it does not trigger again.
 */
export function markReminderNotified(id: number): void {
  const stmt = db.prepare('UPDATE reminders SET notified = 1 WHERE id = ?');
  stmt.run(id);
}

/**
 * Fetches a reminder by ID.
 */
export function getReminderById(id: number): Reminder | null {
  const stmt = db.prepare('SELECT id, user_id, text, due_at, created_at, notified FROM reminders WHERE id = ?');
  const row = stmt.get(id);
  return (row as unknown as Reminder) ?? null;
}

/**
 * Snoozes a reminder by pushing its due time forward and resetting notified state.
 */
export function snoozeReminder(id: number, addSeconds: number): boolean {
  const newDueAt = Date.now() + addSeconds * 1000;
  const stmt = db.prepare('UPDATE reminders SET due_at = ?, notified = 0 WHERE id = ?');
  const result = stmt.run(newDueAt, id);
  return Number(result.changes) > 0;
}

/**
 * Deletes a reminder.
 */
export function deleteReminder(userId: number, id: number): boolean {
  const stmt = db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?');
  const result = stmt.run(id, userId);
  return Number(result.changes) > 0;
}

/**
 * Parses duration strings like "10m", "2h", "30s", "1d", "1h30m" into milliseconds.
 */
export function parseDuration(str: string): number | null {
  const regex = /(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)/gi;
  let totalMs = 0;
  let match: RegExpExecArray | null;
  let found = false;

  while ((match = regex.exec(str)) !== null) {
    found = true;
    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('s')) totalMs += val * 1000;
    else if (unit.startsWith('m')) totalMs += val * 60 * 1000;
    else if (unit.startsWith('h')) totalMs += val * 3600 * 1000;
    else if (unit.startsWith('d')) totalMs += val * 86400 * 1000;
  }

  return found ? totalMs : null;
}
