// Catch-all for plain text messages — the conversational AI handler.
// Keep this last in the plugin registry so commands are matched first.

import { chat }                                      from '../../services/groq.js';
import { addMessage, getHistory }                    from '../../services/history.js';
import { formatMemoryContext, extractAndSaveMemories } from '../../services/memory.js';
import { getPendingAction, clearPendingAction }       from '../../services/userState.js';
import { parseReminderInput, addReminder }           from '../../services/reminders.js';
import { parseProposalInput, generateProposal }      from '../proposal/index.js';
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
• You have access to tools for system inspection, Groq rate limits, reminders, and Upwork proposal generation.
• When asked about system health, VPS stats, Groq limits/quota/usage, or models, call the relevant tool to fetch real data.
• When asked to set a reminder or alert, call create_reminder. You can specify the target time directly (e.g. "7:30 PM", "tomorrow 9:00 AM", "20m") or delay_seconds. Confirm briefly and naturally (e.g. "Reminder set for 7:30 PM (in 10h 35m)."). Never output technical fields, database IDs, or ISO timestamps. Use list_reminders and cancel_reminder when requested.
• When asked to write an Upwork proposal or evaluate a job post, call generate_upwork_proposal. If the user provided any specific ideas, hook preferences, CTA ideas, project mentions, or suggestions, pass them into the \`suggestion\` argument. Always format the returned proposal inside a \`\`\`code block\`\`\` with no conversational fluff, so the user can copy it with one tap.`;

function buildSystemPrompt(userId: number): string {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeContext = `\nCurrent local time: ${dateStr}, ${timeStr} (${tz}).\n`;

  return BASE_SYSTEM + timeContext + formatMemoryContext(userId);
}

export const chatPlugin: Plugin = {
  name: 'chat',
  async onMessage(ctx) {
    const userId = ctx.from.id;
    const text   = ctx.message.text.trim();

    // Check if user is in an interactive command state (/proposal or /remind)
    const pending = getPendingAction(userId);
    if (pending) {
      if (pending.type === 'awaiting_proposal') {
        clearPendingAction(userId);
        await ctx.replyWithChatAction('typing');
        const { jobText, suggestion } = parseProposalInput(text);
        try {
          const proposal = await generateProposal({
            jobText,
            userId,
            suggestion,
          });
          await replySafe(ctx, `\`\`\`\n${proposal}\n\`\`\``);
        } catch (err: unknown) {
          logger.error('Interactive proposal generation failed', { message: (err as Error).message });
          await ctx.reply('Could not generate a proposal right now. Try again in a moment.');
        }
        return;
      }

      if (pending.type === 'awaiting_remind') {
        const parsed = parseReminderInput(text);
        if (parsed) {
          clearPendingAction(userId);
          addReminder(userId, parsed.text, parsed.dueAt);
          await replySafe(
            ctx,
            `Reminder set for **${parsed.dueTimeStr}** (in ${parsed.relativeStr}): ${parsed.text}`,
          );
        } else {
          await replySafe(
            ctx,
            'Could not understand the time or task.\n\n' +
            'Try something like:\n' +
            '• `7:30 pm Call John`\n' +
            '• `tomorrow at 10am Team standup`\n' +
            '• `20m Check oven`\n\n' +
            'Or type /cancel to go back to the main menu.',
          );
        }
        return;
      }
    }

    await ctx.replyWithChatAction('typing');

    try {
      addMessage(userId, 'user', text);

      // Gather tools from all loaded plugins
      const availableTools = getAllTools(plugins);

      // Inject current time context and durable profile facts into system prompt
      const systemPrompt = buildSystemPrompt(userId);

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
