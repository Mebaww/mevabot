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

/**
 * Formats milliseconds difference into friendly relative string (e.g. "20m", "10h 35m", "1d 4h").
 */
export function formatRelativeTime(diffMs: number): string {
  if (diffMs < 60_000) {
    return `${Math.max(1, Math.round(diffMs / 1000))}s`;
  }
  const totalMins = Math.round(diffMs / 60_000);
  if (totalMins < 60) {
    return `${totalMins}m`;
  }
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/**
 * Formats timestamp into user-friendly time string (e.g. "7:30 PM today", "10:00 AM tomorrow").
 */
export function formatDueTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    d.getDate() === tomorrow.getDate() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getFullYear() === tomorrow.getFullYear();

  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

  if (isToday) return `${timeStr} today`;
  if (isTomorrow) return `${timeStr} tomorrow`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

/**
 * Parses a standalone target time or duration (e.g. "7:30 PM", "19:30", "tomorrow at 10am", "20m", "2h").
 * Returns absolute timestamp in milliseconds, or null if unparseable.
 */
export function parseTargetTime(timeStr: string, now: Date = new Date()): number | null {
  let clean = timeStr.trim();
  if (!clean) return null;

  let isTomorrow = false;
  if (/^tomorrow\s+(?:at\s+)?/i.test(clean)) {
    isTomorrow = true;
    clean = clean.replace(/^tomorrow\s+(?:at\s+)?/i, '').trim();
  } else if (/^(?:at|in)\s+/i.test(clean)) {
    clean = clean.replace(/^(?:at|in)\s+/i, '').trim();
  }

  // Check if it's a relative duration (e.g. "20m", "1h 30m")
  const durMs = parseDuration(clean);
  if (durMs && durMs >= 5000) {
    return now.getTime() + durMs;
  }

  // Check if it's a clock time (e.g. "7:30 pm", "7:30pm", "7pm", "19:30")
  const clockRegex = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
  const match = clean.match(clockRegex);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const ampm = match[3] ? match[3].toLowerCase() : null;

    if (minutes < 0 || minutes > 59) return null;

    if (ampm) {
      if (hours < 1 || hours > 12) return null;
      if (hours === 12 && ampm === 'am') hours = 0;
      else if (hours < 12 && ampm === 'pm') hours += 12;
    } else {
      if (hours < 0 || hours > 23) return null;
    }

    const target = new Date(now.getTime());
    target.setHours(hours, minutes, 0, 0);

    let rollsToTomorrow = isTomorrow;
    if (!rollsToTomorrow && target.getTime() <= now.getTime()) {
      rollsToTomorrow = true;
    }

    if (rollsToTomorrow) {
      target.setDate(target.getDate() + 1);
    }

    return target.getTime();
  }

  return null;
}

export interface ParsedReminder {
  dueAt: number;
  text: string;
  delayMs: number;
  dueTimeStr: string;
  relativeStr: string;
}

/**
 * Parses user reminder inputs with either clock times ("7:30 pm Call John", "tomorrow at 10am meeting")
 * or relative durations ("20m check oven", "1h 30m review PR").
 */
export function parseReminderInput(input: string, now: Date = new Date()): ParsedReminder | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let clean = trimmed;
  let isTomorrow = false;

  if (/^tomorrow\s+(?:at\s+)?/i.test(clean)) {
    isTomorrow = true;
    clean = clean.replace(/^tomorrow\s+(?:at\s+)?/i, '').trim();
  } else if (/^(?:at|in)\s+/i.test(clean)) {
    clean = clean.replace(/^(?:at|in)\s+/i, '').trim();
  }

  // Strategy 1: Relative duration followed by reminder text
  // e.g. "20m Check oven", "1h 30m Review code", "45 mins Call Mom"
  const relPattern = /^((?:\d+\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s*)+)\s+(?:to\s+)?([\s\S]+)$/i;
  const relMatch = clean.match(relPattern);
  if (relMatch) {
    const durMs = parseDuration(relMatch[1].trim());
    const reminderText = relMatch[2].trim();
    if (durMs && durMs >= 5000 && reminderText) {
      const dueAt = now.getTime() + durMs;
      return {
        dueAt,
        text: reminderText,
        delayMs: durMs,
        dueTimeStr: formatDueTime(dueAt),
        relativeStr: formatRelativeTime(durMs),
      };
    }
  }

  // Strategy 2: Clock time followed by reminder text
  // e.g. "7:30 pm Call John", "7:30pm Call John", "7pm Dinner", "19:30 Deploy"
  const clockPattern = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:to\s+)?([\s\S]+)$/i;
  const clockMatch = clean.match(clockPattern);
  if (clockMatch) {
    let hours = parseInt(clockMatch[1], 10);
    const minutes = clockMatch[2] ? parseInt(clockMatch[2], 10) : 0;
    const ampm = clockMatch[3] ? clockMatch[3].toLowerCase() : null;
    const reminderText = clockMatch[4].trim();

    if (minutes >= 0 && minutes <= 59 && reminderText) {
      let valid = true;
      if (ampm) {
        if (hours < 1 || hours > 12) valid = false;
        else if (hours === 12 && ampm === 'am') hours = 0;
        else if (hours < 12 && ampm === 'pm') hours += 12;
      } else {
        if (hours < 0 || hours > 23) valid = false;
      }

      if (valid) {
        const target = new Date(now.getTime());
        target.setHours(hours, minutes, 0, 0);

        let rollsToTomorrow = isTomorrow;
        if (!rollsToTomorrow && target.getTime() <= now.getTime()) {
          rollsToTomorrow = true;
        }

        if (rollsToTomorrow) {
          target.setDate(target.getDate() + 1);
        }

        const dueAt = target.getTime();
        const delayMs = dueAt - now.getTime();

        return {
          dueAt,
          text: reminderText,
          delayMs,
          dueTimeStr: formatDueTime(dueAt),
          relativeStr: formatRelativeTime(delayMs),
        };
      }
    }
  }

  return null;
}
