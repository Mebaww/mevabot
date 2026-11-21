// Long-term user memories service.
// Extracts, stores, and injects persistent facts across all chat sessions.

import { db }     from './db.js';
import { chat }   from './groq.js';
import { logger } from '../utils/logger.js';

// Fast local heuristic regex: only call Groq extraction if message contains personal facts.
// Prevents burning Groq tokens or rate limits on normal casual conversation.
const FACT_TRIGGER_REGEX = /\b(my|i am|i'm|i work|i live|i prefer|i like|i love|favorite|favourite|remember|call me|my stack|i use|i built|i am building|my timezone|my role|my job|my project)\b/i;

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO memories (user_id, fact, created_at)
  VALUES (?, ?, ?)
`);

const selectTopStmt = db.prepare(`
  SELECT fact FROM memories
  WHERE user_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

const selectAllStmt = db.prepare(`
  SELECT id, fact FROM memories
  WHERE user_id = ?
  ORDER BY id ASC
`);

const deleteStmt = db.prepare(`
  DELETE FROM memories
  WHERE user_id = ? AND id = ?
`);

const clearStmt = db.prepare(`
  DELETE FROM memories
  WHERE user_id = ?
`);

/**
 * Stores a fact about the user. Ignores duplicates automatically.
 */
export function addMemory(userId: number, fact: string): boolean {
  const cleaned = fact.trim().replace(/^[-*•]\s*/, '');
  if (!cleaned) return false;
  const info = insertStmt.run(userId, cleaned, Date.now());
  return info.changes > 0;
}

/**
 * Retrieves the most recent core facts for prompt injection (default top 15).
 */
export function getMemories(userId: number, limit = 15): string[] {
  const rows = selectTopStmt.all(userId, limit) as unknown as Array<{ fact: string }>;
  return rows.map((r) => r.fact).reverse();
}

/**
 * Retrieves all stored memories with their IDs (for /memories management).
 */
export function getAllMemories(userId: number): Array<{ id: number; fact: string }> {
  return selectAllStmt.all(userId) as unknown as Array<{ id: number; fact: string }>;
}

/**
 * Deletes a single memory by ID.
 */
export function deleteMemory(userId: number, memoryId: number): boolean {
  const info = deleteStmt.run(userId, memoryId);
  return info.changes > 0;
}

/**
 * Wipes all long-term memories for a user.
 */
export function clearAllMemories(userId: number): void {
  clearStmt.run(userId);
  logger.info('All long-term memories cleared', { userId });
}

/**
 * Builds the compact memory prompt string to append to the system prompt.
 * Adds ~20-50 tokens max, leaving 99%+ of Groq's 131k token window free.
 */
export function formatMemoryContext(userId: number): string {
  const facts = getMemories(userId, 15);
  if (facts.length === 0) return '';

  return `\n\nLearned User Facts & Preferences:\n${facts.map((f) => `- ${f}`).join('\n')}`;
}

/**
 * Asynchronously extracts durable facts from the user message.
 * Non-blocking: runs in the background AFTER the bot has already replied to the user.
 */
export async function extractAndSaveMemories(userId: number, text: string): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length < 8) return;

  // Local check: if the message doesn't look like it shares personal facts, skip immediately (0 tokens burned)
  if (!FACT_TRIGGER_REGEX.test(trimmed)) return;

  try {
    const prompt = [
      'Extract 1 to 3 concise factual statements about the user from their message.',
      'Focus strictly on permanent facts: identity, name, tech stack, preferences, location, projects, or job.',
      'Do not extract temporary states (e.g. eating food, feeling tired) or greetings.',
      'If no durable personal facts exist, output NONE.',
      '',
      `User message: "${trimmed}"`,
    ].join('\n');

    // Use fast 8b model for background extraction (560 tokens/sec, low token usage)
    const reply = await chat(
      [
        {
          role: 'system',
          content: 'You extract user profile facts. Output only bullet points starting with "-", or NONE.',
        },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 80, temperature: 0.1 },
    );

    if (!reply || reply.includes('NONE')) return;

    const lines = reply
      .split('\n')
      .map((l) => l.trim().replace(/^[-*•]\s*/, ''))
      .filter((l) => l.length > 3 && !l.toLowerCase().includes('none'));

    for (const fact of lines) {
      if (addMemory(userId, fact)) {
        logger.debug('Learned new memory', { userId, fact });
      }
    }
  } catch (err: unknown) {
    // Fail silently in background without disturbing user
    logger.debug('Memory extraction skipped or failed', { message: (err as Error).message });
  }
}
