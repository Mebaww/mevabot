// Keeps a per-user message history in memory.
// Want persistence across restarts? Swap the Map for Redis — the API stays the same.

import type { Message } from './groq.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const histories = new Map<number, Message[]>();

function get(userId: number): Message[] {
  if (!histories.has(userId)) histories.set(userId, []);
  return histories.get(userId)!;
}

// Drops the oldest user+assistant pair when the window is full.
export function addMessage(userId: number, role: 'user' | 'assistant', content: string): void {
  const h = get(userId);
  h.push({ role, content });
  while (h.length > config.chat.maxMessages) h.splice(0, 2);
}

export function getHistory(userId: number): Message[] {
  return [...get(userId)];
}

export function clearHistory(userId: number): void {
  histories.set(userId, []);
  logger.debug('History cleared', { userId });
}
