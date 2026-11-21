// Memory management plugin: /memories, /remember, /forget
import {
  getAllMemories,
  addMemory,
  deleteMemory,
  clearAllMemories,
} from '../../services/memory.js';
import type { Plugin } from '../../types/plugin.js';

export const memoryPlugin: Plugin = {
  name: 'memory',
  commands: [
    {
      command: 'memories',
      description: 'View learned facts about you',
      async handler(ctx) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const list = getAllMemories(userId);

        if (list.length === 0) {
          await ctx.reply(
            '🧠 No permanent memories stored yet.\n\nTell me facts about you in chat or use:\n`/remember <fact>`',
            { parse_mode: 'Markdown' },
          );
          return;
        }

        const lines = list.map((m) => `• \`#${m.id}\`: ${m.fact}`).join('\n');
        await ctx.reply(
          `🧠 *Learned Memories (${list.length}):*\n\n${lines}\n\n_Use /forget <id> to delete one, or /forget all to wipe._`,
          { parse_mode: 'Markdown' },
        );
      },
    },
    {
      command: 'remember',
      description: 'Manually save a fact about you',
      async handler(ctx) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const fact = ctx.match?.trim();
        if (!fact) {
          await ctx.reply('Usage: `/remember <fact about you>`\nExample: `/remember I prefer TypeScript`', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const added = addMemory(userId, fact);
        if (added) {
          await ctx.reply(`🧠 Remembered: "${fact}"`);
        } else {
          await ctx.reply('I already have this exact fact in memory.');
        }
      },
    },
    {
      command: 'forget',
      description: 'Delete a memory (/forget <id> or /forget all)',
      async handler(ctx) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const arg = ctx.match?.trim().toLowerCase();

        if (!arg) {
          await ctx.reply('Usage: `/forget <id>` or `/forget all`\n(Use /memories to find IDs)', {
            parse_mode: 'Markdown',
          });
          return;
        }

        if (arg === 'all') {
          clearAllMemories(userId);
          await ctx.reply('🧠 All permanent memories have been wiped.');
          return;
        }

        const id = parseInt(arg, 10);
        if (isNaN(id) || id <= 0) {
          await ctx.reply('Please provide a valid memory ID number (e.g. `/forget 3`).', {
            parse_mode: 'Markdown',
          });
          return;
        }

        const deleted = deleteMemory(userId, id);
        if (deleted) {
          await ctx.reply(`🗑️ Forgot memory #${id}.`);
        } else {
          await ctx.reply(`Could not find memory #${id}. Use /memories to check valid IDs.`);
        }
      },
    },
  ],
};
