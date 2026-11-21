// Catch-all for plain text messages — the conversational AI handler.
// Keep this last in the plugin registry so commands are matched first.

import { chat } from '../../services/groq.js';
import { addMessage, getHistory } from '../../services/history.js';
import { logger } from '../../utils/logger.js';
import type { Plugin } from '../../types/plugin.js';

const SYSTEM = 'You are a personal assistant. Be direct, concise, and helpful. No filler.';

export const chatPlugin: Plugin = {
  name: 'chat',
  async onMessage(ctx) {
    const userId = ctx.from.id;
    const text   = ctx.message.text;

    await ctx.replyWithChatAction('typing');

    try {
      addMessage(userId, 'user', text);

      const reply = await chat([
        { role: 'system', content: SYSTEM },
        ...getHistory(userId),
      ]);

      addMessage(userId, 'assistant', reply);
      await ctx.reply(reply);
    } catch (err: unknown) {
      logger.error('Chat failed', { userId, message: (err as Error).message });
      await ctx.reply('Something went wrong. Try again in a moment.');
    }
  },
};
