// Catch-all for plain text messages — the conversational AI handler.
// Keep this last in the plugin registry so commands are matched first.

import { chat }                                      from '../../services/groq.js';
import { addMessage, getHistory }                    from '../../services/history.js';
import { formatMemoryContext, extractAndSaveMemories } from '../../services/memory.js';
import { getAllTools }                               from '../../core/loader.js';
import { plugins }                                   from '../index.js';
import { replySafe }                                 from '../../utils/format.js';
import { logger }                                    from '../../utils/logger.js';
import type { Plugin }                               from '../../types/plugin.js';

const BASE_SYSTEM = `You are a personal assistant. Be direct, thoughtful, and concise. No conversational filler, throat-clearing, or generic pleasantries.

Design & formatting guidelines:
• Zero emoji: Do not use emojis in responses unless explicitly requested by the user. Keep text clean, modern, and uncluttered.
• Clean structure: Use bold text sparingly for headings. Use clean bulleted lists for structured information. Never use Markdown headers (# or ##) or Markdown tables.
• Smart copy-to-clipboard: Put items in \`inline code\` or \`\`\`code blocks\`\`\` ONLY when the user would genuinely copy them (shell commands, code snippets, IDs, config keys, paths, URLs). Never wrap ordinary words, phrases, or numbers in code formatting.
• Minimal callouts: Use > blockquotes strictly for critical notes, caveats, or warnings.
• No padding: Answer questions directly and concisely without conversational introductions or sign-offs.

Tools:
• You have access to tools for system inspection, Groq rate limits, and reminders.
• When asked about system health, VPS stats, Groq limits/quota/usage, or models, call the relevant tool to fetch real data.
• When asked to set a reminder or alert, calculate delay_seconds from now and call create_reminder. Confirm briefly and naturally (e.g. "Reminder set for 4:30 PM (in 15m)."). Never output technical fields, database IDs, or ISO timestamps. Use list_reminders and cancel_reminder when requested.`;

export const chatPlugin: Plugin = {
  name: 'chat',
  async onMessage(ctx) {
    const userId = ctx.from.id;
    const text   = ctx.message.text;

    await ctx.replyWithChatAction('typing');

    try {
      addMessage(userId, 'user', text);

      // Gather tools from all loaded plugins
      const availableTools = getAllTools(plugins);

      // Inject long-term profile facts into system prompt
      const systemPrompt = BASE_SYSTEM + formatMemoryContext(userId);

      const reply = await chat(
        [
          { role: 'system', content: systemPrompt },
          ...getHistory(userId),
        ],
        { tools: availableTools },
      );

      addMessage(userId, 'assistant', reply);
      await replySafe(ctx, reply);

      // Background, non-blocking: extract durable facts if message contained personal info
      void extractAndSaveMemories(userId, text);
    } catch (err: unknown) {
      logger.error('Chat failed', { userId, message: (err as Error).message });
      await ctx.reply('Something went wrong. Try again in a moment.');
    }
  },
};
