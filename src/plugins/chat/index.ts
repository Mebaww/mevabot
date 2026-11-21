// Catch-all for plain text messages — the conversational AI handler.
// Keep this last in the plugin registry so commands are matched first.

import { chat }                                      from '../../services/groq.js';
import { addMessage, getHistory }                    from '../../services/history.js';
import { formatMemoryContext, extractAndSaveMemories } from '../../services/memory.js';
import { logger }                                    from '../../utils/logger.js';
import type { Plugin }                               from '../../types/plugin.js';

const BASE_SYSTEM = 'You are a personal assistant. Be direct, concise, and helpful. No filler.';

export const chatPlugin: Plugin = {
  name: 'chat',
  async onMessage(ctx) {
    const userId = ctx.from.id;
    const text   = ctx.message.text;

    await ctx.replyWithChatAction('typing');

    try {
      addMessage(userId, 'user', text);

      // Inject long-term profile facts into system prompt
      const systemPrompt = BASE_SYSTEM + formatMemoryContext(userId);

      const reply = await chat([
        { role: 'system', content: systemPrompt },
        ...getHistory(userId),
      ]);

      addMessage(userId, 'assistant', reply);
      await ctx.reply(reply);

      // Background, non-blocking: extract durable facts if message contained personal info
      // Runs without slowing down the user response
      void extractAndSaveMemories(userId, text);
    } catch (err: unknown) {
      logger.error('Chat failed', { userId, message: (err as Error).message });
      await ctx.reply('Something went wrong. Try again in a moment.');
    }
  },
};
